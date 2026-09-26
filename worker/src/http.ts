import type { Context } from 'hono'
import type { Env } from './env'

// Hono's route-specific Context type is invariant in its Variables map. The
// helpers intentionally accept any route context while the application itself
// remains strongly typed through its Hono generic.
export type AppContext = Context<any>

export function requestId(context: AppContext): string {
  return context.req.header('cf-ray') || crypto.randomUUID()
}

export function apiError(context: AppContext, status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503, code: string, message: string, fieldErrors?: Record<string, string[]>) {
  return context.json({
    error: { code, message, fieldErrors, requestId: requestId(context) }
  }, status)
}

export async function readJson(context: AppContext): Promise<unknown> {
  const contentType = context.req.header('content-type') || ''
  if (!contentType.toLowerCase().includes('application/json')) throw new Error('INVALID_CONTENT_TYPE')
  return context.req.json()
}

export function allowedOrigins(env: Env): string[] {
  return env.ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean)
}
