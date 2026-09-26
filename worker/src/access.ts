import type { MiddlewareHandler } from 'hono'
import { hasRegionalAccess } from '@wq-calendar/shared'
import type { Env, SessionRecord } from './env'
import { apiError } from './http'

// Use after requireAuth: no member data or resource queries before this check.
export const requireRegionalAccess: MiddlewareHandler<{ Bindings: Env; Variables: { session: SessionRecord } }> = async (context, next) => {
  if (!hasRegionalAccess(context.get('session'))) return apiError(context, 403, 'REGION_RESTRICTED', '此功能仅对 CN/HK 成员开放')
  await next()
}
