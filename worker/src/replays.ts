import type { Hono } from 'hono'
import {
  decisionSchema,
  replayAdminUpdateSchema,
  replayInputSchema,
  replayOccurrenceQuerySchema,
  replayProviderSchema,
  replayReportResolutionSchema,
  replayReportSchema,
  type ReplayInput,
  type ReplayProvider
} from '@wq-calendar/shared'
import { requireAuth, verifyMutation } from './auth'
import { audit } from './db'
import type { Env, SessionRecord } from './env'
import { sha256 } from './crypto'
import { apiError, readJson } from './http'
import { visibleMemberIdentity } from './identity'
import { requireRegionalAccess } from './access'

type CalendarApp = Hono<{ Bindings: Env; Variables: { session: SessionRecord } }>

type ReplayGroupRow = {
  id: string
  event_id: string | null
  occurrence_key: string | null
  title: string
  meeting_date: string
  created_at: number
  updated_at: number
}

type ReplayLinkRow = {
  id: string
  group_id: string
  provider: ReplayProvider
  share_url: string
  url_hash: string
  access_code: string
  note: string
  submitter_member_id: string | null
  status: 'pending' | 'published' | 'rejected' | 'disabled'
  review_note: string
  link_version: number
  created_by: string
  reviewed_by: string | null
  created_at: number
  updated_at: number
  approved_at: number | null
  disabled_at: number | null
  wq_id_hint: string | null
  wq_id_ciphertext: string | null
  public_wq_id: number | null
  open_report_count: number
  reported_by_me: number
  latest_report_reason?: string | null
  latest_report_note?: string | null
}

const PROVIDER_LABELS: Record<ReplayProvider, string> = {
  baidu: '百度网盘',
  quark: '夸克网盘',
  aliyun: '阿里云盘',
  onedrive: 'OneDrive',
  google_drive: 'Google Drive',
  dropbox: 'Dropbox',
  weiyun: '腾讯微云',
  other: '其他来源'
}

function hostnameMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

export function detectReplayProvider(value: string): ReplayProvider {
  const hostname = new URL(value).hostname.toLowerCase()
  if (hostnameMatches(hostname, 'pan.baidu.com') || hostnameMatches(hostname, 'yun.baidu.com')) return 'baidu'
  if (hostnameMatches(hostname, 'quark.cn')) return 'quark'
  if (hostnameMatches(hostname, 'aliyundrive.com') || hostnameMatches(hostname, 'alipan.com')) return 'aliyun'
  if (hostnameMatches(hostname, '1drv.ms') || hostnameMatches(hostname, 'onedrive.live.com') || hostnameMatches(hostname, 'sharepoint.com')) return 'onedrive'
  if (hostnameMatches(hostname, 'drive.google.com')) return 'google_drive'
  if (hostnameMatches(hostname, 'dropbox.com')) return 'dropbox'
  if (hostnameMatches(hostname, 'weiyun.com')) return 'weiyun'
  return 'other'
}

export function canonicalReplayUrl(value: string): string {
  const url = new URL(value)
  url.hostname = url.hostname.toLowerCase()
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString()
}

export function parseReplayOccurrenceFilter(eventId: string, occurrenceKey: string) {
  if (Boolean(eventId) !== Boolean(occurrenceKey)) return { success:false as const, reason:'pair' as const }
  if (!eventId && !occurrenceKey) return { success:true as const, data:null }
  const parsed = replayOccurrenceQuerySchema.safeParse({ eventId, occurrenceKey })
  if (!parsed.success) return { success:false as const, reason:'invalid' as const }
  return { success:true as const, data:parsed.data }
}

export function replayOccurrenceIdentity(eventId: string, occurrenceKey: string): string {
  return `${eventId}:${occurrenceKey}`
}

export async function publishedReplayOccurrenceKeys(env: Env, eventIds: string[]): Promise<Set<string>> {
  const uniqueEventIds = [...new Set(eventIds)]
  if (!uniqueEventIds.length) return new Set()

  const chunks = Array.from({ length:Math.ceil(uniqueEventIds.length / 80) }, (_, index) => uniqueEventIds.slice(index * 80, (index + 1) * 80))
  const statements = chunks.map((chunk) => {
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(', ')
    return env.DB.prepare(`
      SELECT DISTINCT rg.event_id, rg.occurrence_key
      FROM replay_groups rg
      WHERE rg.event_id IN (${placeholders}) AND rg.occurrence_key IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM replay_links rl
          WHERE rl.group_id = rg.id AND rl.status = 'published'
        )
    `).bind(...chunk)
  })
  const results = await env.DB.batch<{ event_id: string; occurrence_key: string }>(statements)
  return new Set(results.flatMap((result) => result.results.map((row) => replayOccurrenceIdentity(row.event_id, row.occurrence_key))))
}

function parsePage(value: string | undefined): number {
  const parsed = Number(value || 1)
  return Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : 1
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed')
}

async function serializeLink(row: ReplayLinkRow, env: Env, viewerRole: SessionRecord['role']) {
  const identity = await visibleMemberIdentity(row.submitter_member_id ? row : null, env, viewerRole)
  return {
    id: row.id,
    provider: row.provider,
    providerLabel: PROVIDER_LABELS[row.provider],
    shareUrl: row.share_url,
    accessCode: row.access_code,
    note: row.note,
    contributorWqId: identity.wqId,
    contributorHasFullWqId: identity.hasFullWqId,
    openReportCount: row.open_report_count || 0,
    reportedByMe: row.reported_by_me === 1
  }
}

async function publishedLinks(env: Env, groupIds: string[], memberId: string | null, viewerRole: SessionRecord['role']) {
  if (!groupIds.length) return new Map<string, Awaited<ReturnType<typeof serializeLink>>[]>()
  const placeholders = groupIds.map(() => '?').join(',')
  const result = await env.DB.prepare(`
    SELECT rl.*, m.wq_id_hint, m.wq_id_ciphertext, m.public_wq_id,
      (SELECT COUNT(*) FROM replay_reports rr
        WHERE rr.replay_link_id = rl.id AND rr.link_version = rl.link_version AND rr.status = 'open') AS open_report_count,
      EXISTS(SELECT 1 FROM replay_reports mine
        WHERE mine.replay_link_id = rl.id AND mine.reporter_member_id = ?
          AND mine.link_version = rl.link_version) AS reported_by_me
    FROM replay_links rl
    LEFT JOIN members m ON m.id = rl.submitter_member_id
    WHERE rl.status = 'published' AND rl.group_id IN (${placeholders})
    ORDER BY rl.created_at ASC, rl.id ASC
  `).bind(memberId || '', ...groupIds).all<ReplayLinkRow>()
  const mapped = await Promise.all(result.results.map(async (row) => ({ groupId: row.group_id, link: await serializeLink(row, env, viewerRole) })))
  const byGroup = new Map<string, Awaited<ReturnType<typeof serializeLink>>[]>()
  for (const item of mapped) byGroup.set(item.groupId, [...(byGroup.get(item.groupId) || []), item.link])
  return byGroup
}

async function ensureEventAssociation(env: Env, eventId: string | null, occurrenceKey: string | null): Promise<boolean> {
  if (!eventId && !occurrenceKey) return true
  if (!eventId || !occurrenceKey) return false
  const event = await env.DB.prepare("SELECT id FROM events WHERE id = ?1 AND status IN ('published', 'cancelled')").bind(eventId).first()
  return Boolean(event)
}

async function resolveGroup(env: Env, input: ReplayInput, memberSubmission: boolean): Promise<{ group: ReplayGroupRow | null; createId: string | null }> {
  if (input.groupId) {
    const publishedRequirement = memberSubmission ? "AND EXISTS (SELECT 1 FROM replay_links rl WHERE rl.group_id = rg.id AND rl.status = 'published')" : ''
    const group = await env.DB.prepare(`SELECT * FROM replay_groups rg WHERE rg.id = ?1 ${publishedRequirement}`).bind(input.groupId).first<ReplayGroupRow>()
    return { group: group || null, createId: null }
  }
  if (!await ensureEventAssociation(env, input.eventId, input.occurrenceKey)) return { group: null, createId: null }
  if (input.eventId && input.occurrenceKey) {
    const group = await env.DB.prepare('SELECT * FROM replay_groups WHERE event_id = ?1 AND occurrence_key = ?2').bind(input.eventId, input.occurrenceKey).first<ReplayGroupRow>()
    if (group) return { group, createId: null }
  }
  return { group: null, createId: crypto.randomUUID() }
}

async function createReplayLink(env: Env, input: ReplayInput, submitterMemberId: string | null, status: 'pending' | 'published', createdBy: string) {
  const canonicalUrl = canonicalReplayUrl(input.shareUrl)
  const urlHash = await sha256(canonicalUrl)
  const duplicate = await env.DB.prepare('SELECT id FROM replay_links WHERE url_hash = ?1').bind(urlHash).first()
  if (duplicate) throw new Error('DUPLICATE_REPLAY_URL')

  const resolved = await resolveGroup(env, input, Boolean(submitterMemberId))
  if (input.groupId && !resolved.group) throw new Error('REPLAY_GROUP_NOT_FOUND')
  if ((input.eventId || input.occurrenceKey) && !resolved.group && !resolved.createId) throw new Error('INVALID_REPLAY_EVENT')
  const groupId = resolved.group?.id || resolved.createId!
  const linkId = crypto.randomUUID()
  const now = Date.now()
  const linkStatement = env.DB.prepare(`
    INSERT INTO replay_links (
      id, group_id, provider, share_url, url_hash, access_code, note, submitter_member_id,
      status, review_note, link_version, created_by, reviewed_by, created_at, updated_at, approved_at, disabled_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, '', 1, ?10, ?11, ?12, ?12, ?13, NULL)
  `).bind(
    linkId, groupId, detectReplayProvider(canonicalUrl), canonicalUrl, urlHash, input.accessCode, input.note,
    submitterMemberId, status, createdBy, status === 'published' ? 'admin' : null, now,
    status === 'published' ? now : null
  )

  try {
    if (resolved.createId) {
      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO replay_groups (id, event_id, occurrence_key, title, meeting_date, created_at, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
        `).bind(groupId, input.eventId, input.occurrenceKey, input.title, input.meetingDate, now),
        linkStatement
      ])
    } else {
      await linkStatement.run()
    }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    const duplicateAfterRace = await env.DB.prepare('SELECT id FROM replay_links WHERE url_hash = ?1').bind(urlHash).first()
    if (duplicateAfterRace) throw new Error('DUPLICATE_REPLAY_URL')
    if (input.eventId && input.occurrenceKey) {
      const racedGroup = await env.DB.prepare('SELECT id FROM replay_groups WHERE event_id = ?1 AND occurrence_key = ?2').bind(input.eventId, input.occurrenceKey).first<{ id: string }>()
      if (racedGroup) {
        await env.DB.prepare(`
          INSERT INTO replay_links (
            id, group_id, provider, share_url, url_hash, access_code, note, submitter_member_id,
            status, review_note, link_version, created_by, reviewed_by, created_at, updated_at, approved_at, disabled_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, '', 1, ?10, ?11, ?12, ?12, ?13, NULL)
        `).bind(
          linkId, racedGroup.id, detectReplayProvider(canonicalUrl), canonicalUrl, urlHash, input.accessCode, input.note,
          submitterMemberId, status, createdBy, status === 'published' ? 'admin' : null, now,
          status === 'published' ? now : null
        ).run()
        return { linkId, groupId: racedGroup.id }
      }
    }
    throw error
  }
  return { linkId, groupId }
}

function replayCreateError(context: Parameters<typeof apiError>[0], error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'DUPLICATE_REPLAY_URL') return apiError(context, 409, 'DUPLICATE_REPLAY_URL', '该回放链接已收录或正在审核')
  if (message === 'REPLAY_GROUP_NOT_FOUND') return apiError(context, 404, 'REPLAY_GROUP_NOT_FOUND', '回放会议不存在或尚未发布')
  if (message === 'INVALID_REPLAY_EVENT') return apiError(context, 422, 'INVALID_REPLAY_EVENT', '关联的会议场次无效')
  console.error(JSON.stringify({ message: 'replay create failed', error: message }))
  return apiError(context, 500, 'REPLAY_SAVE_FAILED', '回放保存失败，请稍后重试')
}

export function registerReplayRoutes(app: CalendarApp) {
  app.get('/v1/replays', requireAuth(), requireRegionalAccess, async (context) => {
    const session = context.get('session')
    const requestedPage = parsePage(context.req.query('page'))
    const query = (context.req.query('q') || '').trim()
    if (query.length > 100) return apiError(context, 422, 'INVALID_QUERY', '搜索内容过长')
    const providerValue = context.req.query('provider') || ''
    const provider = providerValue ? replayProviderSchema.safeParse(providerValue) : null
    if (provider && !provider.success) return apiError(context, 422, 'INVALID_PROVIDER', '回放来源筛选无效')
    const from = context.req.query('from') || ''
    const to = context.req.query('to') || ''
    if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) {
      return apiError(context, 422, 'INVALID_DATE_RANGE', '会议日期范围无效')
    }
    const eventId = context.req.query('eventId') || ''
    const occurrenceKey = context.req.query('occurrenceKey') || ''
    const occurrenceFilter = parseReplayOccurrenceFilter(eventId, occurrenceKey)
    if (!occurrenceFilter.success) return apiError(context, 422, 'INVALID_OCCURRENCE_FILTER', occurrenceFilter.reason === 'pair' ? '会议和具体场次必须同时提供' : '会议场次筛选无效')

    const conditions = ["EXISTS (SELECT 1 FROM replay_links visible WHERE visible.group_id = rg.id AND visible.status = 'published')"]
    const values: string[] = []
    if (query) { conditions.push("rg.title LIKE ? ESCAPE '\\'"); values.push(`%${escapeLike(query)}%`) }
    if (provider?.success) {
      conditions.push("EXISTS (SELECT 1 FROM replay_links filtered WHERE filtered.group_id = rg.id AND filtered.status = 'published' AND filtered.provider = ?)")
      values.push(provider.data)
    }
    if (from) { conditions.push('rg.meeting_date >= ?'); values.push(from) }
    if (to) { conditions.push('rg.meeting_date <= ?'); values.push(to) }
    if (occurrenceFilter.data) {
      conditions.push('rg.event_id = ?', 'rg.occurrence_key = ?')
      values.push(occurrenceFilter.data.eventId, occurrenceFilter.data.occurrenceKey)
    }
    const where = `WHERE ${conditions.join(' AND ')}`
    const count = await context.env.DB.prepare(`SELECT COUNT(*) AS count FROM replay_groups rg ${where}`).bind(...values).first<{ count: number }>()
    const total = count?.count || 0
    const pageSize = 20
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const page = Math.min(requestedPage, totalPages)
    const groups = await context.env.DB.prepare(`
      SELECT rg.* FROM replay_groups rg ${where}
      ORDER BY rg.meeting_date DESC, rg.updated_at DESC, rg.id ASC
      LIMIT ? OFFSET ?
    `).bind(...values, pageSize, (page - 1) * pageSize).all<ReplayGroupRow>()
    const links = await publishedLinks(context.env, groups.results.map((group) => group.id), session.member_id, session.role)
    return context.json({
      groups: groups.results.map((group) => ({
        id: group.id, eventId: group.event_id, occurrenceKey: group.occurrence_key,
        title: group.title, meetingDate: group.meeting_date, links: links.get(group.id) || []
      })),
      pagination: { page, pageSize, total, totalPages }
    })
  })

  app.get('/v1/replays/:id', requireAuth(), requireRegionalAccess, async (context) => {
    const session = context.get('session')
    const group = await context.env.DB.prepare(`
      SELECT * FROM replay_groups rg WHERE rg.id = ?1
        AND EXISTS (SELECT 1 FROM replay_links rl WHERE rl.group_id = rg.id AND rl.status = 'published')
    `).bind(context.req.param('id')).first<ReplayGroupRow>()
    if (!group) return apiError(context, 404, 'NOT_FOUND', '回放不存在')
    const links = await publishedLinks(context.env, [group.id], session.member_id, session.role)
    return context.json({ replay: {
      id: group.id, eventId: group.event_id, occurrenceKey: group.occurrence_key,
      title: group.title, meetingDate: group.meeting_date, links: links.get(group.id) || []
    } })
  })

  app.post('/v1/replay-submissions', requireAuth('member'), requireRegionalAccess, async (context) => {
    const session = context.get('session')
    if (!await verifyMutation(context, session)) return apiError(context, 403, 'CSRF_FAILED', '安全校验失败')
    const parsed = replayInputSchema.safeParse(await readJson(context))
    if (!parsed.success) return apiError(context, 422, 'VALIDATION_ERROR', '请检查回放信息', parsed.error.flatten().fieldErrors as Record<string, string[]>)
    try {
      const created = await createReplayLink(context.env, parsed.data, session.member_id!, 'pending', session.member_id!)
      await audit(context.env, session, 'submit', 'replay_link', created.linkId, { groupId: created.groupId })
      return context.json({ submission: { id: created.linkId, groupId: created.groupId, status: 'pending' } }, 201)
    } catch (error) { return replayCreateError(context, error) }
  })

  app.get('/v1/replay-submissions/mine', requireAuth('member'), requireRegionalAccess, async (context) => {
    const session = context.get('session')
    const requestedPage = parsePage(context.req.query('page'))
    const pageSize = 20
    const count = await context.env.DB.prepare('SELECT COUNT(*) AS count FROM replay_links WHERE submitter_member_id = ?1').bind(session.member_id).first<{ count: number }>()
    const total = count?.count || 0
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const page = Math.min(requestedPage, totalPages)
    const result = await context.env.DB.prepare(`
      SELECT rl.*, rg.title, rg.meeting_date FROM replay_links rl
      JOIN replay_groups rg ON rg.id = rl.group_id
      WHERE rl.submitter_member_id = ?1
      ORDER BY rl.created_at DESC LIMIT ?2 OFFSET ?3
    `).bind(session.member_id, pageSize, (page - 1) * pageSize).all<ReplayLinkRow & { title: string; meeting_date: string }>()
    return context.json({
      submissions: result.results.map((row) => ({
        id: row.id, groupId: row.group_id, title: row.title, meetingDate: row.meeting_date,
        provider: row.provider, providerLabel: PROVIDER_LABELS[row.provider], shareUrl: row.share_url,
        accessCode: row.access_code, note: row.note, status: row.status, reviewNote: row.review_note,
        createdAt: new Date(row.created_at).toISOString(), approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null
      })),
      pagination: { page, pageSize, total, totalPages }
    })
  })

  app.post('/v1/replay-links/:id/reports', requireAuth('member'), requireRegionalAccess, async (context) => {
    const session = context.get('session')
    if (!await verifyMutation(context, session)) return apiError(context, 403, 'CSRF_FAILED', '安全校验失败')
    const parsed = replayReportSchema.safeParse(await readJson(context))
    if (!parsed.success) return apiError(context, 422, 'VALIDATION_ERROR', '失效反馈内容无效')
    const link = await context.env.DB.prepare("SELECT id, link_version FROM replay_links WHERE id = ?1 AND status = 'published'").bind(context.req.param('id')).first<{ id: string; link_version: number }>()
    if (!link) return apiError(context, 404, 'NOT_FOUND', '回放链接不存在或已经下架')
    try {
      const reportId = crypto.randomUUID()
      await context.env.DB.prepare(`
        INSERT INTO replay_reports (id, replay_link_id, reporter_member_id, link_version, reason, note, status, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'open', ?7)
      `).bind(reportId, link.id, session.member_id, link.link_version, parsed.data.reason, parsed.data.note, Date.now()).run()
      await audit(context.env, session, 'report', 'replay_link', link.id, { reason: parsed.data.reason, linkVersion: link.link_version })
      return context.json({ reportId }, 201)
    } catch (error) {
      if (isUniqueViolation(error)) return apiError(context, 409, 'ALREADY_REPORTED', '你已经反馈过这个版本的链接')
      throw error
    }
  })

  app.get('/v1/admin/replays', requireAuth('admin'), async (context) => {
    const filter = context.req.query('filter') || 'pending'
    if (!['pending', 'published', 'rejected', 'disabled', 'reports'].includes(filter)) return apiError(context, 422, 'INVALID_FILTER', '回放筛选无效')
    const requestedPage = parsePage(context.req.query('page'))
    const requestedPageSize = Number(context.req.query('pageSize') || 25)
    const pageSize = [25, 50, 100].includes(requestedPageSize) ? requestedPageSize : 25
    const condition = filter === 'reports'
      ? "EXISTS (SELECT 1 FROM replay_reports rr WHERE rr.replay_link_id = rl.id AND rr.link_version = rl.link_version AND rr.status = 'open')"
      : 'rl.status = ?'
    const values = filter === 'reports' ? [] : [filter]
    const count = await context.env.DB.prepare(`SELECT COUNT(*) AS count FROM replay_links rl WHERE ${condition}`).bind(...values).first<{ count: number }>()
    const total = count?.count || 0
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const page = Math.min(requestedPage, totalPages)
    const result = await context.env.DB.prepare(`
      SELECT rl.*, rg.title, rg.meeting_date, rg.event_id, rg.occurrence_key,
        m.wq_id_hint, m.wq_id_ciphertext, m.public_wq_id,
        (SELECT COUNT(*) FROM replay_reports rr WHERE rr.replay_link_id = rl.id
          AND rr.link_version = rl.link_version AND rr.status = 'open') AS open_report_count,
        0 AS reported_by_me,
        (SELECT rr.reason FROM replay_reports rr WHERE rr.replay_link_id = rl.id
          AND rr.link_version = rl.link_version AND rr.status = 'open' ORDER BY rr.created_at DESC LIMIT 1) AS latest_report_reason,
        (SELECT rr.note FROM replay_reports rr WHERE rr.replay_link_id = rl.id
          AND rr.link_version = rl.link_version AND rr.status = 'open' ORDER BY rr.created_at DESC LIMIT 1) AS latest_report_note
      FROM replay_links rl
      JOIN replay_groups rg ON rg.id = rl.group_id
      LEFT JOIN members m ON m.id = rl.submitter_member_id
      WHERE ${condition}
      ORDER BY rl.created_at DESC LIMIT ? OFFSET ?
    `).bind(...values, pageSize, (page - 1) * pageSize).all<ReplayLinkRow & { title: string; meeting_date: string; event_id: string | null; occurrence_key: string | null }>()
    const entries = await Promise.all(result.results.map(async (row) => {
      const identity = await visibleMemberIdentity(row.submitter_member_id ? row : null, context.env, 'admin')
      return {
        id: row.id, groupId: row.group_id, eventId: row.event_id, occurrenceKey: row.occurrence_key,
        title: row.title, meetingDate: row.meeting_date, provider: row.provider, providerLabel: PROVIDER_LABELS[row.provider],
        shareUrl: row.share_url, accessCode: row.access_code, note: row.note, status: row.status,
        reviewNote: row.review_note, contributorWqId: identity.wqId, openReportCount: row.open_report_count || 0,
        latestReportReason: row.latest_report_reason || null, latestReportNote: row.latest_report_note || null,
        createdAt: new Date(row.created_at).toISOString(), approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null
      }
    }))
    return context.json({ entries, pagination: { page, pageSize, total, totalPages } })
  })

  app.post('/v1/admin/replays', requireAuth('admin'), async (context) => {
    const session = context.get('session')
    if (!await verifyMutation(context, session)) return apiError(context, 403, 'CSRF_FAILED', '安全校验失败')
    const parsed = replayInputSchema.safeParse(await readJson(context))
    if (!parsed.success) return apiError(context, 422, 'VALIDATION_ERROR', '请检查回放信息', parsed.error.flatten().fieldErrors as Record<string, string[]>)
    try {
      const created = await createReplayLink(context.env, parsed.data, null, 'published', 'admin')
      await audit(context.env, session, 'create', 'replay_link', created.linkId, { groupId: created.groupId, status: 'published' })
      return context.json({ replayLinkId: created.linkId, groupId: created.groupId }, 201)
    } catch (error) { return replayCreateError(context, error) }
  })

  app.patch('/v1/admin/replay-links/:id', requireAuth('admin'), async (context) => {
    const session = context.get('session')
    if (!await verifyMutation(context, session)) return apiError(context, 403, 'CSRF_FAILED', '安全校验失败')
    const parsed = replayAdminUpdateSchema.safeParse(await readJson(context))
    if (!parsed.success) return apiError(context, 422, 'VALIDATION_ERROR', '请检查回放信息', parsed.error.flatten().fieldErrors as Record<string, string[]>)
    const current = await context.env.DB.prepare(`
      SELECT rl.*, rg.title, rg.meeting_date FROM replay_links rl JOIN replay_groups rg ON rg.id = rl.group_id WHERE rl.id = ?1
    `).bind(context.req.param('id')).first<ReplayLinkRow & { title: string; meeting_date: string }>()
    if (!current) return apiError(context, 404, 'NOT_FOUND', '回放链接不存在')
    let targetGroupId = current.group_id
    if (parsed.data.targetGroupId) {
      const target = await context.env.DB.prepare('SELECT id FROM replay_groups WHERE id = ?1').bind(parsed.data.targetGroupId).first<{ id: string }>()
      if (!target) return apiError(context, 404, 'TARGET_GROUP_NOT_FOUND', '目标回放会议不存在')
      targetGroupId = target.id
    }
    const canonicalUrl = canonicalReplayUrl(parsed.data.shareUrl)
    const urlHash = await sha256(canonicalUrl)
    const linkChanged = current.share_url !== canonicalUrl || current.access_code !== parsed.data.accessCode
    const now = Date.now()
    const statements: D1PreparedStatement[] = []
    if (!parsed.data.targetGroupId) {
      statements.push(context.env.DB.prepare('UPDATE replay_groups SET title = ?2, meeting_date = ?3, updated_at = ?4 WHERE id = ?1')
        .bind(current.group_id, parsed.data.title, parsed.data.meetingDate, now))
    }
    statements.push(context.env.DB.prepare(`
      UPDATE replay_links SET group_id = ?2, provider = ?3, share_url = ?4, url_hash = ?5,
        access_code = ?6, note = ?7, link_version = link_version + ?8, updated_at = ?9
      WHERE id = ?1
    `).bind(current.id, targetGroupId, detectReplayProvider(canonicalUrl), canonicalUrl, urlHash, parsed.data.accessCode, parsed.data.note, linkChanged ? 1 : 0, now))
    if (linkChanged) {
      statements.push(context.env.DB.prepare(`
        UPDATE replay_reports SET status = 'resolved', resolved_at = ?3, resolved_by = 'admin'
        WHERE replay_link_id = ?1 AND link_version = ?2 AND status = 'open'
      `).bind(current.id, current.link_version, now))
    }
    if (targetGroupId !== current.group_id) {
      statements.push(context.env.DB.prepare('DELETE FROM replay_groups WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM replay_links WHERE group_id = ?1)').bind(current.group_id))
    }
    try { await context.env.DB.batch(statements) }
    catch (error) {
      if (isUniqueViolation(error)) return apiError(context, 409, 'DUPLICATE_REPLAY_URL', '该回放链接已收录或正在审核')
      throw error
    }
    await audit(context.env, session, 'update', 'replay_link', current.id, { targetGroupId, linkChanged })
    return context.json({ updated: true, linkVersion: current.link_version + (linkChanged ? 1 : 0) })
  })

  app.post('/v1/admin/replay-links/:id/decision', requireAuth('admin'), async (context) => {
    const session = context.get('session')
    if (!await verifyMutation(context, session)) return apiError(context, 403, 'CSRF_FAILED', '安全校验失败')
    const parsed = decisionSchema.safeParse(await readJson(context))
    if (!parsed.success) return apiError(context, 422, 'VALIDATION_ERROR', '审批参数无效')
    const status = parsed.data.decision === 'publish' ? 'published' : 'rejected'
    const now = Date.now()
    const result = await context.env.DB.prepare(`
      UPDATE replay_links SET status = ?2, review_note = ?3, reviewed_by = 'admin', updated_at = ?4,
        approved_at = CASE WHEN ?2 = 'published' AND approved_at IS NULL THEN ?4 ELSE approved_at END
      WHERE id = ?1 AND status = 'pending'
    `).bind(context.req.param('id'), status, parsed.data.reviewNote, now).run()
    if (!result.meta.changes) return apiError(context, 409, 'ALREADY_REVIEWED', '该回放投稿已经处理')
    await audit(context.env, session, parsed.data.decision, 'replay_link', context.req.param('id'), { reviewNote: parsed.data.reviewNote })
    return context.json({ status })
  })

  app.post('/v1/admin/replay-links/:id/disable', requireAuth('admin'), async (context) => {
    const session = context.get('session')
    if (!await verifyMutation(context, session)) return apiError(context, 403, 'CSRF_FAILED', '安全校验失败')
    const now = Date.now()
    const result = await context.env.DB.prepare("UPDATE replay_links SET status = 'disabled', disabled_at = ?2, updated_at = ?2 WHERE id = ?1 AND status = 'published'").bind(context.req.param('id'), now).run()
    if (!result.meta.changes) return apiError(context, 409, 'INVALID_STATE', '只有已发布回放可以下架')
    await audit(context.env, session, 'disable', 'replay_link', context.req.param('id'))
    return context.json({ status: 'disabled' })
  })

  app.post('/v1/admin/replay-links/:id/restore', requireAuth('admin'), async (context) => {
    const session = context.get('session')
    if (!await verifyMutation(context, session)) return apiError(context, 403, 'CSRF_FAILED', '安全校验失败')
    const result = await context.env.DB.prepare("UPDATE replay_links SET status = 'published', disabled_at = NULL, updated_at = ?2 WHERE id = ?1 AND status = 'disabled'").bind(context.req.param('id'), Date.now()).run()
    if (!result.meta.changes) return apiError(context, 409, 'INVALID_STATE', '只有已下架回放可以恢复')
    await audit(context.env, session, 'restore', 'replay_link', context.req.param('id'))
    return context.json({ status: 'published' })
  })

  app.post('/v1/admin/replay-groups/:id/merge', requireAuth('admin'), async (context) => {
    const session = context.get('session')
    if (!await verifyMutation(context, session)) return apiError(context, 403, 'CSRF_FAILED', '安全校验失败')
    const raw = await readJson(context) as { targetGroupId?: unknown }
    const targetGroupId = typeof raw.targetGroupId === 'string' ? raw.targetGroupId : ''
    const sourceId = context.req.param('id')
    if (!targetGroupId || targetGroupId === sourceId) return apiError(context, 422, 'INVALID_TARGET_GROUP', '请选择其他目标回放会议')
    const [source, target] = await Promise.all([
      context.env.DB.prepare('SELECT id FROM replay_groups WHERE id = ?1').bind(sourceId).first(),
      context.env.DB.prepare('SELECT id FROM replay_groups WHERE id = ?1').bind(targetGroupId).first()
    ])
    if (!source) return apiError(context, 404, 'NOT_FOUND', '待合并回放会议不存在')
    if (!target) return apiError(context, 404, 'TARGET_GROUP_NOT_FOUND', '目标回放会议不存在')
    const now = Date.now()
    await context.env.DB.batch([
      context.env.DB.prepare('UPDATE replay_links SET group_id = ?2, updated_at = ?3 WHERE group_id = ?1').bind(sourceId, targetGroupId, now),
      context.env.DB.prepare('UPDATE replay_groups SET updated_at = ?2 WHERE id = ?1').bind(targetGroupId, now),
      context.env.DB.prepare('DELETE FROM replay_groups WHERE id = ?1').bind(sourceId)
    ])
    await audit(context.env, session, 'merge', 'replay_group', sourceId, { targetGroupId })
    return context.json({ merged: true, targetGroupId })
  })

  app.post('/v1/admin/replay-links/:id/reports/resolve', requireAuth('admin'), async (context) => {
    const session = context.get('session')
    if (!await verifyMutation(context, session)) return apiError(context, 403, 'CSRF_FAILED', '安全校验失败')
    const parsed = replayReportResolutionSchema.safeParse(await readJson(context))
    if (!parsed.success) return apiError(context, 422, 'VALIDATION_ERROR', '反馈处理参数无效')
    const link = await context.env.DB.prepare('SELECT link_version FROM replay_links WHERE id = ?1').bind(context.req.param('id')).first<{ link_version: number }>()
    if (!link) return apiError(context, 404, 'NOT_FOUND', '回放链接不存在')
    const result = await context.env.DB.prepare(`
      UPDATE replay_reports SET status = ?3, resolved_at = ?4, resolved_by = 'admin'
      WHERE replay_link_id = ?1 AND link_version = ?2 AND status = 'open'
    `).bind(context.req.param('id'), link.link_version, parsed.data.resolution, Date.now()).run()
    if (!result.meta.changes) return apiError(context, 409, 'NO_OPEN_REPORTS', '当前没有待处理反馈')
    await audit(context.env, session, parsed.data.resolution, 'replay_report', context.req.param('id'), { linkVersion: link.link_version })
    return context.json({ resolved: result.meta.changes })
  })
}

export { PROVIDER_LABELS }
