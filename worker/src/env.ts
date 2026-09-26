export interface Env {
  DB: D1Database
  APP_ENV: string
  ALLOWED_ORIGINS: string
  API_BASE_URL: string
  ADMIN_WQ_ID: string
  ADMIN_PASSWORD_HASH: string
  WQ_ID_HMAC_SECRET: string
  TURNSTILE_SECRET: string
  SESSION_SECRET: string
  MEMBER_SYNC_TOKEN?: string
}

export type Role = 'member' | 'admin'

export interface SessionRecord {
  id: string
  token_hash: string
  csrf_hash: string
  member_id: string | null
  role: Role
  expires_at: number
  created_at: number
  last_seen_at: number
  wq_id_hint: string | null
  country: string | null
  active: number | null
  public_wq_id: number | null
  password_version: number
  member_password_version: number | null
  password_is_default: number | null
}
