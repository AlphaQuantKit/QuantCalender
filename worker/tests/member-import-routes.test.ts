import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import worker from '../src/index'
import { decryptWqId, hmacSha256, sha256 } from '../src/crypto'
import type { Env } from '../src/env'
import { hashMemberPassword, verifyMemberPassword } from '../src/passwords'
import { replaceMemberPassword } from '../src/member-passwords'
import { createSession, currentSession } from '../src/auth'
import { Hono } from 'hono'

// Real SQLite SQL + transaction semantics, with D1's Free-tier per-request
// query budget and per-statement binding limit enforced by the transport.
let queryCount = 0
let maxBoundParameters = 0
class Statement {
  values: SQLInputValue[] = []
  constructor(readonly db: DatabaseSync, readonly sql: string) {}
  bind(...values: SQLInputValue[]) { this.values = values; return this }
  execute() {
    if (++queryCount > 50) throw new Error('D1_ERROR: Too many SQL queries')
    maxBoundParameters = Math.max(maxBoundParameters, this.values.length)
    if (this.values.length > 100) throw new Error('D1_ERROR: too many SQL variables')
    const values: SQLInputValue[] = []
    let index = 0
    const sql = this.sql.replace(/\?(\d+)?/g, (_, number: string | undefined) => {
      const position = number ? Number(number) : index + 1
      index = Math.max(index, position)
      values.push(this.values[position - 1]!)
      return '?'
    })
    return { statement: this.db.prepare(sql), values }
  }
  async first() { const { statement, values } = this.execute(); return statement.get(...values) || null }
  async all() { const { statement, values } = this.execute(); return { results: statement.all(...values), success: true } }
  async run() { const { statement, values } = this.execute(); return { success: true, meta: statement.run(...values) } }
}

let db: DatabaseSync
let env: Env
const syncToken = 'test-sync-token-012345678901234567890123456789'
const machine = { authorization: `Bearer ${syncToken}` }
const adminHeaders = { cookie: 'wq_session=test-admin', origin: 'https://calendar.test', 'x-csrf-token': 'test-csrf' }
const base = '/v1/automation/member-imports'

async function call(path: string, body?: unknown, headers: Record<string, string> = machine) {
  queryCount = 0
  maxBoundParameters = 0
  return worker.fetch(new Request(`https://api.test${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }), env)
}

async function create(expectedRows = 1) {
  const response = await call(base, { expectedRows, boardDate: '2026-09-25' })
  expect(response.status).toBe(201)
  return (await response.json() as { importId: string }).importId
}

async function stage(id: string, wqId = 'GLOBAL01', country = 'US') {
  return call(`${base}/${id}/rows`, { rows: [{ wqId, country }] })
}

async function seedMember(id = 'existing', country = 'HK') {
  db.prepare(`INSERT INTO members (id, wq_id_hash, wq_id_hint, country, record_date, created_at, updated_at, public_wq_id)
    VALUES (?, ?, 'hint', ?, '2026-09-24', 1, 2, 0)`).run(id, await hmacSha256(id.toUpperCase(), env.WQ_ID_HMAC_SECRET), country)
  db.prepare(`INSERT INTO sessions (id, token_hash, csrf_hash, member_id, role, expires_at, created_at, last_seen_at) VALUES (?, ?, 'csrf', ?, 'member', ?, 1, ?)`)
    .run(`s-${id}`, `token-${id}`, id, Date.now() + 100000, Date.now())
  db.prepare(`INSERT INTO calendar_tokens (id, member_id, token_hash, alarm_minutes, created_at, updated_at) VALUES (?, ?, ?, 30, 1, 2)`)
    .run(`feed-${id}`, id, `feed-token-${id}`)
}

beforeEach(async () => {
  queryCount = 0
  maxBoundParameters = 0
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
    db.exec('BEGIN;\n' + readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8') + '\nCOMMIT;')
  }
  // This adapter intentionally implements only the D1 APIs exercised by the app.
  const transport = {
    prepare: (sql: string) => new Statement(db, sql),
    async batch(statements: Statement[]) {
      db.exec('BEGIN')
      try { const results = await Promise.all(statements.map(statement => statement.run())); db.exec('COMMIT'); return results }
      catch (error) { db.exec('ROLLBACK'); throw error }
    }
  }
  env = { DB: transport as unknown as D1Database, APP_ENV: 'production', ALLOWED_ORIGINS: 'https://calendar.test',
    API_BASE_URL: 'https://api.test', ADMIN_WQ_ID: 'ADMIN', ADMIN_PASSWORD_HASH: 'test-hash', WQ_ID_HMAC_SECRET: 'test-identity-secret',
    SESSION_SECRET: 'test-session-secret', TURNSTILE_SECRET: '', MEMBER_SYNC_TOKEN: syncToken }
  const now = Date.now()
  // development cookie for these tests, with production-like route checks intact.
  env.APP_ENV = 'test'
  db.prepare('INSERT INTO sessions (id, token_hash, csrf_hash, member_id, role, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)').run('admin',
    await hmacSha256('test-admin', `${env.SESSION_SECRET}:admin:TEST-HASH`), await sha256('test-csrf'), 'admin', now + 1000000, now, now)
})

async function memberLogin(wqId = 'EXISTING', password = wqId) {
  const response = await call('/v1/session/member', { wqId, password }, {})
  const data = await response.json() as { csrfToken?: string; user?: { passwordChangeRequired: boolean } }
  return { response, data, headers: { cookie: response.headers.get('set-cookie')?.split(';')[0] || '',
    origin: 'https://calendar.test', 'x-csrf-token': data.csrfToken || '' } }
}

describe('member passwords', () => {
  it('rejects passwordless sessions inserted by the old Worker after migration', async () => {
    await seedMember()
    db.prepare(`UPDATE sessions SET token_hash = ? WHERE id = 's-existing'`)
      .run(await hmacSha256('late-passwordless-token', `${env.SESSION_SECRET}:member`))
    expect(db.prepare("SELECT password_version FROM sessions WHERE id='s-existing'").get()?.password_version).toBe(-1)
    expect((await call('/v1/me', undefined, { cookie: 'wq_session=late-passwordless-token' })).status).toBe(401)
    expect((await memberLogin()).response.status).toBe(200)
  })

  it('requires a password, verifies the initial WQ_ID, and returns the reminder after reload', async () => {
    await seedMember()
    expect((await call('/v1/session/member', { wqId: 'EXISTING' }, {})).status).toBe(422)
    expect((await memberLogin('EXISTING', 'wrong')).response.status).toBe(401)
    const login = await memberLogin('existing', 'existing')
    expect(login.response.status).toBe(200)
    expect(login.data.user?.passwordChangeRequired).toBe(true)
    const me = await call('/v1/me', undefined, login.headers)
    expect((await me.json() as { user: { passwordChangeRequired: boolean } }).user.passwordChangeRequired).toBe(true)
  })

  it('changes a password, revokes all member sessions, and retains subscriptions', async () => {
    await seedMember()
    const first = await memberLogin()
    const second = await memberLogin()
    const changed = await call('/v1/me/password', { currentPassword: 'EXISTING', newPassword: 'unique long Password!1' }, first.headers)
    expect(changed.status).toBe(200)
    expect((await call('/v1/me', undefined, first.headers)).status).toBe(401)
    expect((await call('/v1/me', undefined, second.headers)).status).toBe(401)
    expect((await memberLogin()).response.status).toBe(401)
    expect((await memberLogin('EXISTING', 'unique long password!1')).response.status).toBe(401)
    const fresh = await memberLogin('EXISTING', 'unique long Password!1')
    expect(fresh.response.status).toBe(200)
    expect(fresh.data.user?.passwordChangeRequired).toBe(false)
    expect(db.prepare('SELECT revoked_at FROM calendar_tokens').get()?.revoked_at).toBeNull()
    expect((await call('/v1/admin/audit', undefined, adminHeaders)).status).toBe(200)
    const stored = String(db.prepare('SELECT password_hash FROM members').get()?.password_hash)
    expect(stored).toMatch(/^pbkdf2-sha256-v1\$100000\$/)
    expect(stored).not.toContain('unique long')
    expect(JSON.stringify(db.prepare('SELECT * FROM audit_logs').all())).not.toContain('unique long')
  })

  it('does not change a password on wrong current password, weak new password or missing CSRF', async () => {
    await seedMember('longmemberid01')
    const login = await memberLogin('LONGMEMBERID01')
    const valid = { currentPassword: 'LONGMEMBERID01', newPassword: 'brand new password' }
    expect((await call('/v1/me/password', valid, { cookie: login.headers.cookie })).status).toBe(403)
    expect((await call('/v1/me/password', { ...valid, currentPassword: 'wrong' }, login.headers)).status).toBe(401)
    expect((await call('/v1/me/password', { ...valid, newPassword: 'short' }, login.headers)).status).toBe(422)
    expect((await call('/v1/me/password', { ...valid, newPassword: 'longmemberid01' }, login.headers)).status).toBe(422)
    expect((await call('/v1/me', undefined, login.headers)).status).toBe(200)
    expect(db.prepare('SELECT password_hash FROM members').get()?.password_hash).toBeNull()
  })

  it('allows admins to set and reset exactly one password, including legacy members without encrypted IDs', async () => {
    await seedMember(); await seedMember('other')
    const old = await memberLogin()
    const other = await memberLogin('OTHER')
    const url = '/v1/admin/members/existing/password'
    expect((await call(url, { action: 'set', newPassword: 'admin assigned password' }, adminHeaders)).status).toBe(200)
    expect((await call('/v1/me', undefined, old.headers)).status).toBe(401)
    expect((await call('/v1/me', undefined, other.headers)).status).toBe(200)
    const custom = await memberLogin('EXISTING', 'admin assigned password')
    expect(custom.response.status).toBe(200)
    expect(custom.data.user?.passwordChangeRequired).toBe(false)
    db.exec("UPDATE members SET wq_id_ciphertext=NULL WHERE id='existing'")
    expect((await call(url, { action: 'reset' }, adminHeaders)).status).toBe(200)
    expect((await call('/v1/me', undefined, custom.headers)).status).toBe(401)
    expect((await memberLogin()).data.user?.passwordChangeRequired).toBe(true)
    expect((await memberLogin('EXISTING', 'admin assigned password')).response.status).toBe(401)
    expect(db.prepare('SELECT COUNT(*) AS n FROM calendar_tokens WHERE revoked_at IS NULL').get()?.n).toBe(2)
    expect(db.prepare("SELECT action FROM audit_logs WHERE entity_id='existing' ORDER BY created_at").all().map(row => row.action)).toEqual(['set_member_password', 'reset_member_password'])
  })

  it('prevents members, machine tokens, unauthenticated callers and bad origins from resetting passwords', async () => {
    await seedMember()
    const login = await memberLogin()
    const url = '/v1/admin/members/existing/password'
    for (const [headers, status] of [[{}, 401], [machine, 401], [login.headers, 403], [{ ...adminHeaders, origin: 'https://evil.test' }, 403]] as const) {
      expect((await call(url, { action: 'reset' }, headers)).status).toBe(status)
    }
    expect((await call('/v1/admin/members/missing/password', { action: 'reset' }, adminHeaders)).status).toBe(404)
    expect((await call(url, { action: 'set', newPassword: 'short' }, adminHeaders)).status).toBe(422)
    expect((await call(url, { action: 'reset', newPassword: 'injected password' }, adminHeaders)).status).toBe(422)
    expect(db.prepare('SELECT password_version FROM members').get()?.password_version).toBe(0)
  })

  it('does not reactivate disabled users when an admin resets a password', async () => {
    await seedMember()
    db.exec('UPDATE members SET active=0')
    expect((await call('/v1/admin/members/existing/password', { action: 'reset' }, adminHeaders)).status).toBe(200)
    expect((await memberLogin()).response.status).toBe(401)
    expect(db.prepare('SELECT active FROM members').get()?.active).toBe(0)
  })

  it('preserves custom passwords across platform sync and manual CSV replacement', async () => {
    await seedMember()
    await call('/v1/admin/members/existing/password', { action: 'set', newPassword: 'preserved Password!1' }, adminHeaders)
    const original = db.prepare('SELECT password_hash, password_version FROM members').get()
    const id = await create()
    await stage(id, 'EXISTING', 'US')
    await call(`${base}/${id}/commit`, {})
    const created = await call('/v1/admin/member-imports', {}, adminHeaders)
    const { importId } = await created.json() as { importId: string }
    await call(`/v1/admin/member-imports/${importId}/rows`, { rows: [{ wqId: 'EXISTING', country: 'IN' }] }, adminHeaders)
    await call(`/v1/admin/member-imports/${importId}/commit`, {}, adminHeaders)
    expect(db.prepare('SELECT password_hash, password_version FROM members').get()).toEqual(original)
    expect((await memberLogin('EXISTING', 'preserved Password!1')).response.status).toBe(200)
    expect((await memberLogin()).response.status).toBe(401)
  })

  it('rejects password-change races and stale-version login/session creation', async () => {
    await seedMember()
    const login = await memberLogin()
    const inspect = new Hono()
    let actor: Awaited<ReturnType<typeof currentSession>> = null
    inspect.get('/', async context => { actor = await currentSession(context); return context.json({}) })
    await inspect.request('https://api.test/', { headers: login.headers }, env)
    const staleMember = { id: 'existing', wq_id_hash: await hmacSha256('EXISTING', env.WQ_ID_HMAC_SECRET), password_hash: null, password_version: 0 }
    await call('/v1/admin/members/existing/password', { action: 'set', newPassword: 'replacement secret' }, adminHeaders)
    expect(await replaceMemberPassword(env, staleMember, null, actor!)).toBe(false)
    const attempt = new Hono()
    attempt.post('/', async context => context.json({ created: await createSession(context, 'member', 'existing', 0) }))
    const response = await attempt.request('https://api.test/', { method: 'POST' }, env)
    expect(await response.json()).toEqual({ created: null })
    expect(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE member_id='existing'").get()?.n).toBe(0)
    expect(db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get()?.n).toBe(1)
  })

  it('limits member login attempts across IP addresses and self-service current-password guesses', async () => {
    await seedMember()
    const login = await memberLogin()
    for (let i = 0; i < 10; i++) {
      expect((await call('/v1/me/password', { currentPassword: 'wrong', newPassword: 'a valid new password' }, login.headers)).status).toBe(401)
    }
    expect((await call('/v1/me/password', { currentPassword: 'EXISTING', newPassword: 'a valid new password' }, login.headers)).status).toBe(429)
    for (let i = 0; i < 14; i++) {
      expect((await call('/v1/session/member', { wqId: 'EXISTING', password: 'wrong' }, { 'cf-connecting-ip': `192.0.2.${i}` })).status).toBe(401)
    }
    expect((await memberLogin()).response.status).toBe(429)
  })

  it('salts hashes independently, uses a server pepper and fails closed on malformed hashes', async () => {
    const first = await hashMemberPassword('test password 123', 'pepper')
    const second = await hashMemberPassword('test password 123', 'pepper')
    expect(first).not.toBe(second)
    expect(await verifyMemberPassword('test password 123', first, '', 'pepper')).toBe(true)
    expect(await verifyMemberPassword('test password 123', first, '', 'wrong-pepper')).toBe(false)
    expect(await verifyMemberPassword('anything', 'malformed', '', 'pepper')).toBe(false)
  })
})
afterEach(() => db.close())

describe('member import routes', () => {
  it('fails closed without a configured secret or with the wrong token', async () => {
    expect((await call(base, {}, {})).status).toBe(401)
    expect((await call(base, {}, { authorization: 'Bearer incorrect' })).status).toBe(401)
    env.MEMBER_SYNC_TOKEN = undefined
    expect((await call(base, {})).status).toBe(401)
  })

  it.each(['read', 'write'])('reports exhausted D1 daily %s quota without leaking the database error', async (operation) => {
    env.DB.prepare = () => { throw new Error(`D1_ERROR: Your account has exceeded D1's free tier daily row ${operation} limit. private diagnostic`) }
    const response = await call(base, { expectedRows: 1, boardDate: '2026-09-25' })
    expect(response.status).toBe(503)
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(Number(response.headers.get('Retry-After'))).toBeLessThanOrEqual(86400)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('D1_DAILY_LIMIT')
    expect(JSON.stringify(body)).not.toContain('private diagnostic')
  })

  it('does not grant admin access or bypass manual CSRF checks', async () => {
    expect((await call('/v1/admin/member-imports', {})).status).toBe(401)
    expect((await call('/v1/admin/audit')).status).toBe(401)
    expect((await call('/v1/admin/member-imports', {}, { cookie: adminHeaders.cookie })).status).toBe(403)
    expect((await call('/v1/admin/member-imports', {}, adminHeaders)).status).toBe(201)
  })

  it('validates counts, dates and uploaded rows', async () => {
    expect((await call(base, { expectedRows: 0, boardDate: '2026-09-25' })).status).toBe(422)
    expect((await call(base, { expectedRows: 1, boardDate: '2026-02-30' })).status).toBe(422)
    const id = await create()
    expect((await stage(id, 'TEST01', 'USA')).status).toBe(422)
    expect((await call(`${base}/${id}/rows`, { rows: Array(101).fill({ wqId: 'TEST01', country: 'US' }) })).status).toBe(422)
    expect((await call(`${base}/${id}/commit`, {})).status).toBe(409)
  })

  it('rejects incomplete imports without changing live members', async () => {
    await seedMember()
    const id = await create(2)
    await stage(id)
    expect((await call(`${base}/${id}/commit`, {})).status).toBe(409)
    expect(db.prepare('SELECT COUNT(*) AS n FROM members').get()?.n).toBe(1)
  })

  it.each(['platform', 'manual'] as const)('stages and retries 100 %s rows within D1 limits', async (source) => {
    const prefix = source === 'platform' ? base : '/v1/admin/member-imports'
    const headers = source === 'platform' ? machine : adminHeaders
    const created = await call(prefix, { expectedRows: 100, boardDate: '2026-09-25' }, headers)
    const { importId } = await created.json() as { importId: string }
    const rows = Array.from({ length: 100 }, (_, index) => ({ wqId: `BATCH${index.toString().padStart(3, '0')}`, country: 'US' }))
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await call(`${prefix}/${importId}/rows`, { rows }, headers)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ stagedRows: 100 })
      expect(queryCount).toBeLessThanOrEqual(10)
      expect(maxBoundParameters).toBeLessThanOrEqual(100)
      expect(db.prepare('SELECT COUNT(*) AS n FROM members').get()?.n).toBe(0)
    }
    expect((await call(`${prefix}/${importId}/commit`, {}, headers)).status).toBe(200)
    expect(db.prepare('SELECT COUNT(*) AS n FROM members').get()?.n).toBe(100)
    for (const row of rows) {
      const stored = db.prepare('SELECT wq_id_ciphertext FROM members WHERE wq_id_hash = ?')
        .get(await hmacSha256(row.wqId, env.WQ_ID_HMAC_SECRET))
      expect(await decryptWqId(String(stored?.wq_id_ciphertext), env.WQ_ID_HMAC_SECRET)).toBe(row.wqId)
    }
  })

  it('rolls back the entire chunk if a later insert fails, then permits a retry', async () => {
    const id = await create(101)
    await stage(id)
    db.exec(`CREATE TRIGGER reject_test_country BEFORE INSERT ON member_import_rows
      WHEN NEW.country = 'ZZ' BEGIN SELECT RAISE(ABORT, 'synthetic insert failure'); END;`)
    const rows = Array.from({ length: 100 }, (_, index) => ({ wqId: `ROLLBACK${index}`, country: index === 99 ? 'ZZ' : 'US' }))
    expect((await call(`${base}/${id}/rows`, { rows })).status).toBe(500)
    expect(db.prepare('SELECT total_rows FROM member_imports WHERE id = ?').get(id)?.total_rows).toBe(1)
    expect(db.prepare('SELECT COUNT(*) AS n FROM member_import_rows WHERE import_id = ?').get(id)?.n).toBe(1)
    expect((await call(`${base}/${id}/commit`, {})).status).toBe(409)
    rows[99]!.country = 'US'
    const retry = await call(`${base}/${id}/rows`, { rows })
    expect(retry.status).toBe(200)
    expect(await retry.json()).toEqual({ stagedRows: 101 })
  })

  it('counts normalized duplicates and overlapping chunks once while retaining the last update', async () => {
    const id = await create(2)
    await stage(id, 'DUP01', 'US')
    const response = await call(`${base}/${id}/rows`, { rows: [
      { wqId: 'dup01', country: 'GB' }, { wqId: 'NEW01', country: 'SG' },
      { wqId: 'DUP01', country: 'IN' }, { wqId: 'new01', country: 'HK' }
    ] })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ stagedRows: 2 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM member_import_rows').get()?.n).toBe(2)
    expect((await call(`${base}/${id}/commit`, {})).status).toBe(200)
    expect(db.prepare('SELECT country FROM members ORDER BY country').all().map(row => row.country)).toEqual(['HK', 'IN'])
  })

  it('merges worldwide members, encrypts IDs, preserves sessions and privacy, and commits idempotently', async () => {
    await seedMember()
    await seedMember('updated')
    const id = await create(2)
    await stage(id)
    await stage(id, 'UPDATED', 'IN')
    await stage(id, 'UPDATED', 'IN') // safe chunk retry
    expect((await call(`${base}/${id}/commit`, {})).status).toBe(200)
    const rows = db.prepare('SELECT * FROM members ORDER BY country').all()
    expect(rows.map(row => row.country)).toEqual(['HK', 'IN', 'US'])
    expect(rows[1]?.id).toBe('updated')
    expect(rows[1]?.public_wq_id).toBe(0)
    expect(await decryptWqId(String(rows[2]?.wq_id_ciphertext), env.WQ_ID_HMAC_SECRET)).toBe('GLOBAL01')
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()?.n).toBe(3)
    expect(db.prepare('SELECT COUNT(*) AS n FROM calendar_tokens WHERE revoked_at IS NULL').get()?.n).toBe(2)
    expect((await call(`${base}/${id}/commit`, {})).status).toBe(200)
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='sync_members'").get()?.n).toBe(1)
    expect((await stage(id, 'LATE01')).status).toBe(409)
    expect((await call(`${base}/${id}`)).status).toBe(200)
  })

  it('keeps manual replacement and session/feed revocation behavior', async () => {
    await seedMember()
    const prefix = '/v1/admin/member-imports'
    const created = await call(prefix, {}, adminHeaders)
    const { importId } = await created.json() as { importId: string }
    expect((await call(`${prefix}/${importId}/rows`, { rows: [{ wqId: 'GLOBAL01', country: 'US' }] }, adminHeaders)).status).toBe(200)
    expect((await call(`${prefix}/${importId}/commit`, {}, adminHeaders)).status).toBe(200)
    expect(db.prepare("SELECT active FROM members WHERE id='existing'").get()?.active).toBe(0)
    expect(db.prepare("SELECT id FROM sessions WHERE member_id='existing'").get()).toBeUndefined()
    expect(db.prepare("SELECT revoked_at FROM calendar_tokens WHERE member_id='existing'").get()?.revoked_at).toBeGreaterThan(0)
  })

  it('cannot access or commit a manual batch through machine endpoints', async () => {
    const result = await call('/v1/admin/member-imports', {}, adminHeaders)
    const { importId } = await result.json() as { importId: string }
    expect((await stage(importId)).status).toBe(409)
    expect((await call(`${base}/${importId}`)).status).toBe(404)
    expect((await call(`${base}/${importId}/commit`, {})).status).toBe(409)
  })

  it('allows a non-CN/HK active member to log in, but not an inactive member', async () => {
    await seedMember('global01', 'US')
    expect((await call('/v1/session/member', { wqId: 'GLOBAL01', password: 'GLOBAL01' }, {})).status).toBe(200)
    db.exec("UPDATE members SET active=0 WHERE id='global01'")
    expect((await call('/v1/session/member', { wqId: 'GLOBAL01', password: 'GLOBAL01' }, {})).status).toBe(401)
  })
})
