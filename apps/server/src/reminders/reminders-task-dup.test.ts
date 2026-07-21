/**
 * Task C — reminders-dup INVARIANT GUARD (server side).
 *
 * The owner reported "adding a reminder duplicates the task". Task A's live recon could not
 * reproduce this: POST /reminders, quick-add `!` tokens, and multi-reminder tasks all leave
 * exactly one task, because the reminder route/materializer never insert a task and the task
 * list joins only labels (no reminder join → no row multiplication).
 *
 * These tests LOCK that invariant end-to-end with auto-reminders ON (the app default,
 * autoReminderMinutes = 30): however a reminder is attached, the active task count must not
 * change, and a task with several reminders must appear exactly once in GET /tasks. They are
 * written as guards, not a fails-pre-fix repro — there is no reproducible server-side dup to fix.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { afterEach, expect, it } from 'vitest'
import { tasks } from '../db/schema'
import type { TaskDto } from '../services/task-read'
import { createTestApp, json, type TestApp } from '../test/helpers'

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

interface TaskList {
  results: TaskDto[]
  next_cursor: string | null
}

/** Active tasks as the UI sees them (GET /tasks filters out completed/deleted). */
const listTasks = async (t: TestApp): Promise<TaskDto[]> =>
  (await json<TaskList>(await t.get('/api/v1/tasks'))).results

/** Live (non-deleted) task rows straight from sqlite — independent of the list route. */
const countLiveTasks = (t: TestApp): number =>
  t.deps.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.userId, t.userId), isNull(tasks.deletedAt)))
    .all().length

it('POST /reminders on a timed task never duplicates the task (auto-reminders ON)', async () => {
  const t = await make() // default autoReminderMinutes = 30
  const task = await json<TaskDto>(
    await t.post('/api/v1/tasks/quick', { text: 'Buy milk tomorrow 3pm' }),
  )
  expect((await listTasks(t)).length).toBe(1)
  expect(countLiveTasks(t)).toBe(1)

  const rem = await t.post('/api/v1/reminders', {
    task_id: task.id,
    type: 'relative',
    minute_offset: 15,
  })
  expect(rem.status).toBe(201)

  const after = await listTasks(t)
  expect(after.length).toBe(1)
  expect(after[0]?.id).toBe(task.id)
  expect(countLiveTasks(t)).toBe(1)
})

it('a quick-add `!` reminder token yields exactly one task', async () => {
  const t = await make()
  const created = await json<TaskDto>(
    await t.post('/api/v1/tasks/quick', { text: 'Buy milk tomorrow 3pm !30 min before' }),
  )
  const after = await listTasks(t)
  expect(after.length).toBe(1)
  expect(after[0]?.id).toBe(created.id)
  expect(countLiveTasks(t)).toBe(1)
})

it('a task with several reminders appears exactly once in GET /tasks (no row multiplication)', async () => {
  const t = await make()
  const task = await json<TaskDto>(
    await t.post('/api/v1/tasks/quick', { text: 'Pay rent tomorrow 5pm' }),
  )
  for (const minute_offset of [10, 20, 45]) {
    const res = await t.post('/api/v1/reminders', {
      task_id: task.id,
      type: 'relative',
      minute_offset,
    })
    expect(res.status).toBe(201)
  }
  const after = await listTasks(t)
  expect(after.filter((x) => x.id === task.id).length).toBe(1)
  expect(after.length).toBe(1)
  expect(countLiveTasks(t)).toBe(1)
})
