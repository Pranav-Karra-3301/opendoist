import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addDaysIso, dateInTz, instantFor } from '@opendoist/core'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { SettingsSchema } from '../api/schemas'
import { user } from '../db/auth-schema'
import { type Db, openDb } from '../db/db'
import { dayStats, karmaLedger, projects, tasks, userSettings } from '../db/schema'
import { newId, nowIso } from '../lib/ids'
import { getSettings } from '../services/task-write'
import { reconcileDayStats, recordCompletion, recordDeletion, recordUncompletion } from './rollup'

const TZ = 'America/New_York'
/** A Wednesday (isoWeekday 3, not in the default days-off [6,7]); its week starts Mon 2026-07-13. */
const WED = '2026-07-15'
const noon = (date: string) => instantFor(date, '12:00', TZ)

function makeHarness(): { db: Db; close: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'opendoist-rollup-'))
  const { db, sqlite } = openDb(join(dir, 'opendoist.db'))
  return {
    db,
    close: () => {
      sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

function seedUser(db: Db, id: string): void {
  db.insert(user)
    .values({ id, name: id, email: `${id}@example.com` })
    .run()
}

function setSettings(db: Db, userId: string, patch: Record<string, unknown>): void {
  const merged = SettingsSchema.parse({ ...getSettings(db, userId), ...patch })
  const now = nowIso()
  db.insert(userSettings)
    .values({ userId, settings: JSON.stringify(merged), updatedAt: now })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { settings: JSON.stringify(merged), updatedAt: now },
    })
    .run()
}

function seedProject(db: Db, userId: string): string {
  const id = newId()
  db.insert(projects).values({ id, userId, name: 'Inbox', isInbox: true }).run()
  return id
}

function seedCompletedTask(db: Db, userId: string, projectId: string, completedAt: string): void {
  db.insert(tasks).values({ id: newId(), userId, projectId, content: 'x', completedAt }).run()
}

function dayStat(db: Db, userId: string, date: string) {
  return db
    .select()
    .from(dayStats)
    .where(and(eq(dayStats.userId, userId), eq(dayStats.date, date)))
    .get()
}

function ledger(db: Db, userId: string) {
  return db.select().from(karmaLedger).where(eq(karmaLedger.userId, userId)).all()
}

function reasons(db: Db, userId: string): string[] {
  return ledger(db, userId)
    .map((r) => r.reason)
    .sort()
}

function total(db: Db, userId: string): number {
  return ledger(db, userId).reduce((s, r) => s + r.delta, 0)
}

/** Deterministic JSON of a user's day_stats + karma_ledger, for idempotency/isolation equality. */
function snapshot(db: Db, userId: string): string {
  const ds = db
    .select()
    .from(dayStats)
    .where(eq(dayStats.userId, userId))
    .all()
    .sort((a, b) => a.date.localeCompare(b.date))
  const kl = db
    .select()
    .from(karmaLedger)
    .where(eq(karmaLedger.userId, userId))
    .all()
    .sort((a, b) => a.id.localeCompare(b.id))
  return JSON.stringify({ ds, kl })
}

describe('recordCompletion', () => {
  it('first on-time completion: +1 count with off/vacation flags, completion + on-time ledger', () => {
    const { db, close } = makeHarness()
    try {
      seedUser(db, 'u')
      setSettings(db, 'u', { timezone: TZ, dailyGoal: 2 })
      recordCompletion(db, { userId: 'u', taskId: 't1', dueDate: WED, completedAt: noon(WED) })

      expect(dayStat(db, 'u', WED)).toMatchObject({
        completedCount: 1,
        goalMet: false,
        isDayOff: false,
        isVacation: false,
      })
      expect(reasons(db, 'u')).toEqual(['completion', 'on_time_bonus'])
      expect(total(db, 'u')).toBe(8)
    } finally {
      close()
    }
  })

  it('inserts the daily_goal bonus exactly once when the day goal is reached', () => {
    const { db, close } = makeHarness()
    try {
      seedUser(db, 'u')
      setSettings(db, 'u', { timezone: TZ, dailyGoal: 2 })
      recordCompletion(db, { userId: 'u', taskId: 't1', dueDate: WED, completedAt: noon(WED) })
      recordCompletion(db, {
        userId: 'u',
        taskId: 't2',
        dueDate: WED,
        completedAt: instantFor(WED, '13:00', TZ),
      })

      expect(dayStat(db, 'u', WED)).toMatchObject({ completedCount: 2, goalMet: true })
      let daily = ledger(db, 'u').filter((r) => r.reason === 'daily_goal')
      expect(daily).toHaveLength(1)
      expect(daily[0]?.delta).toBe(10)

      recordCompletion(db, {
        userId: 'u',
        taskId: 't3',
        dueDate: WED,
        completedAt: instantFor(WED, '14:00', TZ),
      })
      expect(dayStat(db, 'u', WED)?.completedCount).toBe(3)
      daily = ledger(db, 'u').filter((r) => r.reason === 'daily_goal')
      expect(daily).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('inserts the weekly_goal bonus once, dated the week-start Monday', () => {
    const { db, close } = makeHarness()
    try {
      seedUser(db, 'u')
      setSettings(db, 'u', { timezone: TZ, dailyGoal: 100, weeklyGoal: 2 })
      recordCompletion(db, { userId: 'u', taskId: 't1', dueDate: WED, completedAt: noon(WED) })
      recordCompletion(db, {
        userId: 'u',
        taskId: 't2',
        dueDate: WED,
        completedAt: instantFor(WED, '13:00', TZ),
      })

      let weekly = ledger(db, 'u').filter((r) => r.reason === 'weekly_goal')
      expect(weekly).toHaveLength(1)
      expect(weekly[0]).toMatchObject({ date: '2026-07-13', delta: 25 })
      // daily goal (100) must not have fired
      expect(ledger(db, 'u').some((r) => r.reason === 'daily_goal')).toBe(false)

      recordCompletion(db, {
        userId: 'u',
        taskId: 't3',
        dueDate: WED,
        completedAt: instantFor(WED, '14:00', TZ),
      })
      weekly = ledger(db, 'u').filter((r) => r.reason === 'weekly_goal')
      expect(weekly).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('penalizes a completion ≥4 days overdue: completion + overdue_penalty, no on-time', () => {
    const { db, close } = makeHarness()
    try {
      seedUser(db, 'u')
      setSettings(db, 'u', { timezone: TZ, dailyGoal: 2 })
      // due 2026-07-11, completed 2026-07-15 → 4 days late
      recordCompletion(db, {
        userId: 'u',
        taskId: 't1',
        dueDate: '2026-07-11',
        completedAt: noon(WED),
      })

      expect(reasons(db, 'u')).toEqual(['completion', 'overdue_penalty'])
      expect(total(db, 'u')).toBe(-5)
    } finally {
      close()
    }
  })

  it('no due date: completion only, no on-time, no penalty', () => {
    const { db, close } = makeHarness()
    try {
      seedUser(db, 'u')
      setSettings(db, 'u', { timezone: TZ, dailyGoal: 2 })
      recordCompletion(db, { userId: 'u', taskId: 't1', dueDate: null, completedAt: noon(WED) })
      expect(reasons(db, 'u')).toEqual(['completion'])
      expect(total(db, 'u')).toBe(5)
    } finally {
      close()
    }
  })

  it('updates day_stats but writes no ledger when karma is disabled', () => {
    const { db, close } = makeHarness()
    try {
      seedUser(db, 'u')
      setSettings(db, 'u', { timezone: TZ, dailyGoal: 2, karmaEnabled: false })
      recordCompletion(db, { userId: 'u', taskId: 't1', dueDate: WED, completedAt: noon(WED) })
      expect(dayStat(db, 'u', WED)?.completedCount).toBe(1)
      expect(ledger(db, 'u')).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('captures vacation mode on a newly created day row', () => {
    const { db, close } = makeHarness()
    try {
      seedUser(db, 'u')
      setSettings(db, 'u', { timezone: TZ, vacationMode: true })
      recordCompletion(db, { userId: 'u', taskId: 't1', dueDate: WED, completedAt: noon(WED) })
      expect(dayStat(db, 'u', WED)?.isVacation).toBe(true)
    } finally {
      close()
    }
  })

  it('captures the day-off flag from settings when the date is a day off', () => {
    const { db, close } = makeHarness()
    try {
      seedUser(db, 'u')
      setSettings(db, 'u', { timezone: TZ })
      // 2026-07-11 is a Saturday → in the default days-off [6,7]
      recordCompletion(db, {
        userId: 'u',
        taskId: 't1',
        dueDate: '2026-07-11',
        completedAt: noon('2026-07-11'),
      })
      expect(dayStat(db, 'u', '2026-07-11')?.isDayOff).toBe(true)
    } finally {
      close()
    }
  })
})

describe('recordUncompletion', () => {
  it('decrements the original completion date and writes one reversal row', () => {
    const { db, close } = makeHarness()
    try {
      seedUser(db, 'u')
      setSettings(db, 'u', { timezone: TZ, dailyGoal: 5 })
      const at = noon(WED)
      recordCompletion(db, { userId: 'u', taskId: 't1', dueDate: WED, completedAt: at })
      expect(total(db, 'u')).toBe(8)

      recordUncompletion(db, { userId: 'u', taskId: 't1', previousCompletedAt: at })
      expect(dayStat(db, 'u', WED)?.completedCount).toBe(0)
      const reversal = ledger(db, 'u').filter((r) => r.reason === 'reversal')
      expect(reversal).toHaveLength(1)
      expect(reversal[0]?.delta).toBe(-8)
      expect(total(db, 'u')).toBe(0)
    } finally {
      close()
    }
  })

  it('floors the count at 0 and is a no-op on the ledger when karma is disabled', () => {
    const { db, close } = makeHarness()
    try {
      seedUser(db, 'u')
      setSettings(db, 'u', { timezone: TZ, karmaEnabled: false })
      recordCompletion(db, { userId: 'u', taskId: 't1', dueDate: WED, completedAt: noon(WED) })
      recordUncompletion(db, { userId: 'u', taskId: 't1', previousCompletedAt: noon(WED) })
      expect(dayStat(db, 'u', WED)?.completedCount).toBe(0)
      expect(ledger(db, 'u')).toHaveLength(0)
    } finally {
      close()
    }
  })
})

describe('recordDeletion', () => {
  it('penalizes deleting a ≥4-days-overdue task and never touches day_stats', () => {
    const { db, close } = makeHarness()
    try {
      seedUser(db, 'u')
      setSettings(db, 'u', { timezone: TZ })
      // due 2026-07-10, deleted 2026-07-15 → 5 days overdue
      recordDeletion(db, { userId: 'u', taskId: 't1', dueDate: '2026-07-10', deletedAt: noon(WED) })
      const rows = ledger(db, 'u')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ reason: 'overdue_penalty', delta: -10 })
      expect(dayStat(db, 'u', WED)).toBeUndefined()

      // not overdue / no due → no rows added
      recordDeletion(db, { userId: 'u', taskId: 't2', dueDate: WED, deletedAt: noon(WED) })
      recordDeletion(db, { userId: 'u', taskId: 't3', dueDate: null, deletedAt: noon(WED) })
      expect(ledger(db, 'u')).toHaveLength(1)
    } finally {
      close()
    }
  })
})

describe('reconcileDayStats', () => {
  it('recomputes counts, fixes goal_met, repairs daily_goal rows, and is idempotent', () => {
    const { db, close } = makeHarness()
    try {
      seedUser(db, 'u')
      // weeklyGoal high so weekly bonus never fires; dailyGoal 2
      setSettings(db, 'u', { timezone: TZ, dailyGoal: 2, weeklyGoal: 700 })
      const projectId = seedProject(db, 'u')
      const today = dateInTz(nowIso(), TZ)
      const dA = addDaysIso(today, -3)
      const dB = addDaysIso(today, -2)
      for (let i = 0; i < 3; i++) seedCompletedTask(db, 'u', projectId, noon(dA))
      seedCompletedTask(db, 'u', projectId, noon(dB))

      // corrupt: dA has a stale count + no daily_goal; dB has a spurious daily_goal it doesn't earn
      db.insert(dayStats)
        .values({
          userId: 'u',
          date: dA,
          completedCount: 99,
          goalMet: false,
          isDayOff: false,
          isVacation: false,
        })
        .run()
      db.insert(karmaLedger)
        .values({
          id: newId(),
          userId: 'u',
          at: nowIso(),
          date: dB,
          reason: 'daily_goal',
          taskId: null,
          delta: 10,
        })
        .run()

      reconcileDayStats(db, 'u', 30)

      expect(dayStat(db, 'u', dA)).toMatchObject({ completedCount: 3, goalMet: true })
      expect(dayStat(db, 'u', dB)).toMatchObject({ completedCount: 1, goalMet: false })
      expect(
        ledger(db, 'u').filter((r) => r.reason === 'daily_goal' && r.date === dA),
      ).toHaveLength(1)
      expect(
        ledger(db, 'u').filter((r) => r.reason === 'daily_goal' && r.date === dB),
      ).toHaveLength(0)

      const before = snapshot(db, 'u')
      reconcileDayStats(db, 'u', 30)
      expect(snapshot(db, 'u')).toBe(before)
    } finally {
      close()
    }
  })

  it('never rewrites is_vacation / is_day_off on existing rows', () => {
    const { db, close } = makeHarness()
    try {
      seedUser(db, 'u')
      // current settings say NOT vacation, but the stored row was captured during vacation
      setSettings(db, 'u', { timezone: TZ, dailyGoal: 2, vacationMode: false })
      const projectId = seedProject(db, 'u')
      const today = dateInTz(nowIso(), TZ)
      const d = addDaysIso(today, -1)
      seedCompletedTask(db, 'u', projectId, noon(d))
      db.insert(dayStats)
        .values({
          userId: 'u',
          date: d,
          completedCount: 0,
          goalMet: false,
          isDayOff: true,
          isVacation: true,
        })
        .run()

      reconcileDayStats(db, 'u', 30)
      expect(dayStat(db, 'u', d)).toMatchObject({
        completedCount: 1,
        goalMet: false,
        isDayOff: true,
        isVacation: true,
      })
    } finally {
      close()
    }
  })
})

describe('user isolation', () => {
  it('hooks and reconcile for one user never touch another user’s rows', () => {
    const { db, close } = makeHarness()
    try {
      seedUser(db, 'a')
      seedUser(db, 'b')
      setSettings(db, 'a', { timezone: TZ, dailyGoal: 2 })
      setSettings(db, 'b', { timezone: TZ, dailyGoal: 2 })
      const at = noon(WED)
      recordCompletion(db, { userId: 'a', taskId: 't1', dueDate: WED, completedAt: at })
      recordCompletion(db, { userId: 'b', taskId: 't1', dueDate: WED, completedAt: at })
      recordCompletion(db, {
        userId: 'b',
        taskId: 't2',
        dueDate: WED,
        completedAt: instantFor(WED, '13:00', TZ),
      })

      expect(dayStat(db, 'a', WED)?.completedCount).toBe(1)
      expect(dayStat(db, 'b', WED)?.completedCount).toBe(2)
      expect(total(db, 'a')).toBe(8) // 5 + 3
      expect(total(db, 'b')).toBe(26) // 2×(5+3) + daily_goal 10

      const bBefore = snapshot(db, 'b')
      reconcileDayStats(db, 'a', 30)
      expect(snapshot(db, 'b')).toBe(bBefore)
    } finally {
      close()
    }
  })
})
