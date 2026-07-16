import { afterEach, expect, it } from 'vitest'
import { createTestApp, json, type TestApp } from '../../test/helpers'

type FilterDto = {
  id: string
  name: string
  query: string
  color: string
  item_order: number
  is_favorite: boolean
  created_at: string
  updated_at: string
}
type ListDto<T> = { results: T[]; next_cursor: string | null }

let apps: TestApp[] = []
async function make(opts?: Parameters<typeof createTestApp>[0]): Promise<TestApp> {
  const t = await createTestApp(opts)
  apps.push(t)
  return t
}
afterEach(() => {
  for (const t of apps) t.close()
  apps = []
})

it('GET /filters returns the {results, next_cursor} envelope', async () => {
  const t = await make()
  const res = await t.get('/api/v1/filters')
  expect(res.status).toBe(200)
  const body = await json<ListDto<FilterDto>>(res)
  expect(Array.isArray(body.results)).toBe(true)
  expect(body.results).toEqual([])
  expect(body.next_cursor).toBeNull()
})

it('POST /filters saves a valid query verbatim', async () => {
  const t = await make()
  const query = '(today | overdue) & #Work'
  const res = await t.post('/api/v1/filters', { name: 'Work due', query })
  expect(res.status).toBe(201)
  const filter = await json<FilterDto>(res)
  expect(filter.id).toBeTruthy()
  expect(filter.name).toBe('Work due')
  expect(filter.query).toBe(query)
  expect(filter.color).toBe('charcoal')
  expect(filter.item_order).toBe(0)
  expect(filter.is_favorite).toBe(false)

  const list = await json<ListDto<FilterDto>>(await t.get('/api/v1/filters'))
  expect(list.results).toHaveLength(1)
  expect(list.results[0]?.query).toBe(query)
})

it('POST /filters honors color and is_favorite', async () => {
  const t = await make()
  const filter = await json<FilterDto>(
    await t.post('/api/v1/filters', {
      name: 'Fav',
      query: 'today',
      color: 'grape',
      is_favorite: true,
    }),
  )
  expect(filter.color).toBe('grape')
  expect(filter.is_favorite).toBe(true)
})

it('POST /filters appends item_order for each new filter', async () => {
  const t = await make()
  const a = await json<FilterDto>(await t.post('/api/v1/filters', { name: 'A', query: 'today' }))
  const b = await json<FilterDto>(await t.post('/api/v1/filters', { name: 'B', query: 'overdue' }))
  expect(a.item_order).toBe(0)
  expect(b.item_order).toBe(1)
})

it('POST /filters rejects an invalid query with a numeric position → 400', async () => {
  const t = await make()
  const res = await t.post('/api/v1/filters', { name: 'Bad', query: 'today &' })
  expect(res.status).toBe(400)
  expect(res.headers.get('content-type')).toContain('application/problem+json')
  const body = await json<{ title: string; position: number }>(res)
  expect(body.title).toBe('invalid filter query')
  expect(typeof body.position).toBe('number')
  // the invalid POST must not persist anything
  const list = await json<ListDto<FilterDto>>(await t.get('/api/v1/filters'))
  expect(list.results).toHaveLength(0)
})

it('PATCH /filters/{id} updates name and a valid query', async () => {
  const t = await make()
  const filter = await json<FilterDto>(
    await t.post('/api/v1/filters', { name: 'F', query: 'today' }),
  )
  const res = await t.patch(`/api/v1/filters/${filter.id}`, { name: 'Renamed', query: 'overdue' })
  expect(res.status).toBe(200)
  const updated = await json<FilterDto>(res)
  expect(updated.name).toBe('Renamed')
  expect(updated.query).toBe('overdue')
})

it('PATCH /filters/{id} with an invalid query → 400 and leaves the row unchanged', async () => {
  const t = await make()
  const filter = await json<FilterDto>(
    await t.post('/api/v1/filters', { name: 'F', query: 'today' }),
  )
  const res = await t.patch(`/api/v1/filters/${filter.id}`, { query: 'today &' })
  expect(res.status).toBe(400)
  const body = await json<{ title: string; position: number }>(res)
  expect(body.title).toBe('invalid filter query')
  expect(typeof body.position).toBe('number')

  const list = await json<ListDto<FilterDto>>(await t.get('/api/v1/filters'))
  expect(list.results.find((f) => f.id === filter.id)?.query).toBe('today')
})

it('PATCH /filters/{id} with an unknown id → 404', async () => {
  const t = await make()
  expect((await t.patch('/api/v1/filters/nope', { name: 'X' })).status).toBe(404)
})

it('DELETE /filters/{id} soft-deletes; a second delete → 404', async () => {
  const t = await make()
  const filter = await json<FilterDto>(
    await t.post('/api/v1/filters', { name: 'F', query: 'today' }),
  )
  expect((await t.del(`/api/v1/filters/${filter.id}`)).status).toBe(204)
  const list = await json<ListDto<FilterDto>>(await t.get('/api/v1/filters'))
  expect(list.results).toHaveLength(0)
  expect((await t.del(`/api/v1/filters/${filter.id}`)).status).toBe(404)
})

it('POST /filters/reorder rewrites item_order', async () => {
  const t = await make()
  const a = await json<FilterDto>(await t.post('/api/v1/filters', { name: 'A', query: 'today' }))
  const b = await json<FilterDto>(await t.post('/api/v1/filters', { name: 'B', query: 'overdue' }))
  const res = await t.post('/api/v1/filters/reorder', {
    items: [
      { id: b.id, item_order: 0 },
      { id: a.id, item_order: 1 },
    ],
  })
  expect(res.status).toBe(204)
  const list = await json<ListDto<FilterDto>>(await t.get('/api/v1/filters'))
  expect(list.results.map((f) => f.name)).toEqual(['B', 'A'])
})

it('POST /filters/reorder with an unknown id → 404', async () => {
  const t = await make()
  const a = await json<FilterDto>(await t.post('/api/v1/filters', { name: 'A', query: 'today' }))
  const res = await t.post('/api/v1/filters/reorder', {
    items: [
      { id: a.id, item_order: 3 },
      { id: 'ghost', item_order: 4 },
    ],
  })
  expect(res.status).toBe(404)
})
