// Full-size synthetic import in ephemeral local workerd/D1. No production
// credentials, .dev.vars, persisted data, or external requests are used.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { Miniflare } = createRequire(require.resolve('wrangler/package.json'))('miniflare')
const token = 'local-runtime-test-member-sync-token-0123456789'
const base = '/v1/automation/member-imports'
const mf = new Miniflare({
  modules: true,
  scriptPath: fileURLToPath(new URL('../dist/index.js', import.meta.url)),
  compatibilityDate: '2026-07-23',
  compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'],
  d1Persist: false,
  bindings: {
    APP_ENV: 'test', ALLOWED_ORIGINS: 'https://calendar.test', API_BASE_URL: 'https://api.test',
    WQ_ID_HMAC_SECRET: 'local-runtime-test-identity-secret', MEMBER_SYNC_TOKEN: token
  },
  outboundService: () => new Response('External requests disabled in runtime test', { status: 503 })
})

async function request(path, body, status = 200) {
  const response = await mf.dispatchFetch(`https://api.test${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  const result = await response.json()
  assert.equal(response.status, status, JSON.stringify(result))
  return result
}

try {
  const db = await mf.getD1Database('DB')
  const migrations = new URL('../migrations/', import.meta.url)
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    const sql = (await readFile(new URL(name, migrations), 'utf8')).replace(/^\s*--.*$/gm, '')
    await db.batch(sql.split(';').map(value => value.trim()).filter(Boolean).map(value => db.prepare(value)))
  }
  const expectedRows = 16034
  const { importId } = await request(base, { expectedRows, boardDate: '2026-09-25' }, 201)
  for (let offset = 0; offset < expectedRows; offset += 100) {
    const rows = Array.from({ length: Math.min(100, expectedRows - offset) }, (_, index) => ({
      wqId: `SYNTHETIC${offset + index}`, country: ['US', 'IN', 'GB', 'SG'][index % 4]
    }))
    const staged = await request(`${base}/${importId}/rows`, { rows })
    assert.equal(staged.stagedRows, offset + rows.length)
    if (offset === 0 || rows.length < 100) {
      const retried = await request(`${base}/${importId}/rows`, { rows })
      assert.equal(retried.stagedRows, staged.stagedRows)
    }
  }
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM members').first()).n, 0)
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM member_import_rows').first()).n, expectedRows)
  const preview = await request(`${base}/${importId}`)
  assert.equal(preview.batch.total_rows, expectedRows)
  for (let attempt = 0; attempt < 2; attempt++) {
    const committed = await request(`${base}/${importId}/commit`, {})
    assert.equal(committed.importedRows, expectedRows)
    assert.equal(committed.activeMembers, expectedRows)
  }
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'sync_members'").first()).n, 1)
  await request(`${base}/${importId}/rows`, { rows: [{ wqId: 'LATE', country: 'US' }] }, 409)
  console.log(`PASS: local workerd/D1 full ${expectedRows}-member import, batch retries, exact counts, commit idempotency and staging guards`)
} finally {
  await mf.dispose()
}
