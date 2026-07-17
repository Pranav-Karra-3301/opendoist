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
} from '@opendoist/core'
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
 * - Recompute each row's `fire_at_utc`; if it changed, reset `fired_at = null` (re-arm).
 * - On a completed non-recurring task or a soft-deleted task, relative/auto rows are nulled
 *   (absolute/recurring rows keep their own instant).
 * - Maintain exactly one auto row when the task is alive, has a timed due, and the user's
 *   `autoReminderMinutes` is set — unless a non-auto relative reminder already uses that
 *   offset (dedupe). Otherwise the auto row is removed.
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
  const rows = db.select().from(reminders).where(eq(reminders.taskId, taskId)).all()
  const nonAutoRelativeOffsets = rows
    .filter((r) => !r.isAuto && r.type === 'relative')
    .map((r) => r.minuteOffset)
  const autoWanted =
    alive && hasTimedDue && autoMinutes !== null && !nonAutoRelativeOffsets.includes(autoMinutes)
  const autoRows = rows.filter((r) => r.isAuto)

  if (autoWanted) {
    if (autoRows.length === 0) {
      const stamp = nowIso()
      db.insert(reminders)
        .values({
          id: newId(),
          userId: task.userId,
          taskId,
          type: 'relative',
          minuteOffset: autoMinutes,
          dueJson: null,
          isAuto: true,
          fireAtUtc: null,
          firedAt: null,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .run()
    } else {
      const [keep, ...extras] = autoRows
      if (keep !== undefined && keep.minuteOffset !== autoMinutes) {
        db.update(reminders)
          .set({ minuteOffset: autoMinutes, updatedAt: nowIso() })
          .where(eq(reminders.id, keep.id))
          .run()
      }
      for (const extra of extras) {
        db.delete(reminders).where(eq(reminders.id, extra.id)).run()
      }
    }
  } else {
    for (const a of autoRows) {
      db.delete(reminders).where(eq(reminders.id, a.id)).run()
    }
  }

  // ---- Pass 2: recompute fire instants for every surviving row ----
  const finalRows = db.select().from(reminders).where(eq(reminders.taskId, taskId)).all()
  for (const r of finalRows) {
    const input = { type: r.type, minuteOffset: r.minuteOffset, due: parseDue(r.dueJson) }
    const nextFireAt =
      r.type === 'relative' && suppressRelative ? null : computeFireAt(input, taskDue, timezone)
    if (nextFireAt !== r.fireAtUtc) {
      db.update(reminders)
        .set({ fireAtUtc: nextFireAt, firedAt: null, updatedAt: nowIso() })
        .where(eq(reminders.id, r.id))
        .run()
    }
  }
}
