import type { MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Env, Role, SessionRecord } from './env'
import type { AppContext } from './http'
import { allowedOrigins, apiError } from './http'
import { constantTimeEqual, hmacSha256, randomToken, sha256 } from './crypto'

const SESSION_SECONDS = 30 * 24 * 60 * 60

async function sessionTokenHash(env: Env, token: string, role: Role): Promise<string> {
  const roleKey = role === 'admin' ? `admin:${env.ADMIN_PASSWORD_HASH.trim().toUpperCase()}` : 'member'
  return hmacSha256(token, `${env.SESSION_SECRET}:${roleKey}`)
}

export async function verifyTurnstile(env: Env, token: string, remoteIp: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET || env.APP_ENV !== 'production') return true
  if (!token) return false
  const body = new FormData()
  body.set('secret', env.TURNSTILE_SECRET)
  body.set('response', token)
  if (remoteIp) body.set('remoteip', remoteIp)
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body })
  if (!response.ok) return false
  const result = await response.json<{ success: boolean }>()
  return result.success === true
}

export async function loginRateKey(env: Env, kind: Role, remoteIp: string, identity: string): Promise<string> {
  return hmacSha256(`${kind}:${remoteIp}:${identity}`, env.SESSION_SECRET)
}

export async function checkLoginLimit(env: Env, key: string, maximum: number): Promise<{ allowed: boolean; retryAfter: number }> {
  const now = Date.now()
  const windowMs = 15 * 60 * 1000
  const row = await env.DB.prepare('SELECT window_started_at, attempt_count, locked_until FROM login_attempts WHERE key_hash = ?1')
    .bind(key).first<{ window_started_at: number; attempt_count: number; locked_until: number | null }>()
  if (row?.locked_until && row.locked_until > now) return { allowed: false, retryAfter: Math.ceil((row.locked_until - now) / 1000) }
  if (!row || now - row.window_started_at >= windowMs) {
    await env.DB.prepare('INSERT INTO login_attempts (key_hash, window_started_at, attempt_count, locked_until, updated_at) VALUES (?1, ?2, 0, NULL, ?2) ON CONFLICT(key_hash) DO UPDATE SET window_started_at = excluded.window_started_at, attempt_count = 0, locked_until = NULL, updated_at = excluded.updated_at')
      .bind(key, now).run()
    return { allowed: true, retryAfter: 0 }
  }
  if (row.attempt_count >= maximum) {
    const lockedUntil = now + windowMs
    await env.DB.prepare('UPDATE login_attempts SET locked_until = ?2, updated_at = ?3 WHERE key_hash = ?1').bind(key, lockedUntil, now).run()
    return { allowed: false, retryAfter: Math.ceil(windowMs / 1000) }
  }
  return { allowed: true, retryAfter: 0 }
}

export async function recordLoginFailure(env: Env, key: string): Promise<void> {
  const now = Date.now()
  await env.DB.prepare('UPDATE login_attempts SET attempt_count = attempt_count + 1, updated_at = ?2 WHERE key_hash = ?1').bind(key, now).run()
}

export async function clearLoginFailures(env: Env, key: string): Promise<void> {
  await env.DB.prepare('DELETE FROM login_attempts WHERE key_hash = ?1').bind(key).run()
}

// Reserve attempts atomically before expensive password work. Account keys are
// independent of source IP, so switching IPs does not bypass the per-user budget.
export async function consumePasswordAttempt(env: Env, scope: string, identity: string, maximum: number): Promise<boolean> {
  const key = await hmacSha256(`password:${scope}:${identity}`, env.SESSION_SECRET)
  const now = Date.now()
  const row = await env.DB.prepare(`
    INSERT INTO login_attempts (key_hash, window_started_at, attempt_count, locked_until, updated_at)
    VALUES (?1, ?2, 1, NULL, ?2)
    ON CONFLICT(key_hash) DO UPDATE SET
      attempt_count = CASE WHEN window_started_at <= ?3 THEN 1 ELSE attempt_count + 1 END,
      window_started_at = CASE WHEN window_started_at <= ?3 THEN ?2 ELSE window_started_at END,
      updated_at = ?2
    RETURNING attempt_count
  `).bind(key, now, now - 15 * 60 * 1000).first<{ attempt_count: number }>()
  return row !== null && row.attempt_count <= maximum
}

export async function createSession(context: AppContext, role: Role, memberId: string | null, passwordVersion = 0) {
  const token = randomToken()
  const csrfToken = randomToken()
  const now = Date.now()
  const expiresAt = now + SESSION_SECONDS * 1000
  const sessionId = crypto.randomUUID()
  const statements = [context.env.DB.prepare(`INSERT INTO sessions (id, token_hash, csrf_hash, member_id, role, expires_at, created_at, last_seen_at, password_version)
    SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8
    WHERE ?5 = 'admin' OR EXISTS (SELECT 1 FROM members WHERE id = ?4 AND active = 1 AND password_version = ?8)`)
    .bind(sessionId, await sessionTokenHash(context.env, token, role), await sha256(csrfToken), memberId, role, expiresAt, now, passwordVersion)]
  if (role === 'member' && memberId) {
    statements.push(context.env.DB.prepare(`
      INSERT INTO member_activity (member_id, first_login_at, last_login_at, last_active_at, login_count)
      SELECT ?1, ?2, ?2, ?2, 1 WHERE EXISTS (SELECT 1 FROM sessions WHERE id = ?3)
      ON CONFLICT(member_id) DO UPDATE SET last_login_at = excluded.last_login_at,
        last_active_at = excluded.last_active_at, login_count = member_activity.login_count + 1
    `).bind(memberId, now, sessionId))
  }
  const results = await context.env.DB.batch(statements)
  if (!results[0]?.meta.changes) return null

  const production = context.env.APP_ENV === 'production'
  setCookie(context, production ? '__Host-wq_session' : 'wq_session', token, {
    httpOnly: true,
    secure: production,
    sameSite: production ? 'Strict' : 'Lax',
    path: '/',
    maxAge: SESSION_SECONDS
  })
  return { csrfToken, expiresAt }
}

export async function currentSession(context: AppContext): Promise<SessionRecord | null> {
  const cookieName = context.env.APP_ENV === 'production' ? '__Host-wq_session' : 'wq_session'
  const token = getCookie(context, cookieName)
  if (!token) return null
  const now = Date.now()
  const memberHash = await sessionTokenHash(context.env, token, 'member')
  const adminHash = await sessionTokenHash(context.env, token, 'admin')
  const row = await context.env.DB.prepare(`
    SELECT s.*, m.wq_id_hint, m.country, m.active, m.public_wq_id,
      m.password_version AS member_password_version, (m.password_hash IS NULL) AS password_is_default
    FROM sessions s
    LEFT JOIN members m ON m.id = s.member_id
    WHERE s.token_hash IN (?1, ?2) AND s.expires_at > ?3
  `).bind(memberHash, adminHash, now).first() as SessionRecord | null
  if (!row) return null
  if (row.role === 'member' && (!row.member_id || row.active !== 1 || row.password_version !== row.member_password_version)) return null
  if (now - row.last_seen_at > 5 * 60 * 1000) {
    const statements = [context.env.DB.prepare('UPDATE sessions SET last_seen_at = ?2 WHERE id = ?1').bind(row.id, now)]
    if (row.role === 'member' && row.member_id) {
      statements.push(context.env.DB.prepare(`
        INSERT INTO member_activity (member_id, first_login_at, last_login_at, last_active_at, login_count)
        VALUES (?1, ?2, ?2, ?2, 1)
        ON CONFLICT(member_id) DO UPDATE SET last_active_at = excluded.last_active_at
      `).bind(row.member_id, now))
    }
    context.executionCtx.waitUntil(context.env.DB.batch(statements))
  }
  return row
}

export async function rotateCsrf(context: AppContext, session: SessionRecord): Promise<string> {
  const csrfToken = randomToken()
  await context.env.DB.prepare('UPDATE sessions SET csrf_hash = ?2 WHERE id = ?1').bind(session.id, await sha256(csrfToken)).run()
  return csrfToken
}

export async function verifyMutation(context: AppContext, session: SessionRecord): Promise<boolean> {
  const origin = context.req.header('origin') || ''
  if (!allowedOrigins(context.env).includes(origin)) return false
  const token = context.req.header('x-csrf-token') || ''
  if (!token) return false
  return constantTimeEqual(await sha256(token), session.csrf_hash)
}

export async function destroyCurrentSession(context: AppContext): Promise<void> {
  const cookieName = context.env.APP_ENV === 'production' ? '__Host-wq_session' : 'wq_session'
  const token = getCookie(context, cookieName)
  if (token) {
    const memberHash = await sessionTokenHash(context.env, token, 'member')
    const adminHash = await sessionTokenHash(context.env, token, 'admin')
    await context.env.DB.prepare('DELETE FROM sessions WHERE token_hash IN (?1, ?2)').bind(memberHash, adminHash).run()
  }
  deleteCookie(context, cookieName, { path: '/' })
}

export const requireAuth = (role?: Role): MiddlewareHandler<{ Bindings: Env; Variables: { session: SessionRecord } }> => {
  return async (context, next) => {
    const session = await currentSession(context)
    if (!session) return apiError(context, 401, 'UNAUTHENTICATED', '请先登录')
    if (role && session.role !== role) return apiError(context, 403, 'FORBIDDEN', '没有执行此操作的权限')
    context.set('session', session)
    await next()
  }
}

export async function verifyAdminPassword(password: string, expectedHash: string): Promise<boolean> {
  return constantTimeEqual((await sha256(password)).toUpperCase(), expectedHash.trim().toUpperCase())
}
