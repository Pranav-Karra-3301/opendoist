import { addDaysIso, dateInTz } from '@opendoist/core'
import { and, eq, sql } from 'drizzle-orm'
import { afterEach, expect, it } from 'vitest'
import { dayStats, projects, sections, tasks } from '../../db/schema'
import type { TaskDto } from '../../services/task-read'
import { createTask } from '../../services/task-write'
import { createTestApp, json, type TestApp } from '../../test/helpers'

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

/** Insert a subtask directly through the frozen service (the tasks router is out of scope here). */
function addSubtask(t: TestApp, parentId: string, projectId: string, content: string) {
  return createTask(t.deps.db, t.userId, {
    content,
    description: '',
    projectId,
    sectionId: null,
    parentId,
    childOrder: null,
    priority: 4,
    dueDate: null,
    dueTime: null,
    dueString: null,
    recurrence: null,
    deadlineDate: null,
    durationMin: null,
    labels: [],
    uncompletable: false,
  })
}

const utcToday = () => dateInTz(new Date().toISOString(), 'UTC')

it('quick-add: minimal text lands in the inbox at priority 4', async () => {
  const t = await make()
  const res = await t.post('/api/v1/tasks/quick', { text: 'buy milk' })
  expect(res.status).toBe(201)
  const dto = await json<TaskDto>(res)
  expect(dto.content).toBe('buy milk')
  expect(dto.priority).toBe(4)
  expect(dto.due).toBeNull()
  expect(dto.labels).toEqual([])

  const inbox = t.deps.db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, t.userId), eq(projects.isInbox, true)))
    .get()
  expect(dto.project_id).toBe(inbox?.id)
})

it('quick-add: empty text is a 400 problem', async () => {
  const t = await make()
  const res = await t.post('/api/v1/tasks/quick', { text: '' })
  expect(res.status).toBe(400)
  expect(res.headers.get('content-type')).toContain('application/problem+json')
})

it('quick-add: full grammar resolves project, section, label, priority, due, deadline, description', async () => {
  const t = await make()
  const before = utcToday()
  const res = await t.post('/api/v1/tasks/quick', {
    text: 'Submit report tom 4pm p1 #Work /Admin @email {july 30} // context',
  })
  const after = utcToday()
  expect(res.status).toBe(201)
  const dto = await json<TaskDto>(res)

  expect(dto.content).toBe('Submit report')
  expect(dto.priority).toBe(1)
  expect(dto.description).toBe('context')
  expect(dto.deadline_date).toMatch(/-07-30$/)
  expect(dto.deadline_time).toBeNull() // a date-only `{july 30}` brace stays date-only
  expect(dto.due?.time).toBe('16:00')
  expect(dto.due?.is_recurring).toBe(false)
  expect([addDaysIso(before, 1), addDaysIso(after, 1)]).toContain(dto.due?.date)
  expect(dto.labels).toEqual(['email'])

  const work = t.deps.db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, t.userId), sql`lower(${projects.name}) = 'work'`))
    .get()
  expect(work).toBeDefined()
  expect(dto.project_id).toBe(work?.id)

  const admin = t.deps.db
    .select()
    .from(sections)
    .where(and(eq(sections.userId, t.userId), sql`lower(${sections.name}) = 'admin'`))
    .get()
  expect(admin).toBeDefined()
  expect(dto.section_id).toBe(admin?.id)
  expect(admin?.projectId).toBe(work?.id)
})

it('quick-add: a timed `{…}` deadline persists and returns both date and wall-clock time', async () => {
  const t = await make()
  // `{july 30 5pm}` — a brace phrase with a time is no longer an error (owner divergence
  // 2026-07-18): the parser resolves the time and quick-add persists it alongside the date.
  const res = await t.post('/api/v1/tasks/quick', { text: 'wire retainer {july 30 5pm}' })
  expect(res.status).toBe(201)
  const dto = await json<TaskDto>(res)
  expect(dto.content).toBe('wire retainer')
  expect(dto.deadline_date).toMatch(/-07-30$/)
  expect(dto.deadline_time).toBe('17:00')
})

it('quick-add: reuses an existing project case-insensitively', async () => {
  const t = await make()
  const d1 = await json<TaskDto>(await t.post('/api/v1/tasks/quick', { text: 'task one #Work' }))
  const d2 = await json<TaskDto>(await t.post('/api/v1/tasks/quick', { text: 'task two #work' }))
  expect(d1.project_id).toBe(d2.project_id)

  const rows = t.deps.db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, t.userId), sql`lower(${projects.name}) = 'work'`))
    .all()
  expect(rows).toHaveLength(1)
})

it('close: an uncompletable task is a 409 problem', async () => {
  const t = await make()
  const created = await json<TaskDto>(
    await t.post('/api/v1/tasks/quick', { text: '* daily standup' }),
  )
  expect(created.uncompletable).toBe(true)

  const res = await t.post(`/api/v1/tasks/${created.id}/close`)
  expect(res.status).toBe(409)
  expect(res.headers.get('content-type')).toContain('application/problem+json')
  expect((await json<{ title: string }>(res)).title).toBe('task is uncompletable')
})

it('close: non-recurring completes the task and open subtasks and bumps day_stats; reopen reverses it', async () => {
  const t = await make()
  const parent = await json<TaskDto>(await t.post('/api/v1/tasks/quick', { text: 'ship release' }))
  const child = addSubtask(t, parent.id, parent.project_id, 'write release notes')

  const closeRes = await t.post(`/api/v1/tasks/${parent.id}/close`)
  expect(closeRes.status).toBe(200)
  const closed = await json<TaskDto>(closeRes)
  expect(closed.completed_at).not.toBeNull()

  const childRow = t.deps.db.select().from(tasks).where(eq(tasks.id, child.id)).get()
  expect(childRow?.completedAt).not.toBeNull()

  const today = utcToday()
  const stat = t.deps.db
    .select()
    .from(dayStats)
    .where(and(eq(dayStats.userId, t.userId), eq(dayStats.date, today)))
    .get()
  expect(stat?.completedCount).toBe(1) // root only

  const reopenRes = await t.post(`/api/v1/tasks/${parent.id}/reopen`)
  expect(reopenRes.status).toBe(200)
  expect((await json<TaskDto>(reopenRes)).completed_at).toBeNull()

  const statAfter = t.deps.db
    .select()
    .from(dayStats)
    .where(and(eq(dayStats.userId, t.userId), eq(dayStats.date, today)))
    .get()
  expect(statAfter?.completedCount).toBe(0)
})

it('reopen: 409 when the task is not completed', async () => {
  const t = await make()
  const created = await json<TaskDto>(await t.post('/api/v1/tasks/quick', { text: 'still open' }))
  const res = await t.post(`/api/v1/tasks/${created.id}/reopen`)
  expect(res.status).toBe(409)
  expect((await json<{ title: string }>(res)).title).toBe('not completed')
})

it('close: a schedule-anchored recurrence advances the due and stays open', async () => {
  const t = await make()
  const created = await json<TaskDto>(
    await t.post('/api/v1/tasks/quick', { text: 'water plants every day' }),
  )
  expect(created.due?.is_recurring).toBe(true)
  const d0 = created.due?.date
  expect(d0).toBeDefined()

  const res = await t.post(`/api/v1/tasks/${created.id}/close`)
  expect(res.status).toBe(200)
  const dto = await json<TaskDto>(res)
  expect(dto.completed_at).toBeNull()
  expect(dto.due?.is_recurring).toBe(true)
  if (d0 !== undefined) expect(dto.due?.date).toBe(addDaysIso(d0, 1))
})

it('close: a completion-anchored (every!) recurrence advances from today', async () => {
  const t = await make()
  const created = await json<TaskDto>(
    await t.post('/api/v1/tasks/quick', { text: 'stretch every! 3 days' }),
  )
  expect(created.due?.is_recurring).toBe(true)

  const today = utcToday()
  const res = await t.post(`/api/v1/tasks/${created.id}/close`)
  expect(res.status).toBe(200)
  const dto = await json<TaskDto>(res)
  expect(dto.completed_at).toBeNull()
  expect([addDaysIso(today, 3), addDaysIso(addDaysIso(today, 1), 3)]).toContain(dto.due?.date)
})

it('close: complete_series forces a final completion on a recurring task', async () => {
  const t = await make()
  const created = await json<TaskDto>(
    await t.post('/api/v1/tasks/quick', { text: 'water plants every day' }),
  )
  const res = await t.post(`/api/v1/tasks/${created.id}/close`, { complete_series: true })
  expect(res.status).toBe(200)
  const dto = await json<TaskDto>(res)
  expect(dto.completed_at).not.toBeNull()
})

it('close: re-closing an already-completed task is a 409 and never double-counts day_stats', async () => {
  const t = await make()
  const created = await json<TaskDto>(await t.post('/api/v1/tasks/quick', { text: 'one and done' }))

  expect((await t.post(`/api/v1/tasks/${created.id}/close`)).status).toBe(200)

  const again = await t.post(`/api/v1/tasks/${created.id}/close`)
  expect(again.status).toBe(409)
  expect(again.headers.get('content-type')).toContain('application/problem+json')
  expect((await json<{ title: string }>(again)).title).toBe('already completed')

  const stat = t.deps.db
    .select()
    .from(dayStats)
    .where(and(eq(dayStats.userId, t.userId), eq(dayStats.date, utcToday())))
    .get()
  expect(stat?.completedCount).toBe(1)
})

it('close: a malformed body is a 400 validation problem, not silently ignored', async () => {
  const t = await make()
  const created = await json<TaskDto>(
    await t.post('/api/v1/tasks/quick', { text: 'water plants every day' }),
  )

  // Wrong type for complete_series → 400, and the task must NOT be closed as an occurrence.
  const badType = await t.post(`/api/v1/tasks/${created.id}/close`, { complete_series: 'yes' })
  expect(badType.status).toBe(400)
  expect(badType.headers.get('content-type')).toContain('application/problem+json')
  expect((await json<{ title: string }>(badType)).title).toBe('validation failed')

  const badJson = await t.request(`/api/v1/tasks/${created.id}/close`, {
    method: 'POST',
    headers: { cookie: t.cookie, 'content-type': 'application/json' },
    body: 'not json{',
  })
  expect(badJson.status).toBe(400)
  expect((await json<{ title: string }>(badJson)).title).toBe('validation failed')

  // The failed closes changed nothing: due date is still the original occurrence.
  const after = await json<TaskDto>(await t.get(`/api/v1/tasks/${created.id}`))
  expect(after.due?.date).toBe(created.due?.date)
  expect(after.completed_at).toBeNull()

  // A body-less close (no content-type at all) still works: optional body semantics.
  const bare = await t.request(`/api/v1/tasks/${created.id}/close`, {
    method: 'POST',
    headers: { cookie: t.cookie },
  })
  expect(bare.status).toBe(200)
})

it('documents the optional close body in the OpenAPI contract', async () => {
  const t = await make()
  const doc = await json<{
    paths: Record<
      string,
      { post?: { requestBody?: { required?: boolean; content?: Record<string, unknown> } } }
    >
  }>(await t.get('/api/v1/openapi.json'))
  const close = doc.paths['/api/v1/tasks/{id}/close']?.post
  expect(close).toBeDefined()
  expect(close?.requestBody).toBeDefined()
  expect(close?.requestBody?.required).toBe(false)
  const schema = close?.requestBody?.content?.['application/json'] as
    | { schema?: { properties?: Record<string, unknown> } }
    | undefined
  expect(schema?.schema?.properties).toHaveProperty('complete_series')
})

it('close and reopen 404 for a missing task', async () => {
  const t = await make()
  expect((await t.post('/api/v1/tasks/does-not-exist/close')).status).toBe(404)
  expect((await t.post('/api/v1/tasks/does-not-exist/reopen')).status).toBe(404)
})

it('close: 404 when the task belongs to another user', async () => {
  const t = await make({ env: { OPENDOIST_ALLOW_REGISTRATION: 'true' } })
  const mine = await json<TaskDto>(await t.post('/api/v1/tasks/quick', { text: 'private note' }))

  const signup = await t.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Other', email: 'other@example.com', password: 'password1234' }),
  })
  expect(signup.status).toBe(200)
  const cookieB = signup.headers
    .getSetCookie()
    .map((v) => v.split(';')[0] ?? '')
    .filter((v) => v.length > 0)
    .join('; ')

  const res = await t.request(`/api/v1/tasks/${mine.id}/close`, {
    method: 'POST',
    headers: { cookie: cookieB, 'content-type': 'application/json' },
  })
  expect(res.status).toBe(404)
})
