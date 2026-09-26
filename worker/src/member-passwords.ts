import type { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { adminMemberPasswordSchema, memberPasswordChangeSchema } from '@wq-calendar/shared'
import type { Env, SessionRecord } from './env'
import { consumePasswordAttempt, destroyCurrentSession, requireAuth, verifyMutation } from './auth'
import { hashMemberPassword, isInitialPassword, verifyMemberPassword } from './passwords'
import { apiError, readJson } from './http'

type App = Hono<{ Bindings: Env; Variables: { session: SessionRecord } }>
type PasswordRow = { id: string; wq_id_hash: string; password_hash: string | null; password_version: number }

// CAS + audit + revocation in one transaction. An in-flight login checked with an
// older password version cannot create a usable session after this transaction.
export async function replaceMemberPassword(env: Env, member: PasswordRow, nextHash: string | null, actor: SessionRecord): Promise<boolean> {
  const now = Date.now()
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE members SET password_hash = ?2, password_version = password_version + 1,
      password_changed_at = ?3, updated_at = ?3 WHERE id = ?1 AND password_version = ?4`)
      .bind(member.id, nextHash, now, member.password_version),
    env.DB.prepare(`INSERT INTO audit_logs (id, actor_role, actor_member_id, action, entity_type, entity_id, metadata_json, created_at)
      SELECT ?1, ?2, ?3, ?4, 'member', ?5, '{}', ?6 WHERE changes() = 1`)
      .bind(crypto.randomUUID(), actor.role, actor.member_id,
        nextHash === null ? 'reset_member_password' : actor.role === 'admin' ? 'set_member_password' : 'change_password', member.id, now),
    env.DB.prepare(`DELETE FROM sessions WHERE role = 'member' AND member_id = ?1
      AND password_version <> (SELECT password_version FROM members WHERE id = ?1)`).bind(member.id)
  ])
  return results[0]?.meta.changes === 1
}

export function registerMemberPasswordRoutes(app: App) {
  app.post('/v1/me/password', requireAuth('member'), bodyLimit({ maxSize: 4096 }), async context => {
    const session = context.get('session')
    if (!await verifyMutation(context, session)) return apiError(context, 403, 'CSRF_FAILED', '安全校验失败')
    const parsed = memberPasswordChangeSchema.safeParse(await readJson(context))
    if (!parsed.success) return apiError(context, 422, 'VALIDATION_ERROR', '请填写当前密码及 12–128 位新密码')
    if (!await consumePasswordAttempt(context.env, 'change', session.member_id!, 10)) {
      return apiError(context, 429, 'TOO_MANY_ATTEMPTS', '修改密码尝试过多，请在 15 分钟后重试')
    }
    const member = await context.env.DB.prepare('SELECT id, wq_id_hash, password_hash, password_version FROM members WHERE id = ?1 AND active = 1')
      .bind(session.member_id).first<PasswordRow>()
    if (!member || member.password_version !== session.password_version) return apiError(context, 401, 'UNAUTHENTICATED', '登录已失效，请重新登录')
    const { currentPassword, newPassword } = parsed.data
    if (!await verifyMemberPassword(currentPassword, member.password_hash, member.wq_id_hash, context.env.WQ_ID_HMAC_SECRET)) {
      return apiError(context, 401, 'CURRENT_PASSWORD_INCORRECT', '当前密码不正确')
    }
    if (newPassword === currentPassword || await isInitialPassword(newPassword, member.wq_id_hash, context.env.WQ_ID_HMAC_SECRET)) {
      return apiError(context, 422, 'WEAK_PASSWORD', '新密码不能与当前密码或 WQ_ID 相同')
    }
    const changed = await replaceMemberPassword(context.env, member, await hashMemberPassword(newPassword, context.env.WQ_ID_HMAC_SECRET), session)
    if (!changed) return apiError(context, 409, 'PASSWORD_CHANGED', '密码已被更新，请重新登录后重试')
    await destroyCurrentSession(context)
    return context.json({ changed: true, requiresLogin: true })
  })

  app.post('/v1/admin/members/:id/password', requireAuth('admin'), bodyLimit({ maxSize: 4096 }), async context => {
    const session = context.get('session')
    if (!await verifyMutation(context, session)) return apiError(context, 403, 'CSRF_FAILED', '安全校验失败')
    const parsed = adminMemberPasswordSchema.safeParse(await readJson(context))
    if (!parsed.success) return apiError(context, 422, 'VALIDATION_ERROR', '密码操作无效；新密码须为 12–128 位')
    if (!await consumePasswordAttempt(context.env, 'admin-change', session.id, 30)) {
      return apiError(context, 429, 'TOO_MANY_ATTEMPTS', '密码操作过于频繁，请在 15 分钟后重试')
    }
    const member = await context.env.DB.prepare('SELECT id, wq_id_hash, password_hash, password_version FROM members WHERE id = ?1')
      .bind(context.req.param('id')).first<PasswordRow>()
    if (!member) return apiError(context, 404, 'NOT_FOUND', '成员不存在')
    let nextHash: string | null = null
    if (parsed.data.action === 'set') {
      if (await isInitialPassword(parsed.data.newPassword, member.wq_id_hash, context.env.WQ_ID_HMAC_SECRET)) {
        return apiError(context, 422, 'WEAK_PASSWORD', '新密码不能为 WQ_ID；请使用重置操作')
      }
      nextHash = await hashMemberPassword(parsed.data.newPassword, context.env.WQ_ID_HMAC_SECRET)
    }
    if (!await replaceMemberPassword(context.env, member, nextHash, session)) return apiError(context, 409, 'PASSWORD_CHANGED', '密码已被更新，请刷新后重试')
    return context.json({ changed: true, passwordChangeRequired: nextHash === null })
  })
}
