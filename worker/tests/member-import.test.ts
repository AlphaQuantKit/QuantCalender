import { describe, expect, it } from 'vitest'
import { importRowsSchema } from '@wq-calendar/shared'

describe('member import schema', () => {
  it('accepts rows with only WQ ID and country', () => {
    const result = importRowsSchema.safeParse({ rows: [{ wqId: 'KZ79256', country: 'CN' }] })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.rows[0]).toEqual({ wqId: 'KZ79256', country: 'CN' })
  })

  it('accepts and normalizes countries outside CN/HK', () => {
    for (const country of ['US', 'IN', 'GB', 'SG', 'TW', 'VN']) {
      const parsed = importRowsSchema.parse({ rows: [{ wqId: 'TEST01', country: ` ${country.toLowerCase()} ` }] })
      expect(parsed.rows[0]?.country).toBe(country)
    }
  })

  it('rejects malformed country codes and empty/oversized batches', () => {
    for (const country of ['', 'USA', '1A', '中国', 'U S']) {
      expect(importRowsSchema.safeParse({ rows: [{ wqId: 'TEST01', country }] }).success).toBe(false)
    }
    expect(importRowsSchema.safeParse({ rows: [] }).success).toBe(false)
    expect(importRowsSchema.safeParse({ rows: Array(101).fill({ wqId: 'TEST01', country: 'US' }) }).success).toBe(false)
  })
})
