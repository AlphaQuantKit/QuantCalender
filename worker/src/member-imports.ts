import { Hono } from 'hono'
import { timingSafeEqual } from 'node:crypto'
import { bodyLimit } from 'hono/body-limit'
import { Temporal } from '@js-temporal/polyfill'
import { z } from 'zod'
import { calendarDateSchema, importRowsSchema } from '@wq-calendar/shared'
import type { Env, SessionRecord } from './env'
import { requireAuth, verifyMutation } from './auth'
import { encryptWqId, hmacSha256, normalizeWqId, wqIdHint } from './crypto'
import { apiError, readJson } from './http'

type App = Hono<{ Bindings: Env; Variables: { session: SessionRecord } }>
type ImportBatch = { id: string; status: string; total_rows: number; expected_rows: number | null; board_date: string | null }
const syncSchema = z.object({ expectedRows: z.number().int().min(1).max(100000), boardDate: calendarDateSchema })

async function validSyncToken(token: string, expected: string): Promise<boolean> {
  if (expected.length < 32 || !token) return false
  const encoder = new TextEncoder()
  const hashes = await Promise.all([token, expected].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))))
  return timingSafeEqual(new Uint8Array(hashes[0]!), new Uint8Array(hashes[1]!))
}

export function registerMemberImportRoutes(app: App) {
  for (const source of ['manual', 'platform'] as const) {
    const routes: App = new Hono()
    routes.use('*', async (context, next) => {
      if (source === 'platform') {
        const expected = context.env.MEMBER_SYNC_TOKEN || ''
        const token = /^Bearer ([^\s]+)$/.exec(context.req.header('authorization') || '')?.[1] || ''
        // Machine auth is deliberately scoped to these routes, never admin APIs.
        if (!await validSyncToken(token, expected)) {
          return apiError(context, 401, 'UNAUTHENTICATED', '同步令牌无效或未配置')
        }
        await next()
      } else {
        return requireAuth('admin')(context, async () => {
          if (context.req.method !== 'GET' && !await verifyMutation(context, context.get('session'))) {
            context.res = apiError(context, 403, 'CSRF_FAILED', '安全校验失败')
            return
          }
          await next()
        })
      }
    })
    routes.use('*', bodyLimit({ maxSize: 64 * 1024 }))

    routes.post('/', async (context) => {
      let expectedRows: number | null = null
      let boardDate: string | null = null
      if (source === 'platform') {
        const parsed = syncSchema.safeParse(await readJson(context))
        if (!parsed.success) return apiError(context, 422, 'VALIDATION_ERROR', '同步人数或榜单日期无效')
        expectedRows = parsed.data.expectedRows
        boardDate = parsed.data.boardDate
      }
      const id = crypto.randomUUID()
      await context.env.DB.prepare(`INSERT INTO member_imports (id, status, total_rows, created_at, source, expected_rows, board_date)
        VALUES (?1, 'staging', 0, ?2, ?3, ?4, ?5)`).bind(id, Date.now(), source, expectedRows, boardDate).run()
      return context.json({ importId: id }, 201)
    })

    routes.post('/:id/rows', async (context) => {
      const parsed = importRowsSchema.safeParse(await readJson(context))
      if (!parsed.success) return apiError(context, 422, 'VALIDATION_ERROR', '成员批次格式无效')
      const id = context.req.param('id')
      const batch = await context.env.DB.prepare("SELECT id FROM member_imports WHERE id = ?1 AND source = ?2 AND status = 'staging'").bind(id, source).first()
      if (!batch) return apiError(context, 409, 'IMPORT_NOT_STAGING', '导入批次不可用')
      const recordDate = Temporal.Now.instant().toZonedDateTimeISO('Asia/Shanghai').toPlainDate().toString()
      const statements: D1PreparedStatement[] = []
      for (const row of parsed.data.rows) {
        const normalized = normalizeWqId(row.wqId)
        statements.push(context.env.DB.prepare(`
          INSERT INTO member_import_rows (import_id, wq_id_hash, wq_id_hint, wq_id_ciphertext, country, record_date)
          SELECT ?1, ?2, ?3, ?4, ?5, ?6
          WHERE EXISTS (SELECT 1 FROM member_imports WHERE id = ?1 AND status = 'staging' AND source = ?7)
          ON CONFLICT(import_id, wq_id_hash) DO UPDATE SET wq_id_ciphertext = excluded.wq_id_ciphertext,
            country = excluded.country, record_date = excluded.record_date
        `).bind(id, await hmacSha256(normalized, context.env.WQ_ID_HMAC_SECRET), wqIdHint(normalized),
          await encryptWqId(normalized, context.env.WQ_ID_HMAC_SECRET), row.country, recordDate, source))
      }
      statements.push(context.env.DB.prepare(`UPDATE member_imports SET total_rows =
        (SELECT COUNT(*) FROM member_import_rows WHERE import_id = ?1) WHERE id = ?1 AND status = 'staging'`).bind(id))
      await context.env.DB.batch(statements)
      const row = await context.env.DB.prepare('SELECT total_rows FROM member_imports WHERE id = ?1').bind(id).first<{ total_rows: number }>()
      return context.json({ stagedRows: row?.total_rows || 0 })
    })

    routes.get('/:id', async (context) => {
      const id = context.req.param('id')
      const batch = await context.env.DB.prepare('SELECT * FROM member_imports WHERE id = ?1 AND source = ?2').bind(id, source).first<ImportBatch>()
      if (!batch) return apiError(context, 404, 'NOT_FOUND', '导入批次不存在')
      const preview = await context.env.DB.prepare('SELECT wq_id_hint, country, record_date FROM member_import_rows WHERE import_id = ?1 ORDER BY wq_id_hint LIMIT 20').bind(id).all()
      return context.json({ batch, preview: preview.results })
    })

    routes.post('/:id/commit', async (context) => {
      const id = context.req.param('id')
      const batch = await context.env.DB.prepare('SELECT * FROM member_imports WHERE id = ?1 AND source = ?2').bind(id, source).first<ImportBatch>()
      if (!batch || batch.status === 'abandoned' || batch.total_rows === 0) return apiError(context, 409, 'EMPTY_IMPORT', '导入批次为空或不可用')
      if (source === 'platform' && batch.total_rows !== batch.expected_rows) return apiError(context, 409, 'INCOMPLETE_IMPORT', '同步人数不匹配，尚未修改成员名单')
      const now = Date.now()
      // Every statement checks staging inside the same atomic D1 batch. Commit retries
      // cannot replay a historical replacement or mutate a previously committed batch.
      const ready = `EXISTS (SELECT 1 FROM member_imports WHERE id = ?1 AND source = ?3 AND status = 'staging'
        AND total_rows > 0 AND (expected_rows IS NULL OR expected_rows = total_rows))`
      const statements = [context.env.DB.prepare(`
        INSERT INTO members (id, wq_id_hash, wq_id_hint, wq_id_ciphertext, country, record_date, active, import_batch_id, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), wq_id_hash, wq_id_hint, wq_id_ciphertext, country, record_date, 1, ?1, ?2, ?2
        FROM member_import_rows WHERE import_id = ?1 AND ${ready}
        ON CONFLICT(wq_id_hash) DO UPDATE SET wq_id_hint = excluded.wq_id_hint, wq_id_ciphertext = excluded.wq_id_ciphertext,
          country = excluded.country, record_date = excluded.record_date, active = 1,
          import_batch_id = excluded.import_batch_id, updated_at = excluded.updated_at
      `).bind(id, now, source)]
      if (source === 'manual') {
        statements.push(
          context.env.DB.prepare(`UPDATE members SET active = 0, updated_at = ?2 WHERE ${ready}
            AND wq_id_hash NOT IN (SELECT wq_id_hash FROM member_import_rows WHERE import_id = ?1)`).bind(id, now, source),
          context.env.DB.prepare(`DELETE FROM sessions WHERE role = 'member' AND ?2 > 0 AND ${ready}
            AND member_id IN (SELECT id FROM members WHERE active = 0)`).bind(id, now, source),
          context.env.DB.prepare(`UPDATE calendar_tokens SET revoked_at = ?2, updated_at = ?2 WHERE ${ready}
            AND member_id IN (SELECT id FROM members WHERE active = 0) AND revoked_at IS NULL`).bind(id, now, source)
        )
      }
      statements.push(
        context.env.DB.prepare(`INSERT INTO audit_logs (id, actor_role, actor_member_id, action, entity_type, entity_id, metadata_json, created_at)
          SELECT ?4, ?5, NULL, ?6, 'member_import', ?1, ?7, ?2 WHERE ${ready}`)
          .bind(id, now, source, crypto.randomUUID(), source === 'manual' ? 'admin' : 'automation',
            source === 'manual' ? 'commit_import' : 'sync_members', JSON.stringify({ rows: batch.total_rows, source, boardDate: batch.board_date, mode: source === 'manual' ? 'replace' : 'merge' })),
        context.env.DB.prepare(`UPDATE member_imports SET status = 'committed', committed_at = ?2 WHERE id = ?1 AND ${ready}`).bind(id, now, source)
      )
      await context.env.DB.batch(statements)
      const final = await context.env.DB.prepare('SELECT status FROM member_imports WHERE id = ?1').bind(id).first<{ status: string }>()
      if (final?.status !== 'committed') return apiError(context, 409, 'IMPORT_NOT_STAGING', '导入状态已变化，请重新检查批次')
      const active = await context.env.DB.prepare('SELECT COUNT(*) AS count FROM members WHERE active = 1').first<{ count: number }>()
      return context.json({ committed: true, importedRows: batch.total_rows, activeMembers: active?.count || 0, mode: source === 'manual' ? 'replace' : 'merge' })
    })
    app.route(source === 'manual' ? '/v1/admin/member-imports' : '/v1/automation/member-imports', routes)
  }
}
