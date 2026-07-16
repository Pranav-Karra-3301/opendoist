import { afterEach, expect, it } from 'vitest'
import { tasksToDtos } from '../../services/task-read'
import { createTask } from '../../services/task-write'
import { createTestApp, json, type TestApp } from '../../test/helpers'

type LabelDto = {
  id: string
  name: string
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

it('GET /labels returns the {results, next_cursor} envelope', async () => {
  const t = await make()
  const res = await t.get('/api/v1/labels')
  expect(res.status).toBe(200)
  const body = await json<ListDto<LabelDto>>(res)
  expect(Array.isArray(body.results)).toBe(true)
  expect(body.results).toEqual([])
  expect(body.next_cursor).toBeNull()
})

it('POST /labels creates a label with defaults', async () => {
  const t = await make()
  const res = await t.post('/api/v1/labels', { name: 'Home' })
  expect(res.status).toBe(201)
  const label = await json<LabelDto>(res)
  expect(label.id).toBeTruthy()
  expect(label.name).toBe('Home')
  expect(label.color).toBe('charcoal')
  expect(label.item_order).toBe(0)
  expect(label.is_favorite).toBe(false)

  const list = await json<ListDto<LabelDto>>(await t.get('/api/v1/labels'))
  expect(list.results).toHaveLength(1)
  expect(list.results[0]?.name).toBe('Home')
})

it('POST /labels honors color and is_favorite', async () => {
  const t = await make()
  const label = await json<LabelDto>(
    await t.post('/api/v1/labels', { name: 'Work', color: 'blue', is_favorite: true }),
  )
  expect(label.color).toBe('blue')
  expect(label.is_favorite).toBe(true)
})

it('POST /labels appends item_order for each new label', async () => {
  const t = await make()
  const a = await json<LabelDto>(await t.post('/api/v1/labels', { name: 'A' }))
  const b = await json<LabelDto>(await t.post('/api/v1/labels', { name: 'B' }))
  expect(a.item_order).toBe(0)
  expect(b.item_order).toBe(1)
})

it('POST /labels rejects a duplicate name case-insensitively → 409', async () => {
  const t = await make()
  expect((await t.post('/api/v1/labels', { name: 'Home' })).status).toBe(201)
  const res = await t.post('/api/v1/labels', { name: 'home' })
  expect(res.status).toBe(409)
  expect(res.headers.get('content-type')).toContain('application/problem+json')
  const body = await json<{ title: string; status: number }>(res)
  expect(body.title).toBe('label exists')
  expect(body.status).toBe(409)
})

it('PATCH /labels/{id} renames and frees the old name', async () => {
  const t = await make()
  const label = await json<LabelDto>(await t.post('/api/v1/labels', { name: 'Home' }))
  const res = await t.patch(`/api/v1/labels/${label.id}`, { name: 'House' })
  expect(res.status).toBe(200)
  expect((await json<LabelDto>(res)).name).toBe('House')
  // renaming (not deleting) releases 'Home' for a fresh label
  expect((await t.post('/api/v1/labels', { name: 'Home' })).status).toBe(201)
})

it('PATCH /labels/{id} to another existing name → 409', async () => {
  const t = await make()
  await t.post('/api/v1/labels', { name: 'Alpha' })
  const beta = await json<LabelDto>(await t.post('/api/v1/labels', { name: 'Beta' }))
  const res = await t.patch(`/api/v1/labels/${beta.id}`, { name: 'alpha' })
  expect(res.status).toBe(409)
})

it('PATCH /labels/{id} updates color/is_favorite and allows keeping the same name', async () => {
  const t = await make()
  const label = await json<LabelDto>(await t.post('/api/v1/labels', { name: 'Home' }))
  const res = await t.patch(`/api/v1/labels/${label.id}`, {
    name: 'Home',
    color: 'red',
    is_favorite: true,
  })
  expect(res.status).toBe(200)
  const updated = await json<LabelDto>(res)
  expect(updated.name).toBe('Home')
  expect(updated.color).toBe('red')
  expect(updated.is_favorite).toBe(true)
})

it('PATCH /labels/{id} with an unknown id → 404', async () => {
  const t = await make()
  expect((await t.patch('/api/v1/labels/nope', { name: 'X' })).status).toBe(404)
})

it('DELETE /labels/{id} soft-deletes and frees the name', async () => {
  const t = await make()
  const label = await json<LabelDto>(await t.post('/api/v1/labels', { name: 'Temp' }))
  expect((await t.del(`/api/v1/labels/${label.id}`)).status).toBe(204)
  const list = await json<ListDto<LabelDto>>(await t.get('/api/v1/labels'))
  expect(list.results).toHaveLength(0)
  // partial unique index releases the name for re-creation
  expect((await t.post('/api/v1/labels', { name: 'Temp' })).status).toBe(201)
})

it('DELETE /labels/{id} with an unknown id → 404', async () => {
  const t = await make()
  expect((await t.del('/api/v1/labels/nope')).status).toBe(404)
})

it('DELETE /labels/{id} removes the label from tasks that used it', async () => {
  const t = await make()
  const label = await json<LabelDto>(await t.post('/api/v1/labels', { name: 'errands' }))
  // Attach the label to a task via the frozen write service (no dependency on the tasks router).
  const task = createTask(t.deps.db, t.userId, {
    content: 'Run errands',
    description: '',
    projectId: null,
    sectionId: null,
    parentId: null,
    childOrder: null,
    priority: 4,
    dueDate: null,
    dueTime: null,
    dueString: null,
    recurrence: null,
    deadlineDate: null,
    durationMin: null,
    labels: ['errands'],
    uncompletable: null,
  })
  expect(tasksToDtos(t.deps.db, [task])[0]?.labels).toEqual(['errands'])

  expect((await t.del(`/api/v1/labels/${label.id}`)).status).toBe(204)

  // The junction rows are hard-deleted, so the task's DTO no longer lists the label.
  expect(tasksToDtos(t.deps.db, [task])[0]?.labels).toEqual([])
})

it('POST /labels/reorder rewrites item_order', async () => {
  const t = await make()
  const a = await json<LabelDto>(await t.post('/api/v1/labels', { name: 'A' }))
  const b = await json<LabelDto>(await t.post('/api/v1/labels', { name: 'B' }))
  const cc = await json<LabelDto>(await t.post('/api/v1/labels', { name: 'C' }))
  const res = await t.post('/api/v1/labels/reorder', {
    items: [
      { id: cc.id, item_order: 0 },
      { id: a.id, item_order: 1 },
      { id: b.id, item_order: 2 },
    ],
  })
  expect(res.status).toBe(204)
  const list = await json<ListDto<LabelDto>>(await t.get('/api/v1/labels'))
  expect(list.results.map((l) => l.name)).toEqual(['C', 'A', 'B'])
})

it('POST /labels/reorder with an unknown id → 404 and applies nothing', async () => {
  const t = await make()
  const a = await json<LabelDto>(await t.post('/api/v1/labels', { name: 'A' }))
  const res = await t.post('/api/v1/labels/reorder', {
    items: [
      { id: a.id, item_order: 5 },
      { id: 'ghost', item_order: 6 },
    ],
  })
  expect(res.status).toBe(404)
  // ownership is checked before any write, so A keeps its original order
  const list = await json<ListDto<LabelDto>>(await t.get('/api/v1/labels'))
  expect(list.results[0]?.item_order).toBe(0)
})
