/**
 * Reminder scheduler (phase 6 Task D). A croner 30 s tick claims every reminder whose precomputed
 * `fire_at_utc` is due, dispatches the fresh ones, suppresses the badly-overdue ones, and advances
 * recurring reminders to their next instant. Claiming happens before any work so overlapping ticks
 * (or a crash mid-dispatch) can never double-fire a reminder.
 */
import type { Due } from '@opentask/core'
import { Cron } from 'croner'
import { and, eq, isNotNull, isNull, lte } from 'drizzle-orm'
import type { Db } from '../db/db'
import { reminders } from '../db/schema'
import { nowIso } from '../lib/ids'
import { getSettings } from '../services/task-write'
import { type ChannelDeps, SCHEDULER_BATCH_LIMIT, STALE_SUPPRESS_MS } from './contracts'
import { dispatchReminder, serverLog } from './dispatch'
import { advanceRecurringReminder } from './materialize'

export interface SchedulerDeps {
  /** current instant, ISO ms UTC */
  now: () => string
  /** injected for tests; default = dispatchReminder */
  dispatch: (reminderId: string) => Promise<void>
  log: ChannelDeps['log']
}

/** Production deps: real clock, real dispatcher, shared server log sink. */
export function defaultSchedulerDeps(db: Db): SchedulerDeps {
  return {
    now: () => nowIso(),
    dispatch: (id) => dispatchReminder(db, id),
    log: serverLog(),
  }
}

/**
 * One scheduler pass. Selects up to SCHEDULER_BATCH_LIMIT pending-and-due reminders (ordered by
 * fire instant), and for each: claims it (idempotent conditional UPDATE — a lost race is skipped),
 * suppresses it when it is more than STALE_SUPPRESS_MS overdue, otherwise dispatches it, then
 * re-arms recurring reminders onto their next occurrence.
 */
export async function runSchedulerTick(
  db: Db,
  deps: SchedulerDeps,
): Promise<{ claimed: number; dispatched: number; suppressed: number; advanced: number }> {
  const now = deps.now()
  const rows = db
    .select()
    .from(reminders)
    .where(
      and(isNotNull(reminders.fireAtUtc), lte(reminders.fireAtUtc, now), isNull(reminders.firedAt)),
    )
    .orderBy(reminders.fireAtUtc)
    .limit(SCHEDULER_BATCH_LIMIT)
    .all()

  let claimed = 0
  let dispatched = 0
  let suppressed = 0
  let advanced = 0

  for (const row of rows) {
    // Claim first: only the tick that flips fired_at from NULL owns this fire.
    const res = db
      .update(reminders)
      .set({ firedAt: now })
      .where(and(eq(reminders.id, row.id), isNull(reminders.firedAt)))
      .run()
    if (res.changes === 0) continue
    claimed++

    const fireAt = row.fireAtUtc
    const stale = fireAt !== null && Date.parse(now) - Date.parse(fireAt) > STALE_SUPPRESS_MS
    if (stale) {
      suppressed++
      deps.log('warn', 'reminder stale-suppressed', { reminderId: row.id, fireAtUtc: fireAt, now })
    } else {
      try {
        await deps.dispatch(row.id)
        dispatched++
      } catch (e) {
        deps.log('error', 'reminder dispatch failed', { reminderId: row.id, error: String(e) })
      }
    }

    // Recurring reminders advance whether they fired or were suppressed; a null result ends the series.
    if (row.type === 'recurring' && row.dueJson !== null) {
      const timezone = getSettings(db, row.userId).timezone
      const parsedDue = JSON.parse(row.dueJson) as Due
      const next = advanceRecurringReminder(parsedDue, timezone, now)
      if (next !== null) {
        db.update(reminders)
          .set({
            dueJson: JSON.stringify(next.due),
            fireAtUtc: next.fireAtUtc,
            firedAt: null,
            updatedAt: nowIso(),
          })
          .where(eq(reminders.id, row.id))
          .run()
        advanced++
      }
    }
  }

  return { claimed, dispatched, suppressed, advanced }
}

/**
 * Start the background scheduler: one immediate catch-up tick (overdue-but-fresh rows fire now,
 * badly-overdue rows get their single suppression) followed by a 30 s croner tick. `protect: true`
 * skips a tick that would overlap a still-running one; `catch` keeps a thrown tick from killing cron.
 */
export function startReminderScheduler(db: Db, deps: SchedulerDeps): { stop: () => void } {
  void runSchedulerTick(db, deps).catch((e) =>
    deps.log('error', 'scheduler boot tick failed', { error: String(e) }),
  )
  const cron = new Cron(
    '*/30 * * * * *',
    {
      protect: true,
      catch: (e: unknown) => deps.log('error', 'scheduler tick failed', { error: String(e) }),
    },
    async () => {
      await runSchedulerTick(db, deps)
    },
  )
  return { stop: () => cron.stop() }
}
