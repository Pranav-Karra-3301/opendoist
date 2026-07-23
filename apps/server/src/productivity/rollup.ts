/**
 * day_stats rollup + karma ledger hooks — phase 9 Task J.
 *
 * Every hook is user-scoped: day_stats is keyed by phase 3's `(user_id, date)` composite PK and the
 * karma ledger by its `user_id` column (callers pass the mutating task's owner). Point values come
 * from core karma (`completionDelta`/`deletionPenalty`/`KARMA_POINTS`); all calendar math goes through
 * `dates.ts` (user-tz `dateInTz`, `addDaysIso`, `isoWeekday`) — no ad-hoc Date math.
 *
 * Each function is fully synchronous, so within a single call no other JS runs between statements
 * (the whole hook is effectively atomic on one better-sqlite3 connection); we follow the as-built
 * autocommit convention (no explicit transaction, like the close/reopen handlers). day_stats counts
 * are written BEFORE the karma computation so a karma failure (e.g. a not-yet-landed core function
 * throwing) never loses the completion count — callers additionally wrap every hook in try/catch.
 */
import {
  addDaysIso,
  completionDelta,
  dateInTz,
  deletionPenalty,
  isoWeekday,
  KARMA_POINTS,
  type Weekday,
} from '@opentask/core'
import { and, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import type { Db } from '../db/db'
import { dayStats, karmaLedger, tasks } from '../db/schema'
import { newId, nowIso } from '../lib/ids'
import { getSettings } from '../services/task-write'
import { getProductivitySettings } from './settings'

type LedgerReason =
  | 'completion'
  | 'on_time_bonus'
  | 'daily_goal'
  | 'weekly_goal'
  | 'overdue_penalty'
  | 'reversal'
  | 'reconcile'

interface RollupCtx {
  timezone: string
  weekStart: Weekday
  dailyGoal: number
  weeklyGoal: number
  daysOff: number[]
  vacationMode: boolean
  karmaEnabled: boolean
}

/** Timezone + weekStart from the settings document; clamped productivity fields via settings.ts. */
function loadCtx(db: Db, userId: string): RollupCtx {
  const s = getSettings(db, userId)
  const p = getProductivitySettings(db, userId)
  return {
    timezone: s.timezone,
    weekStart: s.weekStart as Weekday,
    dailyGoal: p.dailyGoal,
    weeklyGoal: p.weeklyGoal,
    daysOff: p.daysOff,
    vacationMode: p.vacationMode,
    karmaEnabled: p.karmaEnabled,
  }
}

/** Calendar date of the `weekStart`-aligned week containing `date` (both YYYY-MM-DD). */
function weekStartOf(date: string, weekStart: Weekday): string {
  const back = (isoWeekday(date) - weekStart + 7) % 7
  return addDaysIso(date, -back)
}

function insertLedger(
  db: Db,
  r: {
    userId: string
    at: string
    date: string
    reason: LedgerReason
    taskId: string | null
    delta: number
  },
): void {
  db.insert(karmaLedger)
    .values({ id: newId(), ...r })
    .run()
}

/** Σ completed_count over the seven-day week starting `weekStart` for this user (0 when empty). */
function weekCompleted(db: Db, userId: string, weekStart: string): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${dayStats.completedCount}), 0)` })
    .from(dayStats)
    .where(
      and(
        eq(dayStats.userId, userId),
        gte(dayStats.date, weekStart),
        lte(dayStats.date, addDaysIso(weekStart, 6)),
      ),
    )
    .get()
  return row?.total ?? 0
}

/** True when a daily_goal/weekly_goal ledger row already exists for (userId, date). */
function hasGoalRow(
  db: Db,
  userId: string,
  date: string,
  reason: 'daily_goal' | 'weekly_goal',
): boolean {
  return (
    db
      .select({ id: karmaLedger.id })
      .from(karmaLedger)
      .where(
        and(
          eq(karmaLedger.userId, userId),
          eq(karmaLedger.date, date),
          eq(karmaLedger.reason, reason),
        ),
      )
      .get() !== undefined
  )
}

/**
 * A task was completed at `completedAt`: +1 to that user-tz date's completed_count (creating the row
 * with the day-off/vacation flags captured from current settings), then the karma ledger — a
 * `completion` row, an `on_time_bonus` when on time, an `overdue_penalty` when ≥4 days late, and the
 * once-per-day / once-per-week goal bonuses when the day/week total reaches its goal.
 */
export function recordCompletion(
  db: Db,
  a: { userId: string; taskId: string; dueDate: string | null; completedAt: string },
): void {
  const ctx = loadCtx(db, a.userId)
  const date = dateInTz(a.completedAt, ctx.timezone)

  db.insert(dayStats)
    .values({
      userId: a.userId,
      date,
      completedCount: 1,
      goalMet: false,
      isDayOff: ctx.daysOff.includes(isoWeekday(date)),
      isVacation: ctx.vacationMode,
    })
    .onConflictDoUpdate({
      target: [dayStats.userId, dayStats.date],
      // Only bump the count — the day-off/vacation flags are captured once, on row creation.
      set: { completedCount: sql`${dayStats.completedCount} + 1` },
    })
    .run()

  const count =
    db
      .select({ c: dayStats.completedCount })
      .from(dayStats)
      .where(and(eq(dayStats.userId, a.userId), eq(dayStats.date, date)))
      .get()?.c ?? 1
  const goalMet = count >= ctx.dailyGoal
  if (goalMet) {
    db.update(dayStats)
      .set({ goalMet: true })
      .where(and(eq(dayStats.userId, a.userId), eq(dayStats.date, date)))
      .run()
  }

  if (!ctx.karmaEnabled) return

  const delta = completionDelta({ completedDate: date, dueDate: a.dueDate })
  insertLedger(db, {
    userId: a.userId,
    at: a.completedAt,
    date,
    reason: 'completion',
    taskId: a.taskId,
    delta: KARMA_POINTS.completion,
  })
  if (delta.onTime) {
    insertLedger(db, {
      userId: a.userId,
      at: a.completedAt,
      date,
      reason: 'on_time_bonus',
      taskId: a.taskId,
      delta: KARMA_POINTS.onTimeBonus,
    })
  }
  if (delta.overdueDays >= 4) {
    insertLedger(db, {
      userId: a.userId,
      at: a.completedAt,
      date,
      reason: 'overdue_penalty',
      taskId: a.taskId,
      delta: KARMA_POINTS.overduePenalty,
    })
  }

  // Once-per-day goal bonus (partial unique index enforces "once"; INSERT OR IGNORE is the guard).
  if (goalMet) {
    db.insert(karmaLedger)
      .values({
        id: newId(),
        userId: a.userId,
        at: a.completedAt,
        date,
        reason: 'daily_goal',
        taskId: null,
        delta: KARMA_POINTS.dailyGoal,
      })
      .onConflictDoNothing()
      .run()
  }

  // Once-per-week goal bonus, dated the week-start day.
  const weekStart = weekStartOf(date, ctx.weekStart)
  if (weekCompleted(db, a.userId, weekStart) >= ctx.weeklyGoal) {
    db.insert(karmaLedger)
      .values({
        id: newId(),
        userId: a.userId,
        at: a.completedAt,
        date: weekStart,
        reason: 'weekly_goal',
        taskId: null,
        delta: KARMA_POINTS.weeklyGoal,
      })
      .onConflictDoNothing()
      .run()
  }
}

/**
 * A completed task was reopened: decrement the ORIGINAL completion date's count (floored at 0) and
 * write a single `reversal` row cancelling that task's `completion` + `on_time_bonus` points for that
 * date. Goal rows are intentionally left for the nightly reconcile to repair.
 */
export function recordUncompletion(
  db: Db,
  a: { userId: string; taskId: string; previousCompletedAt: string },
): void {
  const ctx = loadCtx(db, a.userId)
  const date = dateInTz(a.previousCompletedAt, ctx.timezone)

  db.update(dayStats)
    .set({ completedCount: sql`max(0, ${dayStats.completedCount} - 1)` })
    .where(and(eq(dayStats.userId, a.userId), eq(dayStats.date, date)))
    .run()

  if (!ctx.karmaEnabled) return

  const earned =
    db
      .select({ total: sql<number>`coalesce(sum(${karmaLedger.delta}), 0)` })
      .from(karmaLedger)
      .where(
        and(
          eq(karmaLedger.userId, a.userId),
          eq(karmaLedger.taskId, a.taskId),
          eq(karmaLedger.date, date),
          inArray(karmaLedger.reason, ['completion', 'on_time_bonus']),
        ),
      )
      .get()?.total ?? 0
  if (earned !== 0) {
    insertLedger(db, {
      userId: a.userId,
      at: nowIso(),
      date,
      reason: 'reversal',
      taskId: a.taskId,
      delta: -earned,
    })
  }
}

/**
 * A task was deleted at `deletedAt`: an `overdue_penalty` row when it was ≥4 days overdue, else no-op.
 * Deletion never touches day_stats counts (the completion, if any, still happened).
 */
export function recordDeletion(
  db: Db,
  a: { userId: string; taskId: string; dueDate: string | null; deletedAt: string },
): void {
  const ctx = loadCtx(db, a.userId)
  if (!ctx.karmaEnabled) return
  const date = dateInTz(a.deletedAt, ctx.timezone)
  const penalty = deletionPenalty({ deletedDate: date, dueDate: a.dueDate })
  if (penalty !== 0) {
    insertLedger(db, {
      userId: a.userId,
      at: a.deletedAt,
      date,
      reason: 'overdue_penalty',
      taskId: a.taskId,
      delta: penalty,
    })
  }
}

/**
 * Nightly repair over the last `days` user-tz dates (default 30): recompute each date's
 * completed_count from that user's tasks' `completed_at`, fix `goal_met`, and add/remove
 * `daily_goal`/`weekly_goal` ledger rows so they match the recomputed totals. Day-off/vacation flags
 * are only ever set on rows this pass CREATES (never rewritten on existing rows). Idempotent.
 */
export function reconcileDayStats(db: Db, userId: string, days = 30): void {
  const ctx = loadCtx(db, userId)
  const today = dateInTz(nowIso(), ctx.timezone)
  const windowStart = addDaysIso(today, -(Math.max(1, days) - 1))

  // Recompute completed_count per date from completed_at (one day of UTC slop covers tz offset).
  const lowerBound = `${addDaysIso(windowStart, -1)}T00:00:00.000Z`
  const completed = db
    .select({ completedAt: tasks.completedAt })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNotNull(tasks.completedAt),
        gte(tasks.completedAt, lowerBound),
      ),
    )
    .all()
  const counts = new Map<string, number>()
  for (const row of completed) {
    if (row.completedAt === null) continue
    const d = dateInTz(row.completedAt, ctx.timezone)
    if (d < windowStart || d > today) continue
    counts.set(d, (counts.get(d) ?? 0) + 1)
  }

  for (let d = windowStart; d <= today; d = addDaysIso(d, 1)) {
    const newCount = counts.get(d) ?? 0
    const goalMet = newCount >= ctx.dailyGoal
    const existing = db
      .select({ count: dayStats.completedCount, goalMet: dayStats.goalMet })
      .from(dayStats)
      .where(and(eq(dayStats.userId, userId), eq(dayStats.date, d)))
      .get()
    if (existing === undefined) {
      if (newCount > 0) {
        db.insert(dayStats)
          .values({
            userId,
            date: d,
            completedCount: newCount,
            goalMet,
            isDayOff: ctx.daysOff.includes(isoWeekday(d)),
            isVacation: ctx.vacationMode,
          })
          .run()
      }
    } else if (existing.count !== newCount || existing.goalMet !== goalMet) {
      db.update(dayStats)
        .set({ completedCount: newCount, goalMet })
        .where(and(eq(dayStats.userId, userId), eq(dayStats.date, d)))
        .run()
    }

    if (!ctx.karmaEnabled) continue
    const hasDaily = hasGoalRow(db, userId, d, 'daily_goal')
    if (goalMet && !hasDaily) {
      db.insert(karmaLedger)
        .values({
          id: newId(),
          userId,
          at: nowIso(),
          date: d,
          reason: 'daily_goal',
          taskId: null,
          delta: KARMA_POINTS.dailyGoal,
        })
        .onConflictDoNothing()
        .run()
    } else if (!goalMet && hasDaily) {
      db.delete(karmaLedger)
        .where(
          and(
            eq(karmaLedger.userId, userId),
            eq(karmaLedger.date, d),
            eq(karmaLedger.reason, 'daily_goal'),
          ),
        )
        .run()
    }
  }

  if (!ctx.karmaEnabled) return
  const weekStarts = new Set<string>()
  for (let d = windowStart; d <= today; d = addDaysIso(d, 1)) {
    weekStarts.add(weekStartOf(d, ctx.weekStart))
  }
  for (const weekStart of weekStarts) {
    const met = weekCompleted(db, userId, weekStart) >= ctx.weeklyGoal
    const hasWeekly = hasGoalRow(db, userId, weekStart, 'weekly_goal')
    if (met && !hasWeekly) {
      db.insert(karmaLedger)
        .values({
          id: newId(),
          userId,
          at: nowIso(),
          date: weekStart,
          reason: 'weekly_goal',
          taskId: null,
          delta: KARMA_POINTS.weeklyGoal,
        })
        .onConflictDoNothing()
        .run()
    } else if (!met && hasWeekly) {
      db.delete(karmaLedger)
        .where(
          and(
            eq(karmaLedger.userId, userId),
            eq(karmaLedger.date, weekStart),
            eq(karmaLedger.reason, 'weekly_goal'),
          ),
        )
        .run()
    }
  }
}
