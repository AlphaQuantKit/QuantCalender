// Runs only against an ephemeral local workerd/D1 instance with synthetic data.
// Build the Worker first. No .dev.vars, Cloudflare account or network APIs used.
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const wranglerRequire = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare } = wranglerRequire('miniflare')
const origin = 'https://calendar.test'
const secret = 'local-runtime-test-identity-secret'
const adminPassword = 'local-runtime-test-admin-password'
const customPassword = 'local-runtime-test-member-password'
const adminAssignedPassword = 'local-runtime-test-assigned-password'
const hmac = value => createHmac('sha256', secret).update(value).digest('hex')
const mf = new Miniflare({
  modules: true,
  scriptPath: fileURLToPath(new URL('../dist/index.js', import.meta.url)),
  compatibilityDate: '2026-07-23',
  compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'],
  d1Persist: false,
  bindings: {
    APP_ENV: 'test', ALLOWED_ORIGINS: origin, API_BASE_URL: 'https://api.test',
    ADMIN_WQ_ID: 'ADMIN', ADMIN_PASSWORD_HASH: createHash('sha256').update(adminPassword).digest('hex'),
    SESSION_SECRET: 'local-runtime-test-session-secret', WQ_ID_HMAC_SECRET: secret, TURNSTILE_SECRET: ''
  },
  outboundService: () => new Response('External requests disabled in runtime test', { status: 503 })
})

async function request(path, body, headers = {}) {
  return mf.dispatchFetch(`https://api.test${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
}

async function login(wqId, password = wqId, role = 'member') {
  const response = await request(`/v1/session/${role}`, { wqId, password })
  assert.equal(response.status, 200, `${role} login`)
  const data = await response.json()
  return { data, headers: { cookie: response.headers.get('set-cookie').split(';')[0], origin, 'x-csrf-token': data.csrfToken } }
}

try {
  const db = await mf.getD1Database('DB')
  const migrations = new URL('../migrations/', import.meta.url)
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    if (name === '0010_member_passwords.sql') {
      // Exercise the upgrade from passwordless member sessions, not just a fresh DB.
      await db.prepare(`INSERT INTO members (id, wq_id_hash, wq_id_hint, country, record_date, created_at, updated_at)
        VALUES ('m1', ?, 'LOCAL01', 'US', '2026-09-26', 1, 1)`).bind(hmac('LOCAL01')).run()
      await db.prepare(`INSERT INTO sessions (id, token_hash, csrf_hash, member_id, role, expires_at, created_at, last_seen_at)
        VALUES ('legacy-member', 'old-member-token', 'old-csrf', 'm1', 'member', ?, 1, 1),
          ('legacy-admin', 'old-admin-token', 'old-csrf', NULL, 'admin', ?, 1, 1)`)
        .bind(Date.now() + 1000000, Date.now() + 1000000).run()
      await db.prepare(`INSERT INTO calendar_tokens (id, member_id, token_hash, created_at, updated_at)
        VALUES ('feed', 'm1', 'feed-token', 1, 1)`).run()
    }
    // These migrations have no semicolons inside SQL strings or block comments.
    const sql = (await readFile(new URL(name, migrations), 'utf8')).replace(/^\s*--.*$/gm, '')
    await db.batch(sql.split(';').map(value => value.trim()).filter(Boolean).map(value => db.prepare(value)))
  }
  assert.equal((await db.prepare("SELECT count(*) AS n FROM sessions WHERE role='member'").first()).n, 0)
  assert.equal((await db.prepare("SELECT count(*) AS n FROM sessions WHERE role='admin'").first()).n, 1)
  assert.equal((await db.prepare('SELECT revoked_at FROM calendar_tokens').first()).revoked_at, null)
  await db.prepare(`INSERT INTO sessions (id, token_hash, csrf_hash, member_id, role, expires_at, created_at, last_seen_at)
    VALUES ('late-passwordless', ?, 'old-csrf', 'm1', 'member', ?, 1, ?)`)
    .bind(createHmac('sha256', 'local-runtime-test-session-secret:member').update('late-token').digest('hex'), Date.now() + 1000000, Date.now()).run()
  assert.equal((await request('/v1/me', undefined, { cookie: 'wq_session=late-token' })).status, 401)
  await db.prepare(`INSERT INTO members (id, wq_id_hash, wq_id_hint, country, record_date, created_at, updated_at)
    VALUES ('m2', ?, 'LOCAL02', 'GB', '2026-09-26', 1, 1)`).bind(hmac('LOCAL02')).run()

  assert.equal((await request('/v1/session/member', { wqId: 'LOCAL01' })).status, 422)
  assert.equal((await request('/v1/session/member', { wqId: 'LOCAL01', password: 'wrong' })).status, 401)
  const first = await login('LOCAL01')
  const second = await login('LOCAL01')
  const other = await login('LOCAL02')
  assert.equal(first.data.user.passwordChangeRequired, true)
  assert.equal((await (await request('/v1/me', undefined, first.headers)).json()).user.passwordChangeRequired, true)
  const admin = await login('ADMIN', adminPassword, 'admin')
  const passwordUrl = '/v1/admin/members/m1/password'
  assert.equal((await request(passwordUrl, { action: 'reset' }, first.headers)).status, 403)
  assert.equal((await request(passwordUrl, { action: 'reset' }, { ...admin.headers, origin: 'https://evil.test' })).status, 403)

  assert.equal((await request('/v1/me/password', { currentPassword: 'LOCAL01', newPassword: customPassword }, first.headers)).status, 200)
  for (const old of [first, second]) assert.equal((await request('/v1/me', undefined, old.headers)).status, 401)
  assert.equal((await request('/v1/me', undefined, other.headers)).status, 200)
  assert.equal((await request('/v1/session/member', { wqId: 'LOCAL01', password: 'LOCAL01' })).status, 401)
  const custom = await login('LOCAL01', customPassword)
  assert.equal(custom.data.user.passwordChangeRequired, false)
  const stored = await db.prepare("SELECT password_hash, password_version FROM members WHERE id='m1'").first()
  assert.match(stored.password_hash, /^pbkdf2-sha256-v1\$100000\$[a-f0-9]{32}\$[a-f0-9]{64}$/)
  assert.equal(stored.password_version, 1)

  // The existing usage endpoint supplies the member ID used by the admin UI.
  const usage = await request('/v1/admin/member-usage?q=LOCAL01', undefined, admin.headers)
  assert.equal(usage.status, 200)
  const usageData = await usage.json()
  assert.equal(usageData.members.length, 1)
  assert.equal(usageData.members[0].id, 'm1')
  assert.equal(usageData.members[0].wqId, 'LOCAL01')
  assert.equal(JSON.stringify(usageData).includes('password_hash'), false)
  const byCountry = await (await request('/v1/admin/member-usage?country=US&filter=logged&q=LOCAL01', undefined, admin.headers)).json()
  assert.deepEqual(byCountry.members.map(member => member.wqId), ['LOCAL01'])
  assert.equal(byCountry.countries.find(country => country.country === 'US').usedMembers, 1)
  assert.equal(byCountry.countries.find(country => country.country === 'GB').usedMembers, 1)
  assert.equal((await request('/v1/admin/member-usage', undefined, custom.headers)).status, 403)
  for (const endpoint of ['/v1/replays', '/v1/replay-submissions/mine', '/v1/leaderboard']) {
    assert.equal((await request(endpoint, undefined, custom.headers)).status, 403)
  }
  for (const meetingLanguage of ['zh', 'en', 'bilingual', 'other']) {
    const meeting = { title: `Runtime-${meetingLanguage}`, category: '培训', meetingLanguage, registrationUrl:'https://example.com/register',
      startLocal:new Date(Date.now()+86400000).toISOString().slice(0,19), durationMinutes:60, recurrence:{kind:'none',untilLocal:null} }
    const created = await request('/v1/admin/events', meeting, admin.headers)
    assert.equal(created.status, 201)
    const {meeting: event} = await created.json()
    assert.equal((await request(`/v1/meetings/${event.id}`, undefined, custom.headers)).status, meetingLanguage === 'en' ? 200 : 404)
    assert.equal((await request(`/v1/meetings/${event.id}.ics`, undefined, custom.headers)).status, meetingLanguage === 'en' ? 200 : 404)
  }
  const meetings = await (await request('/v1/meetings', undefined, custom.headers)).json()
  assert.deepEqual(meetings.occurrences.map(meeting => meeting.meetingLanguage), ['en'])

  assert.equal((await request(passwordUrl, { action: 'set', newPassword: adminAssignedPassword }, admin.headers)).status, 200)
  assert.equal((await request('/v1/me', undefined, custom.headers)).status, 401)
  const assigned = await login('LOCAL01', adminAssignedPassword)
  assert.equal(assigned.data.user.passwordChangeRequired, false)
  // Reset must work for legacy rows without reversible identity ciphertext too.
  await db.prepare("UPDATE members SET wq_id_ciphertext=NULL WHERE id='m1'").run()
  assert.equal((await request(passwordUrl, { action: 'reset' }, admin.headers)).status, 200)
  assert.equal((await request('/v1/me', undefined, assigned.headers)).status, 401)
  assert.equal((await login('LOCAL01')).data.user.passwordChangeRequired, true)
  assert.equal((await request('/v1/me', undefined, other.headers)).status, 200)
  assert.equal((await db.prepare('SELECT revoked_at FROM calendar_tokens').first()).revoked_at, null)
  assert.equal((await db.prepare("SELECT password_version FROM members WHERE id='m1'").first()).password_version, 3)
  const audit = await db.prepare("SELECT action, metadata_json FROM audit_logs WHERE entity_id='m1' ORDER BY created_at").all()
  assert.deepEqual(audit.results.map(row => row.action), ['change_password', 'set_member_password', 'reset_member_password'])
  assert(audit.results.every(row => row.metadata_json === '{}'))
  console.log('PASS: local workerd/D1 migration, passwords, session revocation, country access, country usage/IDs and subscription preservation')
} finally {
  await mf.dispose()
}
