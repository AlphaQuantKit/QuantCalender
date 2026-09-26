import { timingSafeEqual } from 'node:crypto'
import { hmacSha256, normalizeWqId } from './crypto'

const encoder = new TextEncoder()
// Workerd Web Crypto supports at most 100,000 PBKDF2 iterations per derivation.
// A domain-separated server-side pepper protects against a database-only leak.
const ITERATIONS = 100000
const FORMAT = 'pbkdf2-sha256-v1'

function toHex(bytes: Uint8Array): string {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
function fromHex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../g) || [], pair => Number.parseInt(pair, 16))
}

async function derive(password: string, salt: Uint8Array, secret: string): Promise<Uint8Array> {
  const peppered = await hmacSha256(password, `member-password-v1:${secret}`)
  const key = await crypto.subtle.importKey('raw', encoder.encode(peppered), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: new Uint8Array(salt) }, key, 256))
}

export async function hashMemberPassword(password: string, secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `${FORMAT}$${ITERATIONS}$${toHex(salt)}$${toHex(await derive(password, salt, secret))}`
}

export async function isInitialPassword(password: string, wqIdHash: string, secret: string): Promise<boolean> {
  // Initial passwords follow canonical WQ_ID casing; custom passwords are exact.
  const candidate = await hmacSha256(normalizeWqId(password), secret)
  if (!/^[a-f0-9]{64}$/.test(wqIdHash)) return false
  return timingSafeEqual(fromHex(candidate), fromHex(wqIdHash))
}

export async function verifyMemberPassword(password: string, storedHash: string | null, wqIdHash: string, secret: string): Promise<boolean> {
  if (storedHash === null) return isInitialPassword(password, wqIdHash, secret)
  const parts = storedHash.split('$')
  if (parts.length !== 4 || parts[0] !== FORMAT || parts[1] !== String(ITERATIONS)
    || !/^[a-f0-9]{32}$/.test(parts[2]!) || !/^[a-f0-9]{64}$/.test(parts[3]!)) return false
  return timingSafeEqual(await derive(password, fromHex(parts[2]!), secret), fromHex(parts[3]!))
}
