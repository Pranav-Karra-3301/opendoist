import { describe, expect, test } from 'vitest'
import { decodeCursor, encodeCursor, ListQuerySchema } from './pagination'

describe('cursor codec', () => {
  test('encode/decode round-trips keyset values', () => {
    const keys = { child_order: 7, id: 'Zk3nQ1' }
    expect(decodeCursor(encodeCursor(keys))).toEqual(keys)
  })

  test('decodeCursor returns null on non-base64/non-json input', () => {
    expect(decodeCursor('!!!not-b64json')).toBeNull()
  })
})

describe('ListQuerySchema', () => {
  test('defaults limit to 50 and omits an absent cursor', () => {
    expect(ListQuerySchema.parse({})).toEqual({ limit: 50 })
  })

  test('coerces a string limit and accepts the 200 cap', () => {
    expect(ListQuerySchema.parse({ limit: '200' }).limit).toBe(200)
  })

  test('rejects a limit above the 200 cap', () => {
    expect(() => ListQuerySchema.parse({ limit: '201' })).toThrow()
  })
})
