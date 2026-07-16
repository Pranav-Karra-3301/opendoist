import { eq } from 'drizzle-orm'
import { afterEach, expect, it } from 'vitest'
import { comments, tasks } from '../../db/schema'
import { newId, nowIso } from '../../lib/ids'
import { createTask } from '../../services/task-write'
import { createTestApp, json, type TestApp } from '../../test/helpers'

// Sibling routers (tasks/comments) run as parallel tasks and may still be stubs while this
// suite runs, so seed through the frozen service + direct inserts. The FTS triggers fire on
// the underlying SQL regardless of which layer issues it.

let apps: TestApp[] = []
async function make(): Promise<TestApp> {
  const t = await createTestApp()
  apps.push(t)
  return t
}
afterEach(() => {
  for (const t of apps) t.close()
  apps = []
})

function seedTask(t: TestApp, content: string, description = '') {
  return createTask(t.deps.db, t.userId, {
    content,
    description,
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
    labels: [],
    uncompletable: null,
  })
}

function seedComment(t: TestApp, taskId: string, content: string): void {
  const now = nowIso()
  t.deps.db
    .insert(comments)
    .values({
      id: newId(),
      userId: t.userId,
      taskId,
      content,
      attachmentId: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

interface SearchBody {
  results: {
    task: { id: string; completed_at: string | null }
    matched_in: 'task' | 'comment'
    snippet: string
  }[]
  next_cursor: string | null
}
async function search(t: TestApp, params: Record<string, string>): Promise<Response> {
  return t.get(`/api/v1/search?${new URLSearchParams(params).toString()}`)
}

it('finds direct task hits and comment hits, tagging where each matched', async () => {
  const t = await make()
  const groceries = seedTask(t, 'Buy groceries', 'almond milk')
  seedTask(t, 'Review budget spreadsheet')
  const weekend = seedTask(t, 'Plan the weekend')
  seedComment(t, weekend.id, 'discussed groceries strategy')

  const res = await search(t, { q: 'groceries' })
  expect(res.status).toBe(200)
  const body = await json<SearchBody>(res)
  expect(body.results).toHaveLength(2)
  const matchedIn = new Map(body.results.map((r) => [r.task.id, r.matched_in]))
  expect(matchedIn.get(groceries.id)).toBe('task')
  expect(matchedIn.get(weekend.id)).toBe('comment')
  expect(body.next_cursor).toBeNull()
})

it('matches on a token prefix', async () => {
  const t = await make()
  const groceries = seedTask(t, 'Buy groceries', 'almond milk')
  const body = await json<SearchBody>(await search(t, { q: 'grocer' }))
  expect(body.results.some((r) => r.task.id === groceries.id && r.matched_in === 'task')).toBe(true)
})

it('matches text in the task description', async () => {
  const t = await make()
  const groceries = seedTask(t, 'Buy groceries', 'almond milk')
  seedTask(t, 'Review budget spreadsheet')
  const body = await json<SearchBody>(await search(t, { q: 'almond' }))
  expect(body.results).toHaveLength(1)
  expect(body.results[0]?.task.id).toBe(groceries.id)
  expect(body.results[0]?.matched_in).toBe('task')
})

it('returns an FTS snippet with <b> marks for task, description, and comment hits', async () => {
  const t = await make()
  const groceries = seedTask(t, 'Buy groceries', 'almond milk')
  const weekend = seedTask(t, 'Plan the weekend')
  seedComment(t, weekend.id, 'discussed groceries strategy')

  const byId = new Map(
    (await json<SearchBody>(await search(t, { q: 'groceries' }))).results.map((r) => [
      r.task.id,
      r,
    ]),
  )
  expect(byId.get(groceries.id)?.snippet).toContain('<b>groceries</b>')
  expect(byId.get(weekend.id)?.snippet).toContain('<b>groceries</b>')

  // A description-only match still lands its mark in the snippet (column -1 auto-picks it).
  const desc = await json<SearchBody>(await search(t, { q: 'almond' }))
  expect(desc.results[0]?.snippet).toContain('<b>almond</b>')
})

it('excludes completed tasks by default and includes them on request', async () => {
  const t = await make()
  const zephyr = seedTask(t, 'Zephyr quarterly report')
  t.deps.db.update(tasks).set({ completedAt: nowIso() }).where(eq(tasks.id, zephyr.id)).run()

  const excluded = await json<SearchBody>(await search(t, { q: 'zephyr' }))
  expect(excluded.results).toHaveLength(0)

  const included = await json<SearchBody>(
    await search(t, { q: 'zephyr', include_completed: 'true' }),
  )
  expect(included.results).toHaveLength(1)
  expect(included.results[0]?.task.id).toBe(zephyr.id)
})

it('never returns soft-deleted tasks, even with include_completed', async () => {
  const t = await make()
  const xylophone = seedTask(t, 'Xylophone lessons')
  t.deps.db.update(tasks).set({ deletedAt: nowIso() }).where(eq(tasks.id, xylophone.id)).run()

  expect((await json<SearchBody>(await search(t, { q: 'xylophone' }))).results).toHaveLength(0)
  expect(
    (await json<SearchBody>(await search(t, { q: 'xylophone', include_completed: 'true' })))
      .results,
  ).toHaveLength(0)
})

it('re-indexes when a task content changes', async () => {
  const t = await make()
  const task = seedTask(t, 'Original quokka notes')
  expect((await json<SearchBody>(await search(t, { q: 'quokka' }))).results).toHaveLength(1)

  t.deps.db
    .update(tasks)
    .set({ content: 'Updated narwhal notes' })
    .where(eq(tasks.id, task.id))
    .run()
  expect((await json<SearchBody>(await search(t, { q: 'narwhal' }))).results).toHaveLength(1)
  expect((await json<SearchBody>(await search(t, { q: 'quokka' }))).results).toHaveLength(0)
})

it('treats FTS5 operator characters as literal text (never 500s)', async () => {
  const t = await make()
  seedTask(t, 'Buy groceries', 'almond milk')
  for (const q of ['groceries" OR 1=1 --', '*', '"', '()', '^:-', 'groceries*']) {
    const res = await search(t, { q })
    expect(res.status).toBe(200)
    // body still parses as the standard envelope
    const body = await json<SearchBody>(res)
    expect(Array.isArray(body.results)).toBe(true)
  }
})

it('walks every result with limit=1 via the cursor', async () => {
  const t = await make()
  const groceries = seedTask(t, 'Buy groceries', 'almond milk')
  const weekend = seedTask(t, 'Plan the weekend')
  seedComment(t, weekend.id, 'discussed groceries strategy')

  const seen = new Set<string>()
  let cursor: string | null = null
  let guard = 0
  do {
    const params: Record<string, string> = { q: 'groceries', limit: '1' }
    if (cursor) params.cursor = cursor
    const body = await json<SearchBody>(await search(t, params))
    expect(body.results.length).toBeLessThanOrEqual(1)
    for (const r of body.results) seen.add(r.task.id)
    cursor = body.next_cursor
    guard += 1
  } while (cursor !== null && guard < 10)

  expect(seen).toEqual(new Set([groceries.id, weekend.id]))
  expect(cursor).toBeNull()
})

it('rejects a malformed cursor with a 400 problem', async () => {
  const t = await make()
  const res = await search(t, { q: 'groceries', cursor: '!!!not-a-valid-cursor' })
  expect(res.status).toBe(400)
  expect(res.headers.get('content-type')).toContain('application/problem+json')
  expect((await json<{ title: string }>(res)).title).toBe('invalid cursor')
})

it('requires authentication', async () => {
  const t = await make()
  const res = await t.request('/api/v1/search?q=groceries')
  expect(res.status).toBe(401)
  expect(res.headers.get('content-type')).toContain('application/problem+json')
})
