import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { reminders } from '../db/schema'
import type { TaskDto } from '../services/task-read'
import type { ReminderDto, TestFireResult } from './contracts'
import { createTestApp, json, seedTask, type TestApp } from './test-helpers'

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

type ReminderList = { results: ReminderDto[]; next_cursor: string | null }
const listReminders = async (t: TestApp, taskId?: string): Promise<ReminderDto[]> => {
  const res = await t.get(`/api/v1/reminders${taskId === undefined ? '' : `?task_id=${taskId}`}`)
  return (await json<ReminderList>(res)).results
}

/**
 * These paths return before ever calling `syncTaskReminders` (Task B), so they run today against
 * B's throwing stub. The lifecycle suite below needs B's real materialization and stays skipped.
 */
describe('reminder routes — validation & guards', () => {
  it('rejects an unauthenticated request', async () => {
    const t = await make()
    const res = await t.request('/api/v1/reminders')
    expect(res.status).toBe(401)
    expect(res.headers.get('content-type')).toContain('application/problem+json')
  })

  it('rejects a relative reminder with no minute_offset (400)', async () => {
    const t = await make()
    const res = await t.post('/api/v1/reminders', { task_id: 'whatever', type: 'relative' })
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toContain('application/problem+json')
  })

  it('rejects an absolute reminder with no due (400)', async () => {
    const t = await make()
    const res = await t.post('/api/v1/reminders', { task_id: 'whatever', type: 'absolute' })
    expect(res.status).toBe(400)
  })

  it('rejects a recurring reminder whose due has no recurrence (400)', async () => {
    const t = await make()
    const res = await t.post('/api/v1/reminders', {
      task_id: 'whatever',
      type: 'recurring',
      due: { date: '2026-08-01', time: '09:00', string: '2026-08-01 09:00', recurrence: null },
    })
    expect(res.status).toBe(400)
  })

  it('404s a reminder for an unknown task', async () => {
    const t = await make()
    const res = await t.post('/api/v1/reminders', {
      task_id: 'does-not-exist',
      type: 'absolute',
      due: { date: '2026-08-01', time: '09:00', string: '2026-08-01 09:00', recurrence: null },
    })
    expect(res.status).toBe(404)
  })

  it('400s a relative reminder on a task that has no due time', async () => {
    const t = await make()
    const { id } = await seedTask(t.deps.db, t.userId, { content: 'no due' })
    const res = await t.post('/api/v1/reminders', {
      task_id: id,
      type: 'relative',
      minute_offset: 30,
    })
    expect(res.status).toBe(400)
    const body = await json<{ title: string }>(res)
    expect(body.title).toContain('timed due')
  })
})

describe('reminder routes — lifecycle & hooks', () => {
  /** Disable the automatic reminder so a test sees only the rows it created. */
  const disableAuto = (t: TestApp) =>
    t.patch('/api/v1/user/settings', { autoReminderMinutes: null })

  it('creates, lists, updates, and deletes an absolute reminder', async () => {
    const t = await make()
    const { id: taskId } = await seedTask(t.deps.db, t.userId, { content: 'dateless task' })

    const created = await json<ReminderDto>(
      await t.post('/api/v1/reminders', {
        task_id: taskId,
        type: 'absolute',
        due: { date: '2026-08-01', time: '09:00', string: '2026-08-01 09:00', recurrence: null },
      }),
    )
    expect(created.type).toBe('absolute')
    expect(created.is_auto).toBe(false)
    expect(created.fire_at_utc).not.toBeNull()
    // dateless task → no auto-reminder materialized, so this is the only row.
    expect((await listReminders(t, taskId)).length).toBe(1)

    const patched = await json<ReminderDto>(
      await t.patch(`/api/v1/reminders/${created.id}`, {
        due: { date: '2026-08-02', time: '10:30', string: '2026-08-02 10:30', recurrence: null },
      }),
    )
    expect(patched.due?.time).toBe('10:30')
    expect(patched.fire_at_utc).not.toBe(created.fire_at_utc)

    const del = await t.del(`/api/v1/reminders/${created.id}`)
    expect(del.status).toBe(204)
    expect((await listReminders(t, taskId)).length).toBe(0)
  })

  it('persists a quick-add `!` reminder alongside both auto rows, correctly ordered', async () => {
    const t = await make() // default autoReminderMinutes = 30, timezone UTC
    const task = await json<TaskDto>(
      await t.post('/api/v1/tasks/quick', { text: 'Pay rent tomorrow 5pm !45 min before' }),
    )
    const rows = await listReminders(t, task.id)
    // at-time auto (0) + heads-up auto (30) + manual (45)
    expect(rows.length).toBe(3)

    const autos = rows
      .filter((r) => r.is_auto)
      .sort((a, b) => (a.minute_offset ?? 0) - (b.minute_offset ?? 0))
    const manual = rows.find((r) => !r.is_auto)
    expect(autos.map((r) => r.minute_offset)).toEqual([0, 30])
    expect(manual?.minute_offset).toBe(45)
    for (const r of rows) expect(r.fire_at_utc).not.toBeNull()
    // 45 before < 30 before < at-time for the same due time.
    const headsUp = autos[1]
    const atTime = autos[0]
    expect(String(manual?.fire_at_utc).localeCompare(String(headsUp?.fire_at_utc))).toBeLessThan(0)
    expect(String(headsUp?.fire_at_utc).localeCompare(String(atTime?.fire_at_utc))).toBeLessThan(0)
  })

  it('dedupes a quick-add reminder whose offset equals the auto-reminder offset', async () => {
    const t = await make() // autoReminderMinutes = 30
    const task = await json<TaskDto>(
      await t.post('/api/v1/tasks/quick', { text: 'Pay rent tomorrow 5pm !30 min before' }),
    )
    const rows = await listReminders(t, task.id)
    // the explicit (non-auto) reminder wins over its auto twin; the at-time row remains.
    expect(rows.length).toBe(2)
    const manual = rows.find((r) => !r.is_auto)
    const atTime = rows.find((r) => r.is_auto)
    expect(manual?.minute_offset).toBe(30)
    expect(atTime?.minute_offset).toBe(0)
  })

  it('skips a quick-add relative reminder when the task has no due time', async () => {
    const t = await make()
    const task = await json<TaskDto>(
      await t.post('/api/v1/tasks/quick', { text: 'buy milk !30 min before' }),
    )
    expect(await listReminders(t, task.id)).toEqual([])
  })

  it('nulls a relative reminder’s fire instant when its task is completed', async () => {
    const t = await make()
    await disableAuto(t)
    const task = await json<TaskDto>(
      await t.post('/api/v1/tasks/quick', { text: 'Pay rent tomorrow 5pm' }),
    )
    const created = await json<ReminderDto>(
      await t.post('/api/v1/reminders', { task_id: task.id, type: 'relative', minute_offset: 30 }),
    )
    expect(created.fire_at_utc).not.toBeNull()

    const close = await t.post(`/api/v1/tasks/${task.id}/close`)
    expect(close.status).toBe(200)
    const rows = await listReminders(t, task.id)
    expect(rows.length).toBe(1)
    expect(rows[0]?.fire_at_utc).toBeNull()
  })

  it('re-arms a fired reminder when its fire instant changes', async () => {
    const t = await make()
    await disableAuto(t)
    const task = await json<TaskDto>(
      await t.post('/api/v1/tasks/quick', { text: 'Pay rent tomorrow 5pm' }),
    )
    const created = await json<ReminderDto>(
      await t.post('/api/v1/reminders', { task_id: task.id, type: 'relative', minute_offset: 30 }),
    )
    // Simulate the scheduler having already dispatched it.
    t.deps.db
      .update(reminders)
      .set({ firedAt: '2020-01-01T00:00:00.000Z' })
      .where(eq(reminders.id, created.id))
      .run()

    const patched = await json<ReminderDto>(
      await t.patch(`/api/v1/reminders/${created.id}`, { minute_offset: 60 }),
    )
    expect(patched.minute_offset).toBe(60)
    expect(patched.fire_at_utc).not.toBe(created.fire_at_utc)
    expect(patched.fired_at).toBeNull() // re-armed
  })

  it('returns a delivery summary from the test-fire endpoint', async () => {
    const t = await make()
    const result = await json<TestFireResult>(await t.post('/api/v1/reminders/test'))
    // No push subscriptions and no channels configured → an all-zero summary.
    expect(result.push).toEqual({ sent: 0, gone: 0, errors: 0 })
    expect(result.channels).toEqual([])
  })
})
