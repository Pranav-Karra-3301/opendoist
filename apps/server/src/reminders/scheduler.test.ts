import { dateInTz, timeInTz } from '@opentask/core'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reminders } from '../db/schema'
import type { SchedulerDeps } from './scheduler'
import { runSchedulerTick, startReminderScheduler } from './scheduler'
import { makeTestDb, seedReminder, seedTask, seedUser } from './test-helpers'

/** A minute-count offset from a fixed instant, as an ISO ms UTC string. */
function minutesFrom(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString()
}

function fakeDeps(
  now: string,
  dispatch: SchedulerDeps['dispatch'] = vi.fn(async () => {}),
): SchedulerDeps {
  return { now: () => now, dispatch, log: () => {} }
}

describe('runSchedulerTick', () => {
  const NOW = '2026-07-16T20:05:00.000Z'

  it('claims and dispatches a fresh overdue reminder exactly once across repeated ticks', async () => {
    const { db, close } = await makeTestDb()
    try {
      const { userId } = await seedUser(db)
      const { id: taskId } = await seedTask(db, userId, { dueDate: '2026-07-16', dueTime: '16:00' })
      const { id } = await seedReminder(db, {
        userId,
        taskId,
        type: 'relative',
        fireAtUtc: minutesFrom(NOW, -2), // 2 minutes past
        firedAt: null,
      })
      const dispatch = vi.fn(async () => {})
      const deps = fakeDeps(NOW, dispatch)

      const first = await runSchedulerTick(db, deps)
      const second = await runSchedulerTick(db, deps)

      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(dispatch).toHaveBeenCalledWith(id)
      expect(first).toMatchObject({ claimed: 1, dispatched: 1, suppressed: 0 })
      expect(second).toMatchObject({ claimed: 0, dispatched: 0 })
      const row = db.select().from(reminders).where(eq(reminders.id, id)).get()
      expect(row?.firedAt).toBe(NOW)
    } finally {
      close()
    }
  })

  it('catch-up: dispatches a reminder whose instant is a few minutes past', async () => {
    const { db, close } = await makeTestDb()
    try {
      const { userId } = await seedUser(db)
      const { id: taskId } = await seedTask(db, userId, { dueDate: '2026-07-16', dueTime: '16:00' })
      await seedReminder(db, {
        userId,
        taskId,
        type: 'relative',
        fireAtUtc: minutesFrom(NOW, -5),
        firedAt: null,
      })
      const dispatch = vi.fn(async () => {})
      const res = await runSchedulerTick(db, fakeDeps(NOW, dispatch))
      expect(res.dispatched).toBe(1)
      expect(dispatch).toHaveBeenCalledTimes(1)
    } finally {
      close()
    }
  })

  it('staleness: suppresses (marks fired, no dispatch) a reminder more than 12h overdue', async () => {
    const { db, close } = await makeTestDb()
    try {
      const { userId } = await seedUser(db)
      const { id: taskId } = await seedTask(db, userId, { dueDate: '2026-07-16', dueTime: '06:00' })
      const { id } = await seedReminder(db, {
        userId,
        taskId,
        type: 'relative',
        fireAtUtc: minutesFrom(NOW, -13 * 60), // 13h past → stale
        firedAt: null,
      })
      const dispatch = vi.fn(async () => {})
      const res = await runSchedulerTick(db, fakeDeps(NOW, dispatch))

      expect(res).toMatchObject({ claimed: 1, dispatched: 0, suppressed: 1 })
      expect(dispatch).not.toHaveBeenCalled()
      const row = db.select().from(reminders).where(eq(reminders.id, id)).get()
      expect(row?.firedAt).toBe(NOW) // stays fired — never retried
    } finally {
      close()
    }
  })

  it('batch: claims at most SCHEDULER_BATCH_LIMIT per tick, draining across ticks', async () => {
    const { db, close } = await makeTestDb()
    try {
      const { userId } = await seedUser(db)
      const { id: taskId } = await seedTask(db, userId, { dueDate: '2026-07-16', dueTime: '16:00' })
      for (let i = 0; i < 120; i++) {
        await seedReminder(db, {
          userId,
          taskId,
          type: 'relative',
          fireAtUtc: minutesFrom(NOW, -1),
          firedAt: null,
        })
      }
      const deps = fakeDeps(NOW)
      const first = await runSchedulerTick(db, deps)
      const second = await runSchedulerTick(db, deps)
      const third = await runSchedulerTick(db, deps)

      expect(first.claimed).toBe(100)
      expect(second.claimed).toBe(20)
      expect(third.claimed).toBe(0)
    } finally {
      close()
    }
  })

  it('does not touch reminders whose instant is still in the future', async () => {
    const { db, close } = await makeTestDb()
    try {
      const { userId } = await seedUser(db)
      const { id: taskId } = await seedTask(db, userId, { dueDate: '2026-07-16', dueTime: '23:00' })
      await seedReminder(db, {
        userId,
        taskId,
        type: 'relative',
        fireAtUtc: minutesFrom(NOW, +30),
        firedAt: null,
      })
      const dispatch = vi.fn(async () => {})
      const res = await runSchedulerTick(db, fakeDeps(NOW, dispatch))
      expect(res).toMatchObject({ claimed: 0, dispatched: 0 })
      expect(dispatch).not.toHaveBeenCalled()
    } finally {
      close()
    }
  })

  it('skips reminders that are already fired (fireAtUtc past but firedAt set)', async () => {
    const { db, close } = await makeTestDb()
    try {
      const { userId } = await seedUser(db)
      const { id: taskId } = await seedTask(db, userId, { dueDate: '2026-07-16', dueTime: '16:00' })
      await seedReminder(db, {
        userId,
        taskId,
        type: 'relative',
        fireAtUtc: minutesFrom(NOW, -10),
        firedAt: minutesFrom(NOW, -9),
      })
      const dispatch = vi.fn(async () => {})
      const res = await runSchedulerTick(db, fakeDeps(NOW, dispatch))
      expect(res.claimed).toBe(0)
      expect(dispatch).not.toHaveBeenCalled()
    } finally {
      close()
    }
  })

  it('DST fire time: dispatches an absolute 09:00 New York reminder across the spring-forward boundary', async () => {
    const { db, close } = await makeTestDb()
    try {
      const { userId } = await seedUser(db) // America/New_York
      const { id: taskId } = await seedTask(db, userId, { dueDate: '2026-03-08', dueTime: '09:00' })
      // 2026-03-08 09:00 America/New_York is 13:00 UTC (clocks already sprang forward to EDT, UTC-4).
      const fireAt = '2026-03-08T13:00:00.000Z'
      const { id } = await seedReminder(db, {
        userId,
        taskId,
        type: 'absolute',
        dueJson: JSON.stringify({
          date: '2026-03-08',
          time: '09:00',
          string: '2026-03-08 09:00',
          recurrence: null,
        }),
        fireAtUtc: fireAt,
        firedAt: null,
      })
      const dispatch = vi.fn(async () => {})
      const res = await runSchedulerTick(db, fakeDeps('2026-03-08T13:00:05.000Z', dispatch))
      expect(res.dispatched).toBe(1)
      expect(dispatch).toHaveBeenCalledWith(id)
    } finally {
      close()
    }
  })

  it('continues the tick when a single dispatch throws (a channel explosion cannot kill the batch)', async () => {
    const { db, close } = await makeTestDb()
    try {
      const { userId } = await seedUser(db)
      const { id: taskId } = await seedTask(db, userId, { dueDate: '2026-07-16', dueTime: '16:00' })
      await seedReminder(db, {
        userId,
        taskId,
        type: 'relative',
        fireAtUtc: minutesFrom(NOW, -3),
        firedAt: null,
      })
      await seedReminder(db, {
        userId,
        taskId,
        type: 'relative',
        fireAtUtc: minutesFrom(NOW, -2),
        firedAt: null,
      })
      const dispatch = vi
        .fn<(id: string) => Promise<void>>()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce()
      const res = await runSchedulerTick(db, fakeDeps(NOW, dispatch))
      expect(res.claimed).toBe(2) // both claimed
      expect(res.dispatched).toBe(1) // one threw, one succeeded
      expect(dispatch).toHaveBeenCalledTimes(2)
    } finally {
      close()
    }
  })

  it('advances a recurring reminder to its next occurrence and re-arms it (fired_at null)', async () => {
    const { db, close } = await makeTestDb()
    try {
      const { userId, timezone } = await seedUser(db) // America/New_York
      const { id: taskId } = await seedTask(db, userId, { dueDate: '2026-07-16', dueTime: '17:00' })
      const due = {
        date: '2026-07-16',
        time: '17:00',
        string: 'every day at 17:00',
        recurrence: {
          anchor: 'schedule',
          freq: 'daily',
          interval: 1,
          weekdays: [],
          monthDays: [],
          ordinal: null,
          ordinals: [],
          dates: [],
          times: ['17:00'],
          starting: null,
          until: null,
        },
      }
      // 2026-07-16 17:00 America/New_York (EDT) = 21:00 UTC.
      const { id } = await seedReminder(db, {
        userId,
        taskId,
        type: 'recurring',
        dueJson: JSON.stringify(due),
        fireAtUtc: '2026-07-16T21:00:00.000Z',
        firedAt: null,
      })
      const res = await runSchedulerTick(db, fakeDeps('2026-07-16T21:00:05.000Z'))

      expect(res.dispatched).toBe(1)
      expect(res.advanced).toBe(1)
      const row = db.select().from(reminders).where(eq(reminders.id, id)).get()
      expect(row?.firedAt).toBeNull() // re-armed
      const next = JSON.parse(row?.dueJson ?? '{}') as { date: string }
      expect(next.date).toBe('2026-07-17')
      // still 17:00 wall-clock in New York, regardless of the exact UTC instant
      expect(row?.fireAtUtc).not.toBeNull()
      expect(dateInTz(row?.fireAtUtc ?? '', timezone)).toBe('2026-07-17')
      expect(timeInTz(row?.fireAtUtc ?? '', timezone)).toBe('17:00')
    } finally {
      close()
    }
  })
})

describe('startReminderScheduler', () => {
  const handles: Array<{ stop: () => void }> = []
  afterEach(() => {
    for (const h of handles.splice(0)) h.stop()
  })

  it('runs an immediate catch-up tick on start and stop() halts the cron', async () => {
    const { db, close } = await makeTestDb()
    try {
      const { userId } = await seedUser(db)
      const { id: taskId } = await seedTask(db, userId, { dueDate: '2026-07-16', dueTime: '16:00' })
      // genuinely in the past relative to the real clock the immediate tick will use
      await seedReminder(db, {
        userId,
        taskId,
        type: 'relative',
        fireAtUtc: new Date(Date.now() - 5 * 60_000).toISOString(),
        firedAt: null,
      })
      const dispatch = vi.fn(async () => {})
      const handle = startReminderScheduler(db, {
        now: () => new Date().toISOString(),
        dispatch,
        log: () => {},
      })
      handles.push(handle)
      await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1))
      handle.stop()
    } finally {
      close()
    }
  })
})
