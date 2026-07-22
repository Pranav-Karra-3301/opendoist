import { DueSchema, instantFor } from '@opendoist/core'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, test } from 'vitest'
import type { Db } from '../db/db'
import { reminders } from '../db/schema'
import { advanceRecurringReminder, computeFireAt, syncTaskReminders } from './materialize'
import { makeTestDb, type ReminderRow, seedReminder, seedTask, seedUser } from './test-helpers'

const NY = 'America/New_York'

const closers: Array<() => void> = []
afterEach(() => {
  for (const c of closers.splice(0)) c()
})
async function freshDb(): Promise<Db> {
  const { db, close } = await makeTestDb()
  closers.push(close)
  return db
}
function remindersOf(db: Db, taskId: string): ReminderRow[] {
  return db.select().from(reminders).where(eq(reminders.taskId, taskId)).all()
}
/** First element, asserting the array is non-empty (satisfies noUncheckedIndexedAccess). */
function one<T>(items: T[]): T {
  const [head] = items
  if (head === undefined) throw new Error('expected at least one item')
  return head
}

/** A due date safely in the future (relative reminders born in the past are claimed at sync). */
function futureDate(daysAhead = 2): string {
  return new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10)
}

function absoluteDue(date: string, time: string | null): string {
  return JSON.stringify(
    DueSchema.parse({ date, time, string: `${date} ${time}`, recurrence: null }),
  )
}
function recurringDue(date: string, time: string, phrase = 'every day'): string {
  return JSON.stringify(
    DueSchema.parse({
      date,
      time,
      string: `${phrase} at ${time}`,
      recurrence: { anchor: 'schedule', freq: 'daily', interval: 1, times: [time] },
    }),
  )
}

describe('computeFireAt — relative', () => {
  test('subtracts the offset from the task due instant', () => {
    expect(
      computeFireAt(
        { type: 'relative', minuteOffset: 30, due: null },
        { date: '2026-07-16', time: '17:00' },
        NY,
      ),
    ).toBe(new Date(Date.parse(instantFor('2026-07-16', '17:00', NY)) - 30 * 60_000).toISOString())
  })

  test('offset 0 fires exactly at the task due instant', () => {
    expect(
      computeFireAt(
        { type: 'relative', minuteOffset: 0, due: null },
        { date: '2026-07-16', time: '17:00' },
        NY,
      ),
    ).toBe(new Date(Date.parse(instantFor('2026-07-16', '17:00', NY))).toISOString())
  })

  test('an all-day task (no time) is unfireable', () => {
    expect(
      computeFireAt(
        { type: 'relative', minuteOffset: 30, due: null },
        { date: '2026-07-16', time: null },
        NY,
      ),
    ).toBeNull()
  })

  test('a dateless task is unfireable', () => {
    expect(computeFireAt({ type: 'relative', minuteOffset: 30, due: null }, null, NY)).toBeNull()
  })
})

describe('computeFireAt — absolute', () => {
  test('uses the reminder due date+time', () => {
    const due = DueSchema.parse({
      date: '2026-07-16',
      time: '09:00',
      string: '2026-07-16 09:00',
      recurrence: null,
    })
    expect(computeFireAt({ type: 'absolute', minuteOffset: null, due }, null, NY)).toBe(
      new Date(Date.parse(instantFor('2026-07-16', '09:00', NY))).toISOString(),
    )
  })

  test('an absolute reminder with no time is unfireable', () => {
    const due = DueSchema.parse({
      date: '2026-07-16',
      time: null,
      string: '2026-07-16',
      recurrence: null,
    })
    expect(computeFireAt({ type: 'absolute', minuteOffset: null, due }, null, NY)).toBeNull()
  })

  test('a missing due is unfireable', () => {
    expect(computeFireAt({ type: 'absolute', minuteOffset: null, due: null }, null, NY)).toBeNull()
  })
})

describe('computeFireAt — recurring', () => {
  test('uses the due time when present', () => {
    const due = DueSchema.parse(JSON.parse(recurringDue('2026-07-16', '17:00')))
    expect(computeFireAt({ type: 'recurring', minuteOffset: null, due }, null, NY)).toBe(
      new Date(Date.parse(instantFor('2026-07-16', '17:00', NY))).toISOString(),
    )
  })

  test('falls back to the recurrence times[0] when the due time is null', () => {
    const due = DueSchema.parse({
      date: '2026-07-16',
      time: null,
      string: 'every day at 08:00',
      recurrence: { anchor: 'schedule', freq: 'daily', interval: 1, times: ['08:00'] },
    })
    expect(computeFireAt({ type: 'recurring', minuteOffset: null, due }, null, NY)).toBe(
      new Date(Date.parse(instantFor('2026-07-16', '08:00', NY))).toISOString(),
    )
  })

  test('a timeless recurrence is unfireable', () => {
    const due = DueSchema.parse({
      date: '2026-07-16',
      time: null,
      string: 'every day',
      recurrence: { anchor: 'schedule', freq: 'daily', interval: 1, times: [] },
    })
    expect(computeFireAt({ type: 'recurring', minuteOffset: null, due }, null, NY)).toBeNull()
  })

  test('a missing due is unfireable', () => {
    expect(computeFireAt({ type: 'recurring', minuteOffset: null, due: null }, null, NY)).toBeNull()
  })
})

describe('computeFireAt — DST (America/New_York)', () => {
  const absolute = (date: string, time: string) => {
    const due = DueSchema.parse({ date, time, string: `${date} ${time}`, recurrence: null })
    return computeFireAt({ type: 'absolute', minuteOffset: null, due }, null, NY)
  }

  test('09:00 the day before spring-forward is 14:00Z (EST, UTC-5)', () => {
    expect(absolute('2026-03-07', '09:00')).toBe('2026-03-07T14:00:00.000Z')
  })

  test('09:00 the day of spring-forward is 13:00Z (EDT, UTC-4) — 23h later', () => {
    const before = absolute('2026-03-07', '09:00')
    const after = absolute('2026-03-08', '09:00')
    expect(after).toBe('2026-03-08T13:00:00.000Z')
    expect(Date.parse(after as string) - Date.parse(before as string)).toBe(23 * 3_600_000)
  })

  test('a relative reminder 30 min before 09:00 on the fall-back day is 13:30Z', () => {
    expect(
      computeFireAt(
        { type: 'relative', minuteOffset: 30, due: null },
        { date: '2026-11-01', time: '09:00' },
        NY,
      ),
    ).toBe('2026-11-01T13:30:00.000Z')
  })

  test('a due inside the skipped spring-forward hour still yields one valid instant', () => {
    const fire = computeFireAt(
      { type: 'relative', minuteOffset: 0, due: null },
      { date: '2026-03-08', time: '02:30' },
      NY,
    )
    expect(fire).not.toBeNull()
    const ms = Date.parse(fire as string)
    expect(Number.isNaN(ms)).toBe(false)
    expect(new Date(ms).toISOString()).toBe(fire)
    expect(ms).toBeGreaterThanOrEqual(Date.parse('2026-03-08T06:30:00.000Z'))
    expect(ms).toBeLessThanOrEqual(Date.parse('2026-03-08T07:30:00.000Z'))
  })
})

describe('advanceRecurringReminder', () => {
  test('advances "every day at 17:00" to the next day, same wall-clock', () => {
    const due = DueSchema.parse(JSON.parse(recurringDue('2026-07-16', '17:00')))
    const next = advanceRecurringReminder(due, NY, '2026-07-16T21:05:00.000Z')
    expect(next).not.toBeNull()
    expect(next?.due.date).toBe('2026-07-17')
    expect(next?.due.time).toBe('17:00')
    expect(next?.fireAtUtc).toBe(
      new Date(Date.parse(instantFor('2026-07-17', '17:00', NY))).toISOString(),
    )
  })

  test('keeps wall-clock 09:00 across spring-forward (offset shifts, wall-clock does not)', () => {
    const due = DueSchema.parse({
      date: '2026-03-07',
      time: '09:00',
      string: 'every day at 09:00',
      recurrence: { anchor: 'schedule', freq: 'daily', interval: 1, times: ['09:00'] },
    })
    const next = advanceRecurringReminder(due, NY, '2026-03-07T14:05:00.000Z')
    expect(next?.due.date).toBe('2026-03-08')
    expect(next?.due.time).toBe('09:00')
    expect(next?.fireAtUtc).toBe('2026-03-08T13:00:00.000Z')
  })

  test('returns null once the series passes its until bound', () => {
    const due = DueSchema.parse({
      date: '2026-07-16',
      time: '17:00',
      string: 'every day at 17:00',
      recurrence: {
        anchor: 'schedule',
        freq: 'daily',
        interval: 1,
        times: ['17:00'],
        until: '2026-07-15',
      },
    })
    expect(advanceRecurringReminder(due, NY, '2026-07-16T21:05:00.000Z')).toBeNull()
  })

  test('returns null when the due carries no recurrence', () => {
    const due = DueSchema.parse({
      date: '2026-07-16',
      time: '17:00',
      string: '2026-07-16 17:00',
      recurrence: null,
    })
    expect(advanceRecurringReminder(due, NY, '2026-07-16T21:05:00.000Z')).toBeNull()
  })
})

describe('syncTaskReminders — recompute + re-arm', () => {
  test('recomputes fire_at_utc and resets fired_at when the instant changes (future due)', async () => {
    const db = await freshDb()
    const { userId } = await seedUser(db, { autoReminderMinutes: null })
    const due = futureDate()
    const { id: taskId } = await seedTask(db, userId, { dueDate: due, dueTime: '17:00' })
    // Seed a manual relative reminder whose stored instant is deliberately stale + already fired.
    await seedReminder(db, {
      userId,
      taskId,
      type: 'relative',
      minuteOffset: 30,
      fireAtUtc: '2000-01-01T00:00:00.000Z',
      firedAt: '2000-01-01T00:00:00.000Z',
    })
    await syncTaskReminders(db, taskId)
    // The built-in at-time auto row also materializes; this test cares about the manual one.
    const row = one(remindersOf(db, taskId).filter((r) => !r.isAuto))
    expect(row.fireAtUtc).toBe(
      computeFireAt(
        { type: 'relative', minuteOffset: 30, due: null },
        { date: due, time: '17:00' },
        NY,
      ),
    )
    expect(row.firedAt).toBeNull()
  })

  test('a relative instant recomputed into the PAST is claimed at sync, not re-armed', async () => {
    const db = await freshDb()
    const { userId } = await seedUser(db, { autoReminderMinutes: null })
    // Timed due earlier than now: the reminder moment has already passed at sync time.
    const { id: taskId } = await seedTask(db, userId, {
      dueDate: '2026-07-16',
      dueTime: '17:00',
    })
    await seedReminder(db, { userId, taskId, type: 'relative', minuteOffset: 30 })
    await syncTaskReminders(db, taskId)
    const row = one(remindersOf(db, taskId).filter((r) => !r.isAuto))
    expect(row.fireAtUtc).not.toBeNull()
    expect(row.firedAt).not.toBeNull() // born-past → claimed, the scheduler never dispatches it
  })

  test('an armed overdue reminder with an UNCHANGED instant stays armed (downtime catch-up)', async () => {
    const db = await freshDb()
    const { userId } = await seedUser(db, { autoReminderMinutes: null })
    const { id: taskId } = await seedTask(db, userId, {
      dueDate: '2026-07-16',
      dueTime: '17:00',
    })
    const correct = computeFireAt(
      { type: 'relative', minuteOffset: 30, due: null },
      { date: '2026-07-16', time: '17:00' },
      NY,
    )
    // Armed before the instant passed (e.g. the server was down when it came due) — the sync
    // must NOT touch it; the scheduler's catch-up/stale logic owns it.
    await seedReminder(db, {
      userId,
      taskId,
      type: 'relative',
      minuteOffset: 30,
      fireAtUtc: correct,
      firedAt: null,
    })
    await syncTaskReminders(db, taskId)
    const row = one(remindersOf(db, taskId).filter((r) => !r.isAuto))
    expect(row.fireAtUtc).toBe(correct)
    expect(row.firedAt).toBeNull()
  })

  test('leaves fired_at intact when the instant is unchanged', async () => {
    const db = await freshDb()
    const { userId } = await seedUser(db, { autoReminderMinutes: null })
    const { id: taskId } = await seedTask(db, userId, {
      dueDate: '2026-07-16',
      dueTime: '17:00',
    })
    const correct = computeFireAt(
      { type: 'relative', minuteOffset: 30, due: null },
      { date: '2026-07-16', time: '17:00' },
      NY,
    )
    await seedReminder(db, {
      userId,
      taskId,
      type: 'relative',
      minuteOffset: 30,
      fireAtUtc: correct,
      firedAt: '2026-07-16T20:30:00.000Z',
    })
    await syncTaskReminders(db, taskId)
    const row = one(remindersOf(db, taskId).filter((r) => !r.isAuto))
    expect(row.fireAtUtc).toBe(correct)
    expect(row.firedAt).toBe('2026-07-16T20:30:00.000Z')
  })
})

describe('syncTaskReminders — suppression on complete / delete', () => {
  test('nulls a relative reminder instant when a non-recurring task is completed', async () => {
    const db = await freshDb()
    const { userId } = await seedUser(db, { autoReminderMinutes: null })
    const { id: taskId } = await seedTask(db, userId, {
      dueDate: '2026-07-16',
      dueTime: '17:00',
      completedAt: '2026-07-16T21:00:00.000Z',
    })
    await seedReminder(db, {
      userId,
      taskId,
      type: 'relative',
      minuteOffset: 30,
      fireAtUtc: '2026-07-16T20:30:00.000Z',
    })
    await syncTaskReminders(db, taskId)
    const row = one(remindersOf(db, taskId))
    expect(row.fireAtUtc).toBeNull()
  })

  test('nulls a relative reminder instant when the task is soft-deleted', async () => {
    const db = await freshDb()
    const { userId } = await seedUser(db, { autoReminderMinutes: null })
    const { id: taskId } = await seedTask(db, userId, {
      dueDate: '2026-07-16',
      dueTime: '17:00',
      deletedAt: '2026-07-16T10:00:00.000Z',
    })
    await seedReminder(db, { userId, taskId, type: 'relative', minuteOffset: 30 })
    await syncTaskReminders(db, taskId)
    const row = one(remindersOf(db, taskId))
    expect(row.fireAtUtc).toBeNull()
  })

  test('an absolute reminder keeps its instant even on a completed task', async () => {
    const db = await freshDb()
    const { userId } = await seedUser(db, { autoReminderMinutes: null })
    const { id: taskId } = await seedTask(db, userId, {
      dueDate: '2026-07-16',
      dueTime: '17:00',
      completedAt: '2026-07-16T21:00:00.000Z',
    })
    await seedReminder(db, {
      userId,
      taskId,
      type: 'absolute',
      minuteOffset: null,
      dueJson: absoluteDue('2026-07-18', '08:00'),
    })
    await syncTaskReminders(db, taskId)
    const row = one(remindersOf(db, taskId))
    expect(row.fireAtUtc).toBe(
      new Date(Date.parse(instantFor('2026-07-18', '08:00', NY))).toISOString(),
    )
  })
})

describe('syncTaskReminders — auto reminders', () => {
  /** Sorted auto offsets for a task — the shape most assertions care about. */
  function autoOffsets(db: Db, taskId: string): Array<number | null> {
    return remindersOf(db, taskId)
      .filter((r) => r.isAuto)
      .map((r) => r.minuteOffset)
      .sort((a, b) => (a ?? 0) - (b ?? 0))
  }

  test('creates the at-time row plus the heads-up row for a timed task', async () => {
    const db = await freshDb()
    const { userId } = await seedUser(db, { autoReminderMinutes: 30 })
    const due = futureDate()
    const { id: taskId } = await seedTask(db, userId, { dueDate: due, dueTime: '17:00' })
    await syncTaskReminders(db, taskId)
    const auto = remindersOf(db, taskId).filter((r) => r.isAuto)
    expect(autoOffsets(db, taskId)).toEqual([0, 30])
    for (const row of auto) {
      expect(row.type).toBe('relative')
      expect(row.firedAt).toBeNull()
      expect(row.fireAtUtc).toBe(
        computeFireAt(
          { type: 'relative', minuteOffset: row.minuteOffset, due: null },
          { date: due, time: '17:00' },
          NY,
        ),
      )
    }
  })

  test('a heads-up already in the past at creation is claimed; the at-time row still arms', async () => {
    const db = await freshDb()
    // UTC settings so the UTC-derived wall clock below really is "now + 2 minutes".
    const { userId } = await seedUser(db, { timezone: 'UTC', autoReminderMinutes: 30 })
    // Due ~2 minutes from now: the 30-min heads-up moment is long gone, the due itself is not.
    const soon = new Date(Date.now() + 2 * 60_000)
    const dueDate = soon.toISOString().slice(0, 10)
    const dueTime = soon.toISOString().slice(11, 16)
    const { id: taskId } = await seedTask(db, userId, { dueDate, dueTime })
    await syncTaskReminders(db, taskId)
    const rows = remindersOf(db, taskId).filter((r) => r.isAuto)
    const headsUp = one(rows.filter((r) => r.minuteOffset === 30))
    const atTime = one(rows.filter((r) => r.minuteOffset === 0))
    expect(headsUp.firedAt).not.toBeNull() // born-past → claimed, no late notification
    expect(atTime.firedAt).toBeNull() // still fires at the due minute
  })

  test('does not create auto rows for an all-day task', async () => {
    const db = await freshDb()
    const { userId } = await seedUser(db, { autoReminderMinutes: 30 })
    const { id: taskId } = await seedTask(db, userId, { dueDate: '2026-07-16', dueTime: null })
    await syncTaskReminders(db, taskId)
    expect(remindersOf(db, taskId).filter((r) => r.isAuto)).toHaveLength(0)
  })

  test('still creates the at-time row when autoReminderMinutes is null', async () => {
    const db = await freshDb()
    const { userId } = await seedUser(db, { autoReminderMinutes: null })
    const { id: taskId } = await seedTask(db, userId, {
      dueDate: '2026-07-16',
      dueTime: '17:00',
    })
    await syncTaskReminders(db, taskId)
    expect(autoOffsets(db, taskId)).toEqual([0])
  })

  test('autoReminderMinutes 0 collapses into the single built-in at-time row', async () => {
    const db = await freshDb()
    const { userId } = await seedUser(db, { autoReminderMinutes: 0 })
    const { id: taskId } = await seedTask(db, userId, {
      dueDate: '2026-07-16',
      dueTime: '17:00',
    })
    await syncTaskReminders(db, taskId)
    expect(autoOffsets(db, taskId)).toEqual([0])
  })

  test('skips the heads-up auto row when a manual relative reminder shares its offset', async () => {
    const db = await freshDb()
    const { userId } = await seedUser(db, { autoReminderMinutes: 30 })
    const { id: taskId } = await seedTask(db, userId, {
      dueDate: '2026-07-16',
      dueTime: '17:00',
    })
    await seedReminder(db, { userId, taskId, type: 'relative', minuteOffset: 30, isAuto: false })
    await syncTaskReminders(db, taskId)
    const rows = remindersOf(db, taskId)
    // Manual-30 wins over auto-30; the built-in at-time row still materializes.
    expect(autoOffsets(db, taskId)).toEqual([0])
    expect(rows).toHaveLength(2)
  })

  test('skips the at-time auto row when a manual reminder sits at offset 0', async () => {
    const db = await freshDb()
    const { userId } = await seedUser(db, { autoReminderMinutes: null })
    const { id: taskId } = await seedTask(db, userId, {
      dueDate: '2026-07-16',
      dueTime: '17:00',
    })
    await seedReminder(db, { userId, taskId, type: 'relative', minuteOffset: 0, isAuto: false })
    await syncTaskReminders(db, taskId)
    const rows = remindersOf(db, taskId)
    expect(rows.filter((r) => r.isAuto)).toHaveLength(0)
    expect(rows).toHaveLength(1)
  })

  test('keeps both auto rows alongside a manual reminder at a different offset', async () => {
    const db = await freshDb()
    const { userId } = await seedUser(db, { autoReminderMinutes: 30 })
    const { id: taskId } = await seedTask(db, userId, {
      dueDate: '2026-07-16',
      dueTime: '17:00',
    })
    await seedReminder(db, { userId, taskId, type: 'relative', minuteOffset: 45, isAuto: false })
    await syncTaskReminders(db, taskId)
    const rows = remindersOf(db, taskId)
    expect(autoOffsets(db, taskId)).toEqual([0, 30])
    // Relative-45 fires earlier than auto-30, which fires earlier than auto-0 (at time).
    const manual = one(rows.filter((r) => !r.isAuto))
    const instants = rows
      .filter((r) => r.isAuto)
      .map((r) => Date.parse(r.fireAtUtc as string))
      .sort((a, b) => a - b)
    expect(Date.parse(manual.fireAtUtc as string)).toBeLessThan(one(instants))
  })

  test('reconciles stale auto offsets to the wanted set', async () => {
    const db = await freshDb()
    const { userId } = await seedUser(db, { autoReminderMinutes: 30 })
    const { id: taskId } = await seedTask(db, userId, {
      dueDate: '2026-07-16',
      dueTime: '17:00',
    })
    // Pre-existing auto row with a stale offset (as if the setting changed).
    await seedReminder(db, { userId, taskId, type: 'relative', minuteOffset: 15, isAuto: true })
    await syncTaskReminders(db, taskId)
    expect(autoOffsets(db, taskId)).toEqual([0, 30])
  })

  test('deletes the auto row when the task loses its time', async () => {
    const db = await freshDb()
    const { userId } = await seedUser(db, { autoReminderMinutes: 30 })
    const { id: taskId } = await seedTask(db, userId, { dueDate: '2026-07-16', dueTime: null })
    await seedReminder(db, { userId, taskId, type: 'relative', minuteOffset: 30, isAuto: true })
    await syncTaskReminders(db, taskId)
    expect(remindersOf(db, taskId).filter((r) => r.isAuto)).toHaveLength(0)
  })

  test('deletes the auto row when the task is completed', async () => {
    const db = await freshDb()
    const { userId } = await seedUser(db, { autoReminderMinutes: 30 })
    const { id: taskId } = await seedTask(db, userId, {
      dueDate: '2026-07-16',
      dueTime: '17:00',
      completedAt: '2026-07-16T21:00:00.000Z',
    })
    await seedReminder(db, { userId, taskId, type: 'relative', minuteOffset: 30, isAuto: true })
    await syncTaskReminders(db, taskId)
    expect(remindersOf(db, taskId).filter((r) => r.isAuto)).toHaveLength(0)
  })

  test('is a no-op for an unknown task id', async () => {
    const db = await freshDb()
    await expect(syncTaskReminders(db, 'does-not-exist')).resolves.toBeUndefined()
  })
})
