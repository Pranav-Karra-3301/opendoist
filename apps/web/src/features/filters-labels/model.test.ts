import { describe, expect, it } from 'vitest'
import { applyOrder, byItemOrder, filterToCreate, labelToCreate, reorderIds } from './model'

interface FilterLike {
  id: string
  name: string
  query: string
  color: string
  item_order: number
  is_favorite: boolean
}

const filter = (id: string, over: Partial<FilterLike> = {}): FilterLike => ({
  id,
  name: id,
  query: 'today',
  color: 'charcoal',
  item_order: 0,
  is_favorite: false,
  ...over,
})

describe('reorderIds', () => {
  it('moves the active id into the over id slot', () => {
    expect(reorderIds(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd'])
    expect(reorderIds(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
  })

  it('returns a fresh copy on any no-op (same id, unknown id)', () => {
    const ids = ['a', 'b', 'c']
    const sameId = reorderIds(ids, 'b', 'b')
    expect(sameId).toEqual(ids)
    expect(sameId).not.toBe(ids)
    expect(reorderIds(ids, 'a', 'zzz')).toEqual(ids)
    expect(reorderIds(ids, 'zzz', 'a')).toEqual(ids)
  })
})

describe('byItemOrder', () => {
  it('sorts ascending by item_order with an id tiebreak, without mutating input', () => {
    const rows = [
      filter('c', { item_order: 2 }),
      filter('a', { item_order: 1 }),
      filter('b', { item_order: 1 }),
    ]
    const sorted = byItemOrder(rows)
    expect(sorted.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(rows.map((r) => r.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('applyOrder', () => {
  it('rewrites item_order (1-based) to match the new id order', () => {
    const rows = [
      filter('a', { item_order: 1 }),
      filter('b', { item_order: 2 }),
      filter('c', { item_order: 3 }),
    ]
    const next = applyOrder(rows, ['c', 'a', 'b'])
    expect(next.map((r) => [r.id, r.item_order])).toEqual([
      ['c', 1],
      ['a', 2],
      ['b', 3],
    ])
  })

  it('drops ids that are not present in rows', () => {
    const rows = [filter('a', { item_order: 1 }), filter('b', { item_order: 2 })]
    const next = applyOrder(rows, ['b', 'ghost', 'a'])
    expect(next.map((r) => r.id)).toEqual(['b', 'a'])
    expect(next.map((r) => r.item_order)).toEqual([1, 3])
  })
})

describe('undo recreate payloads', () => {
  it('filterToCreate keeps only the durable fields', () => {
    expect(
      filterToCreate(
        filter('x', { name: 'Overdue', query: 'overdue', color: 'red', is_favorite: true }),
      ),
    ).toEqual({ name: 'Overdue', query: 'overdue', color: 'red', is_favorite: true })
  })

  it('labelToCreate keeps only name/color/is_favorite', () => {
    expect(labelToCreate({ name: 'urgent', color: 'orange', is_favorite: false })).toEqual({
      name: 'urgent',
      color: 'orange',
      is_favorite: false,
    })
  })
})
