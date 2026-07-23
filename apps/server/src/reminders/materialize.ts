/**
 * Phase 6 Task B — fire-instant materialization + auto-reminders.
 *
 * `computeFireAt` and `advanceRecurringReminder` are pure (no DB); `syncTaskReminders`
 * recomputes/repairs every reminder row for a task after any task write. All fire instants
 * are ISO-8601 UTC with ms precision (`new Date(x).toISOString()`) so the scheduler's
 * lexicographic `fire_at_utc <= now` comparison stays correct.
 */
import {
  DEFAULT_PARSE_CONTEXT_SETTINGS,
  type Due,
  DueSchema,
  instantFor,
  nextOccurrence,
  UserSettingsSchema,
} from '@opentask/core'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/db'
import { reminders, tasks, userSettings } from '../db/schema'
import { newId, nowIso } from '../lib/ids'
import type { ReminderType } from './contracts'

/** Normalize any epoch-ms instant to the fixed-width UTC form written to `fire_at_utc`. */
function isoMs(ms: number): string {
  return new Date(ms).toISOString()
}

/**
 * Fire instant for one reminder given its task's due; null = unfireable.
 * - relative: task due must have a date AND time; fires `minuteOffset` minutes before it.
 * - absolute: fires at the reminder's own date+time.
 * - recurring: fires at the reminder due's date + (`time` ?? first recurrence time).
 */
export function computeFireAt(
  r: { type: ReminderType; minuteOffset: number | null; due: Due | null },
  taskDue: { date: string; time: string | null } | null,
  timezone: string,
): string | null {
  if (r.type === 'relative') {
    if (taskDue === null || taskDue.time === null) return null
    const at = Date.parse(instantFor(taskDue.date, taskDue.time, timezone))
    return isoMs(at - (r.minuteOffset ?? 0) * 60_000)
  }
  if (r.type === 'absolute') {
    if (r.due === null || r.due.time === null) return null
    return isoMs(Date.parse(instantFor(r.due.date, r.due.time, timezone)))
  }
  // recurring
  if (r.due === null) return null
  const time = r.due.time ?? r.due.recurrence?.times[0] ?? null
  if (time === null) return null
  return isoMs(Date.parse(instantFor(r.due.date, time, timezone)))
}

/**
 * Advance a recurring reminder after it fired: returns the updated {due, fireAtUtc} or null
 * when the series is exhausted (past `until`, or no fireable time remains). Pure — the DB
 * write stays in the scheduler.
 */
export function advanceRecurringReminder(
  due: Due,
  timezone: string,
  now: string,
): { due: Due; fireAtUtc: string } | null {
  if (due.recurrence === null) return null
  const next = nextOccurrence(due.recurrence, {
    after: { date: due.date, time: due.time },
    ctx: { ...DEFAULT_PARSE_CONTEXT_SETTINGS, now, timezone },
  })
  if (next === null) return null
  const nextDue: Due = { ...due, date: next.date, time: next.time ?? due.time }
  const fireAtUtc = computeFireAt(
    { type: 'recurring', minuteOffset: null, due: nextDue },
    null,
    timezone,
  )
  if (fireAtUtc === null) return null
  return { due: nextDue, fireAtUtc }
}

function parseDue(dueJson: string | null): Due | null {
  return dueJson === null ? null : DueSchema.parse(JSON.parse(dueJson))
}

/**
 * Recompute/repair all reminders for a task. Call after ANY task create, update, complete,
 * uncomplete, delete, or recurring-advance.
 *
 * Rules:
 * - Recompute each row's `fire_at_utc`; if it changed, reset `fired_at = null` (re-arm) —
 *   EXCEPT a relative instant that is already past at sync time, which is claimed instead
 *   (`fired_at = now`): a reminder born in the past (task created/edited after its moment)
 *   must not fire late. Rows whose instant is unchanged are never touched, so armed-overdue
 *   rows still get the scheduler's downtime catch-up.
 * - On a completed non-recurring task or a soft-deleted task, relative/auto rows are nulled
 *   (absolute/recurring rows keep their own instant).
 * - Maintain the auto rows for a task that is alive with a timed due: always one at-time row
 *   (offset 0), plus one heads-up row at the user's `autoReminderMinutes` when set. An offset
 *   already covered by a non-auto relative reminder is skipped (the explicit reminder wins);
 *   auto rows outside the wanted set are removed.
 */
export async function syncTaskReminders(db: Db, taskId: string): Promise<void> {
  const task = db
    .select({
      userId: tasks.userId,
      dueDate: tasks.dueDate,
      dueTime: tasks.dueTime,
      recurrence: tasks.recurrence,
      completedAt: tasks.completedAt,
      deletedAt: tasks.deletedAt,
    })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get()
  if (task === undefined) return

  const settingsRow = db
    .select({ settings: userSettings.settings })
    .from(userSettings)
    .where(eq(userSettings.userId, task.userId))
    .get()
  const settings =
    settingsRow === undefined
      ? UserSettingsSchema.parse({})
      : UserSettingsSchema.parse(JSON.parse(settingsRow.settings))
  const { timezone } = settings
  const autoMinutes = settings.autoReminderMinutes

  const alive = task.completedAt === null && task.deletedAt === null
  const hasTimedDue = task.dueDate !== null && task.dueTime !== null
  const taskDue = task.dueDate !== null ? { date: task.dueDate, time: task.dueTime } : null
  // A relative/auto reminder cannot fire for a finished task; the dispatcher also skips these,
  // but nulling the instant keeps the pending-scan lean (belt and suspenders).
  const suppressRelative =
    task.deletedAt !== null || (task.completedAt !== null && task.recurrence === null)

  // ---- Pass 1: auto-reminder maintenance ----
  // Wanted auto offsets: the built-in at-time reminder (0) for every live timed task, plus the
  // user's optional heads-up offset. A Set collapses autoMinutes = 0 into the at-time row, and
  // any offset already covered by an explicit non-auto relative reminder is dropped (it wins).
  const rows = db.select().from(reminders).where(eq(reminders.taskId, taskId)).all()
  const wantedOffsets = new Set<number>()
  if (alive && hasTimedDue) {
    wantedOffsets.add(0)
    if (autoMinutes !== null) wantedOffsets.add(autoMinutes)
  }
  for (const r of rows) {
    if (!r.isAuto && r.type === 'relative' && r.minuteOffset !== null) {
      wantedOffsets.delete(r.minuteOffset)
    }
  }

  // Reconcile existing auto rows against the wanted set: keep one row per wanted offset,
  // delete stale/duplicate ones, insert the missing ones (pass 2 arms their instants).
  const keptOffsets = new Set<number>()
  for (const r of rows.filter((r) => r.isAuto)) {
    const wanted =
      r.minuteOffset !== null &&
      wantedOffsets.has(r.minuteOffset) &&
      !keptOffsets.has(r.minuteOffset)
    if (wanted && r.minuteOffset !== null) {
      keptOffsets.add(r.minuteOffset)
    } else {
      db.delete(reminders).where(eq(reminders.id, r.id)).run()
    }
  }
  for (const offset of wantedOffsets) {
    if (keptOffsets.has(offset)) continue
    const stamp = nowIso()
    db.insert(reminders)
      .values({
        id: newId(),
        userId: task.userId,
        taskId,
        type: 'relative',
        minuteOffset: offset,
        dueJson: null,
        isAuto: true,
        fireAtUtc: null,
        firedAt: null,
        createdAt: stamp,
        updatedAt: stamp,
      })
      .run()
  }

  // ---- Pass 2: recompute fire instants for every surviving row ----
  const finalRows = db.select().from(reminders).where(eq(reminders.taskId, taskId)).all()
  const syncNow = nowIso()
  for (const r of finalRows) {
    const input = { type: r.type, minuteOffset: r.minuteOffset, due: parseDue(r.dueJson) }
    const nextFireAt =
      r.type === 'relative' && suppressRelative ? null : computeFireAt(input, taskDue, timezone)
    if (nextFireAt !== r.fireAtUtc) {
      // A relative instant that lands in the past is claimed at birth: no late notification.
      // (Recurring rows are excluded — the scheduler's claim-and-advance owns their rollover.)
      const bornPast = r.type === 'relative' && nextFireAt !== null && nextFireAt <= syncNow
      db.update(reminders)
        .set({ fireAtUtc: nextFireAt, firedAt: bornPast ? syncNow : null, updatedAt: syncNow })
        .where(eq(reminders.id, r.id))
        .run()
    }
  }
}
