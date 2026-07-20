import { addDaysIso, dateInTz } from '@opendoist/core'
import { afterEach, expect, it } from 'vitest'
import { projects, sections } from '../../db/schema'
import { newId, nowIso } from '../../lib/ids'
import type { TaskDto } from '../../services/task-read'
import { inboxProjectId } from '../../services/task-write'
import { createTestApp, json, type TestApp } from '../../test/helpers'

let apps: TestApp[] = []
async function make(env?: Record<string, string>): Promise<TestApp> {
  const t = await createTestApp(env ? { env } : undefined)
  apps.push(t)
  return t
}
afterEach(() => {
  for (const t of apps) t.close()
  apps = []
})

interface TaskList {
  results: TaskDto[]
  next_cursor: string | null
}

/** Insert a project directly — the projects router is a sibling task and may still be a stub. */
function makeProject(t: TestApp, name: string): string {
  const id = newId()
  const now = nowIso()
  t.deps.db
    .insert(projects)
    .values({ id, userId: t.userId, name, createdAt: now, updatedAt: now })
    .run()
  return id
}

async function signupSecond(
  app: TestApp['app'],
  email: string,
): Promise<{ cookie: string; userId: string }> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Other', email, password: 'password1234' }),
  })
  if (!res.ok) throw new Error(`second signup failed: ${res.status} ${await res.text()}`)
  const cookie = res.headers
    .getSetCookie()
    .map((v) => v.split(';')[0] ?? '')
    .filter((v) => v.length > 0)
    .join('; ')
  const session = (await (
    await app.request('/api/auth/get-session', { headers: { cookie } })
  ).json()) as { user: { id: string } }
  return { cookie, userId: session.user.id }
}

it('creates a task with defaults (inbox project, priority 4, child_order 0)', async () => {
  const t = await make()
  const res = await t.post('/api/v1/tasks', { content: 'Buy milk' })
  expect(res.status).toBe(201)
  const dto = await json<TaskDto>(res)
  expect(dto.content).toBe('Buy milk')
  expect(dto.priority).toBe(4)
  expect(dto.child_order).toBe(0)
  expect(dto.due).toBeNull()
  expect(dto.labels).toEqual([])
  expect(dto.uncompletable).toBe(false)
  expect(dto.project_id).toBe(inboxProjectId(t.deps.db, t.userId))
})

it('resolves a natural-language due string', async () => {
  const t = await make()
  const before = dateInTz(new Date().toISOString(), 'UTC')
  const res = await t.post('/api/v1/tasks', { content: 'Ship it', due: { string: 'tomorrow 4pm' } })
  const after = dateInTz(new Date().toISOString(), 'UTC')
  expect(res.status).toBe(201)
  const dto = await json<TaskDto>(res)
  expect(dto.due).not.toBeNull()
  expect([addDaysIso(before, 1), addDaysIso(after, 1)]).toContain(dto.due?.date)
  expect(dto.due?.time).toBe('16:00')
  expect(dto.due?.is_recurring).toBe(false)
  expect(dto.due?.string).toBe('tomorrow 4pm')
})

it('auto-creates labels referenced by name', async () => {
  const t = await make()
  const dto = await json<TaskDto>(
    await t.post('/api/v1/tasks', { content: 'Chores', labels: ['home', 'errands'] }),
  )
  expect(dto.labels).toEqual(['home', 'errands'])
  const again = await json<TaskDto>(await t.get(`/api/v1/tasks/${dto.id}`))
  expect(again.labels).toEqual(['home', 'errands'])
})

it('derives uncompletable from a leading "* "', async () => {
  const t = await make()
  const dto = await json<TaskDto>(await t.post('/api/v1/tasks', { content: '* Read-only ritual' }))
  expect(dto.uncompletable).toBe(true)
})

it('paginates the open task list with a keyset cursor', async () => {
  const t = await make()
  for (const name of ['A', 'B', 'C']) await t.post('/api/v1/tasks', { content: name })
  const p1 = await json<TaskList>(await t.get('/api/v1/tasks?limit=2'))
  expect(p1.results).toHaveLength(2)
  expect(p1.next_cursor).not.toBeNull()
  const cursor = p1.next_cursor ?? ''
  const p2 = await json<TaskList>(
    await t.get(`/api/v1/tasks?limit=2&cursor=${encodeURIComponent(cursor)}`),
  )
  expect(p2.results).toHaveLength(1)
  expect(p2.next_cursor).toBeNull()
  expect([...p1.results, ...p2.results].map((r) => r.content)).toEqual(['A', 'B', 'C'])
})

it('filters the list by project_id', async () => {
  const t = await make()
  const projectId = makeProject(t, 'Work')
  await t.post('/api/v1/tasks', { content: 'inbox task' })
  await t.post('/api/v1/tasks', { content: 'work task', project_id: projectId })
  const list = await json<TaskList>(await t.get(`/api/v1/tasks?project_id=${projectId}`))
  expect(list.results).toHaveLength(1)
  expect(list.results[0]?.content).toBe('work task')
})

it('filters the list by label name', async () => {
  const t = await make()
  await t.post('/api/v1/tasks', { content: 'tagged', labels: ['home'] })
  await t.post('/api/v1/tasks', { content: 'untagged' })
  const list = await json<TaskList>(await t.get('/api/v1/tasks?label=home'))
  expect(list.results).toHaveLength(1)
  expect(list.results[0]?.content).toBe('tagged')
})

it('patches priority and replaces the label set, leaving omitted fields intact', async () => {
  const t = await make()
  const dto = await json<TaskDto>(
    await t.post('/api/v1/tasks', { content: 'x', priority: 3, labels: ['a', 'b'] }),
  )
  const updated = await json<TaskDto>(
    await t.patch(`/api/v1/tasks/${dto.id}`, { priority: 1, labels: ['c'] }),
  )
  expect(updated.priority).toBe(1)
  expect(updated.labels).toEqual(['c'])

  // A PATCH that omits priority/labels must NOT reset them (Zod .partial() still applies defaults).
  const second = await json<TaskDto>(
    await t.patch(`/api/v1/tasks/${dto.id}`, { content: 'renamed' }),
  )
  expect(second.content).toBe('renamed')
  expect(second.priority).toBe(1)
  expect(second.labels).toEqual(['c'])
})

it('clears all due fields when due is set to null', async () => {
  const t = await make()
  const dto = await json<TaskDto>(
    await t.post('/api/v1/tasks', { content: 'x', due: { string: 'tomorrow 4pm' } }),
  )
  expect(dto.due).not.toBeNull()
  const updated = await json<TaskDto>(await t.patch(`/api/v1/tasks/${dto.id}`, { due: null }))
  expect(updated.due).toBeNull()
})

it('persists an explicit deadline date + time and round-trips a PATCH that retimes then clears it', async () => {
  const t = await make()
  const dto = await json<TaskDto>(
    await t.post('/api/v1/tasks', {
      content: 'file 1099',
      deadline_date: '2026-08-01',
      deadline_time: '09:00',
    }),
  )
  expect(dto.deadline_date).toBe('2026-08-01')
  expect(dto.deadline_time).toBe('09:00')

  // Retime only: the date is untouched, the time updates.
  const retimed = await json<TaskDto>(
    await t.patch(`/api/v1/tasks/${dto.id}`, { deadline_time: '17:30' }),
  )
  expect(retimed.deadline_date).toBe('2026-08-01')
  expect(retimed.deadline_time).toBe('17:30')

  // Clearing the date clears the time with it (a deadline time never outlives its date).
  const cleared = await json<TaskDto>(
    await t.patch(`/api/v1/tasks/${dto.id}`, { deadline_date: null }),
  )
  expect(cleared.deadline_date).toBeNull()
  expect(cleared.deadline_time).toBeNull()
})

it('keeps a date-only deadline unchanged (no time), preserving pre-time behavior', async () => {
  const t = await make()
  const dto = await json<TaskDto>(
    await t.post('/api/v1/tasks', { content: 'taxes', deadline_date: '2026-08-01' }),
  )
  expect(dto.deadline_date).toBe('2026-08-01')
  expect(dto.deadline_time).toBeNull()
})

it('PATCH never persists an orphaned deadline_time (a time never outlives its date)', async () => {
  const t = await make()
  const dto = await json<TaskDto>(await t.post('/api/v1/tasks', { content: 'no deadline yet' }))
  expect(dto.deadline_date).toBeNull()

  // Time-only patch on a dateless task: coerced to null, matching createTask's invariant.
  const patched = await json<TaskDto>(
    await t.patch(`/api/v1/tasks/${dto.id}`, { deadline_time: '13:00' }),
  )
  expect(patched.deadline_date).toBeNull()
  expect(patched.deadline_time).toBeNull()
  const fetched = await json<TaskDto>(await t.get(`/api/v1/tasks/${dto.id}`))
  expect(fetched.deadline_time).toBeNull()

  // Date + time arriving in the same patch is the supported way to add a timed deadline …
  const timed = await json<TaskDto>(
    await t.patch(`/api/v1/tasks/${dto.id}`, {
      deadline_date: '2026-08-01',
      deadline_time: '13:00',
    }),
  )
  expect(timed.deadline_date).toBe('2026-08-01')
  expect(timed.deadline_time).toBe('13:00')

  // … and clearing the date wins over a time sent in the same body (never an orphan).
  const cleared = await json<TaskDto>(
    await t.patch(`/api/v1/tasks/${dto.id}`, { deadline_date: null, deadline_time: '09:00' }),
  )
  expect(cleared.deadline_date).toBeNull()
  expect(cleared.deadline_time).toBeNull()
})

it('rejects malformed deadline_time with 400 on create and patch (HH:mm only)', async () => {
  const t = await make()
  const bad = await t.post('/api/v1/tasks', {
    content: 'garbage time',
    deadline_date: '2026-08-01',
    deadline_time: 'banana',
  })
  expect(bad.status).toBe(400)

  const dto = await json<TaskDto>(
    await t.post('/api/v1/tasks', {
      content: 'ok',
      deadline_date: '2026-08-01',
      deadline_time: '23:59',
    }),
  )
  expect(dto.deadline_time).toBe('23:59')

  for (const invalid of ['24:00', '9:00', '13:5', '1pm']) {
    const res = await t.patch(`/api/v1/tasks/${dto.id}`, { deadline_time: invalid })
    expect(res.status).toBe(400)
  }
  // The rejected patches persisted nothing.
  const fetched = await json<TaskDto>(await t.get(`/api/v1/tasks/${dto.id}`))
  expect(fetched.deadline_time).toBe('23:59')
})

it('soft-deletes a task and cascades to its subtasks', async () => {
  const t = await make()
  const parent = await json<TaskDto>(await t.post('/api/v1/tasks', { content: 'parent' }))
  const child = await json<TaskDto>(
    await t.post('/api/v1/tasks', { content: 'child', parent_id: parent.id }),
  )
  const del = await t.del(`/api/v1/tasks/${parent.id}`)
  expect(del.status).toBe(204)
  expect((await t.get(`/api/v1/tasks/${parent.id}`)).status).toBe(404)
  expect((await t.get(`/api/v1/tasks/${child.id}`)).status).toBe(404)
})

it('moves a task to a new project and carries its subtree', async () => {
  const t = await make()
  const dest = makeProject(t, 'Dest')
  const parent = await json<TaskDto>(await t.post('/api/v1/tasks', { content: 'parent' }))
  const child = await json<TaskDto>(
    await t.post('/api/v1/tasks', { content: 'child', parent_id: parent.id }),
  )
  const res = await t.post(`/api/v1/tasks/${parent.id}/move`, { project_id: dest })
  expect(res.status).toBe(200)
  expect((await json<TaskDto>(res)).project_id).toBe(dest)
  const childAfter = await json<TaskDto>(await t.get(`/api/v1/tasks/${child.id}`))
  expect(childAfter.project_id).toBe(dest)
})

it('reorders tasks by child_order', async () => {
  const t = await make()
  const a = await json<TaskDto>(await t.post('/api/v1/tasks', { content: 'a' }))
  const b = await json<TaskDto>(await t.post('/api/v1/tasks', { content: 'b' }))
  const res = await t.post('/api/v1/tasks/reorder', {
    items: [
      { id: a.id, child_order: 5 },
      { id: b.id, child_order: 2 },
    ],
  })
  expect(res.status).toBe(204)
  const list = await json<TaskList>(await t.get('/api/v1/tasks'))
  expect(list.results.map((r) => r.content)).toEqual(['b', 'a'])
})

it('move honors an explicit child_order so an undo restores the original position', async () => {
  const t = await make()
  const dest = makeProject(t, 'Beta')
  const a = await json<TaskDto>(await t.post('/api/v1/tasks', { content: 'a' }))
  const b = await json<TaskDto>(await t.post('/api/v1/tasks', { content: 'b' }))
  await t.post('/api/v1/tasks', { content: 'c' })
  expect(b.child_order).toBe(1)

  // Forward move without child_order keeps the append-in-destination behavior…
  const moved = await json<TaskDto>(
    await t.post(`/api/v1/tasks/${b.id}/move`, { project_id: dest }),
  )
  expect(moved.child_order).toBe(0)

  // …and the inverse move carries the captured child_order back verbatim (spec §2.4:
  // inverse-operation undo restores the exact prior state, position included).
  const undone = await json<TaskDto>(
    await t.post(`/api/v1/tasks/${b.id}/move`, {
      project_id: a.project_id,
      section_id: null,
      parent_id: null,
      child_order: 1,
    }),
  )
  expect(undone.child_order).toBe(1)
  const list = await json<TaskList>(await t.get('/api/v1/tasks'))
  expect(list.results.map((r) => r.content)).toEqual(['a', 'b', 'c'])
})

it('stores a natural-language due string verbatim when an explicit date pins the resolved value', async () => {
  const t = await make()
  const created = await json<TaskDto>(
    await t.post('/api/v1/tasks', { content: 'x', due: { string: 'today' } }),
  )
  expect(created.due?.string).toBe('today')

  // Undo of a reschedule restores the FULL previous due: the explicit date/time must win
  // over re-parsing the phrase (which by then could resolve to a different day) and the
  // phrase itself must round-trip unchanged.
  const restored = await json<TaskDto>(
    await t.patch(`/api/v1/tasks/${created.id}`, { due: { string: 'today', date: '2030-01-15' } }),
  )
  expect(restored.due?.date).toBe('2030-01-15')
  expect(restored.due?.time).toBeNull()
  expect(restored.due?.string).toBe('today')
  expect(restored.due?.is_recurring).toBe(false)
})

it('keeps the exact occurrence when a recurring due string arrives with an explicit date', async () => {
  const t = await make()
  // Restoring an overdue recurring occurrence: re-parsing "every day" from now would land on
  // a future date, but the explicit date pins the stored occurrence exactly.
  const dto = await json<TaskDto>(
    await t.post('/api/v1/tasks', {
      content: 'r',
      due: { string: 'every day 9am', date: '2020-05-05', time: '09:00' },
    }),
  )
  expect(dto.due?.is_recurring).toBe(true)
  expect(dto.due?.date).toBe('2020-05-05')
  expect(dto.due?.time).toBe('09:00')
  expect(dto.due?.string).toBe('every day 9am')
})

it('rejects a move that would create a parent cycle', async () => {
  const t = await make()
  const parent = await json<TaskDto>(await t.post('/api/v1/tasks', { content: 'parent' }))
  const child = await json<TaskDto>(
    await t.post('/api/v1/tasks', { content: 'child', parent_id: parent.id }),
  )
  const res = await t.post(`/api/v1/tasks/${parent.id}/move`, { parent_id: child.id })
  expect(res.status).toBe(400)
  expect(res.headers.get('content-type')).toContain('application/problem+json')
})

it('returns 404 for a missing task id', async () => {
  const t = await make()
  expect((await t.get('/api/v1/tasks/does-not-exist')).status).toBe(404)
})

it("returns 404 for another user's task", async () => {
  const t = await make({ OPENDOIST_ALLOW_REGISTRATION: 'true' })
  const other = await signupSecond(t.app, 'other@example.com')
  const created = await t.app.request('/api/v1/tasks', {
    method: 'POST',
    headers: { cookie: other.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'secret' }),
  })
  expect(created.status).toBe(201)
  const otherTask = await json<TaskDto>(created)
  const res = await t.get(`/api/v1/tasks/${otherTask.id}`)
  expect(res.status).toBe(404)
})

it('rejects a malformed cursor with a 400 problem', async () => {
  const t = await make()
  const res = await t.get(`/api/v1/tasks?cursor=${encodeURIComponent('!!!not-valid')}`)
  expect(res.status).toBe(400)
  expect(res.headers.get('content-type')).toContain('application/problem+json')
  expect((await json<{ title: string }>(res)).title).toBe('invalid cursor')
})

it('rejects writes from a read-scoped API key but allows reads', async () => {
  const t = await make()
  // better-auth 1.6.23 only lets privileged fields (permissions) be set from a server-instance
  // call — i.e. userId in the body, NO session headers. Passing `headers` throws SERVER_ONLY.
  const created = await t.deps.auth.api.createApiKey({
    body: { name: 't', userId: t.userId, permissions: { opendoist: ['read'] } },
  })
  const bearer = `Bearer ${created.key}`

  const readRes = await t.app.request('/api/v1/tasks', { headers: { authorization: bearer } })
  expect(readRes.status).toBe(200)

  const writeRes = await t.app.request('/api/v1/tasks', {
    method: 'POST',
    headers: { authorization: bearer, 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'nope' }),
  })
  expect(writeRes.status).toBe(403)
  expect(writeRes.headers.get('content-type')).toContain('application/problem+json')
})

/** Insert a section for an arbitrary user directly (the sections router is a sibling task). */
function makeSectionFor(t: TestApp, userId: string, projectId: string, name: string): string {
  const id = newId()
  const now = nowIso()
  t.deps.db
    .insert(sections)
    .values({ id, userId, projectId, name, createdAt: now, updatedAt: now })
    .run()
  return id
}

it("rejects creating a task referencing another tenant's or unknown project/section/parent", async () => {
  const t = await make({ OPENDOIST_ALLOW_REGISTRATION: 'true' })
  const other = await signupSecond(t.app, 'other@example.com')
  const otherInbox = inboxProjectId(t.deps.db, other.userId)

  // Another tenant's project must be unreachable…
  const cross = await t.post('/api/v1/tasks', { content: 'intruder', project_id: otherInbox })
  expect(cross.status).toBe(400)
  expect(cross.headers.get('content-type')).toContain('application/problem+json')
  expect((await json<{ title: string }>(cross)).title).toBe('invalid reference')

  // …and an unknown id is a 400 problem, not an unhandled SQLite FK 500.
  const ghost = await t.post('/api/v1/tasks', { content: 'x', project_id: 'does-not-exist-xxxx' })
  expect(ghost.status).toBe(400)
  expect((await json<{ title: string }>(ghost)).title).toBe('invalid reference')

  expect((await t.post('/api/v1/tasks', { content: 'x', section_id: 'nope' })).status).toBe(400)
  expect((await t.post('/api/v1/tasks', { content: 'x', parent_id: 'nope' })).status).toBe(400)

  const otherTask = await json<TaskDto>(
    await t.app.request('/api/v1/tasks', {
      method: 'POST',
      headers: { cookie: other.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'theirs' }),
    }),
  )
  expect((await t.post('/api/v1/tasks', { content: 'x', parent_id: otherTask.id })).status).toBe(
    400,
  )

  // Nothing leaked into the other tenant's project.
  const listB = await t.app.request(`/api/v1/tasks?project_id=${otherInbox}`, {
    headers: { cookie: other.cookie },
  })
  const bTasks = await json<TaskList>(listB)
  expect(bTasks.results.map((r) => r.content)).toEqual(['theirs'])
})

it("rejects PATCHing task references to another tenant's rows or into a parent cycle", async () => {
  const t = await make({ OPENDOIST_ALLOW_REGISTRATION: 'true' })
  const other = await signupSecond(t.app, 'other@example.com')
  const otherInbox = inboxProjectId(t.deps.db, other.userId)
  const otherSection = makeSectionFor(t, other.userId, otherInbox, 'Their section')

  const mine = await json<TaskDto>(await t.post('/api/v1/tasks', { content: 'mine' }))
  const child = await json<TaskDto>(
    await t.post('/api/v1/tasks', { content: 'child', parent_id: mine.id }),
  )

  const crossProject = await t.patch(`/api/v1/tasks/${mine.id}`, { project_id: otherInbox })
  expect(crossProject.status).toBe(400)
  expect((await json<{ title: string }>(crossProject)).title).toBe('invalid reference')

  expect((await t.patch(`/api/v1/tasks/${mine.id}`, { project_id: 'ghost' })).status).toBe(400)
  expect((await t.patch(`/api/v1/tasks/${mine.id}`, { section_id: otherSection })).status).toBe(400)
  expect((await t.patch(`/api/v1/tasks/${mine.id}`, { parent_id: 'ghost' })).status).toBe(400)

  const selfCycle = await t.patch(`/api/v1/tasks/${mine.id}`, { parent_id: mine.id })
  expect(selfCycle.status).toBe(400)
  const descendantCycle = await t.patch(`/api/v1/tasks/${mine.id}`, { parent_id: child.id })
  expect(descendantCycle.status).toBe(400)
  expect((await json<{ detail: string }>(descendantCycle)).detail).toContain('cycle')

  // All rejected updates left the task untouched.
  const after = await json<TaskDto>(await t.get(`/api/v1/tasks/${mine.id}`))
  expect(after.project_id).toBe(mine.project_id)
  expect(after.section_id).toBeNull()
  expect(after.parent_id).toBeNull()
})

it('still accepts valid reference updates through PATCH (own project, clearing parent)', async () => {
  const t = await make()
  const p2 = makeProject(t, 'Second project')
  const mine = await json<TaskDto>(await t.post('/api/v1/tasks', { content: 'movable' }))
  const child = await json<TaskDto>(
    await t.post('/api/v1/tasks', { content: 'child', parent_id: mine.id }),
  )

  const moved = await t.patch(`/api/v1/tasks/${mine.id}`, { project_id: p2 })
  expect(moved.status).toBe(200)
  expect((await json<TaskDto>(moved)).project_id).toBe(p2)

  const cleared = await t.patch(`/api/v1/tasks/${child.id}`, { parent_id: null })
  expect(cleared.status).toBe(200)
  expect((await json<TaskDto>(cleared)).parent_id).toBeNull()
})

it("rejects moving a task into another tenant's section", async () => {
  const t = await make({ OPENDOIST_ALLOW_REGISTRATION: 'true' })
  const other = await signupSecond(t.app, 'other@example.com')
  const otherInbox = inboxProjectId(t.deps.db, other.userId)
  const otherSection = makeSectionFor(t, other.userId, otherInbox, 'Their section')

  const mine = await json<TaskDto>(await t.post('/api/v1/tasks', { content: 'mine' }))
  const res = await t.post(`/api/v1/tasks/${mine.id}/move`, { section_id: otherSection })
  expect(res.status).toBe(400)
  expect((await json<{ title: string }>(res)).title).toBe('invalid move')
})

it('restores a soft-deleted task and its whole subtree via /restore', async () => {
  const t = await make()
  const parent = await json<TaskDto>(await t.post('/api/v1/tasks', { content: 'parent' }))
  const child = await json<TaskDto>(
    await t.post('/api/v1/tasks', { content: 'child', parent_id: parent.id }),
  )
  expect((await t.del(`/api/v1/tasks/${parent.id}`)).status).toBe(204)

  const gone = await json<TaskList>(await t.get('/api/v1/tasks'))
  expect(gone.results.some((r) => r.id === parent.id)).toBe(false)
  expect(gone.results.some((r) => r.id === child.id)).toBe(false)

  const res = await t.post(`/api/v1/tasks/${parent.id}/restore`)
  expect(res.status).toBe(200)
  expect(await json<{ ok: boolean }>(res)).toEqual({ ok: true })

  const back = await json<TaskList>(await t.get('/api/v1/tasks'))
  expect(back.results.some((r) => r.id === parent.id)).toBe(true)
  expect(back.results.some((r) => r.id === child.id)).toBe(true)
})

it('restoring a live (non-deleted) task id is a 404', async () => {
  const t = await make()
  const task = await json<TaskDto>(await t.post('/api/v1/tasks', { content: 'live' }))
  expect((await t.post(`/api/v1/tasks/${task.id}/restore`)).status).toBe(404)
})

it('lists completed tasks and filters by since/until on completed_at', async () => {
  const t = await make()
  const a = await json<TaskDto>(await t.post('/api/v1/tasks', { content: 'done A' }))
  expect((await t.post(`/api/v1/tasks/${a.id}/close`)).status).toBe(200)

  const all = await json<TaskList>(await t.get('/api/v1/tasks/completed'))
  expect(all.results.some((r) => r.id === a.id)).toBe(true)

  // completed_at is "now": a far-future `since` excludes it, an ancient `since` keeps it.
  const future = await json<TaskList>(await t.get('/api/v1/tasks/completed?since=2999-01-01'))
  expect(future.results.some((r) => r.id === a.id)).toBe(false)
  const past = await json<TaskList>(await t.get('/api/v1/tasks/completed?since=2000-01-01'))
  expect(past.results.some((r) => r.id === a.id)).toBe(true)
  const untilPast = await json<TaskList>(await t.get('/api/v1/tasks/completed?until=2000-01-01'))
  expect(untilPast.results.some((r) => r.id === a.id)).toBe(false)
})
