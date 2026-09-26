import type { Env, SessionRecord } from './env'
import type { EventRow, ExceptionRow } from './events'

export async function listPublishedEvents(env: Env, includeAllLanguages = true): Promise<EventRow[]> {
  const languageFilter = includeAllLanguages ? '' : " AND meeting_language = 'en'"
  const result = await env.DB.prepare(`SELECT * FROM events WHERE status IN ('published', 'cancelled')${languageFilter} ORDER BY start_beijing ASC`).all<EventRow>()
  return result.results
}

export async function listEventExceptions(env: Env, eventIds?: string[]): Promise<ExceptionRow[]> {
  if (eventIds && eventIds.length === 0) return []
  if (!eventIds) {
    const result = await env.DB.prepare('SELECT * FROM event_exceptions ORDER BY occurrence_key ASC').all<ExceptionRow>()
    return result.results
  }
  const placeholders = eventIds.map((_, index) => `?${index + 1}`).join(',')
  const result = await env.DB.prepare(`SELECT * FROM event_exceptions WHERE event_id IN (${placeholders}) ORDER BY occurrence_key ASC`).bind(...eventIds).all<ExceptionRow>()
  return result.results
}

export async function audit(env: Env, session: SessionRecord, action: string, entityType: string, entityId: string, metadata: unknown = {}) {
  await env.DB.prepare('INSERT INTO audit_logs (id, actor_role, actor_member_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
    .bind(crypto.randomUUID(), session.role, session.member_id, action, entityType, entityId, JSON.stringify(metadata), Date.now()).run()
}
