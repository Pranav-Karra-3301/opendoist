/**
 * Reminder dispatcher (phase 6 Task D). Fans a fired reminder out to every Web Push
 * subscription and every enabled notification channel of the owning user, applies the
 * per-channel failure bookkeeping (webhook auto-disable after WEBHOOK_AUTO_DISABLE_AFTER
 * consecutive failures), and prunes dead push subscriptions.
 *
 * The frozen entry points take only `(db, …)`. Runtime collaborators the signature cannot
 * carry are resolved lazily: `publicUrl` from `loadConfig()`, the log sink from `serverLog()`,
 * and the SSE bus from a settable module global (`setReminderEventBus`) — the boot wiring
 * `startReminderScheduler(db, defaultSchedulerDeps(db))` passes no bus, so the SSE publish is
 * best-effort until wired and always harmless when unset (channel state is persisted regardless,
 * so web clients still pick it up on the next `['channels']` refetch).
 */
import { type Due, dateInTz, type Priority } from '@opentask/core'
import { and, eq } from 'drizzle-orm'
import { loadConfig } from '../config'
import type { Db } from '../db/db'
import { notificationChannels, pushSubscriptions, reminders, tasks } from '../db/schema'
import type { EventBus } from '../events/bus'
import { nowIso } from '../lib/ids'
import { createLogger } from '../logger'
import { getSettings } from '../services/task-write'
import { defaultChannelDeps, sendToChannel } from './channels/index'
import { sendWebPush } from './channels/webpush'
import {
  type ChannelDeps,
  formatReminderBody,
  type ReminderPayload,
  type TestFireResult,
  taskDeepLink,
  WEBHOOK_AUTO_DISABLE_AFTER,
} from './contracts'

/* ---------- runtime collaborators the frozen signatures can't carry ---------- */

let reminderEventBus: EventBus | null = null

/**
 * Register the app's EventBus so a dispatcher-side channel auto-disable can push a live
 * `notification_channels` SSE frame. Optional: when unset the publish is skipped (the DB row
 * is still updated, so clients converge on their next refetch). Callable from boot wiring or tests.
 */
export function setReminderEventBus(bus: EventBus | null): void {
  reminderEventBus = bus
}

let logCache: ChannelDeps['log'] | undefined

/** Shared log sink (also used by the scheduler). Silent under Vitest; pino elsewhere. */
export function serverLog(): ChannelDeps['log'] {
  if (logCache !== undefined) return logCache
  if (process.env.VITEST) {
    logCache = () => {}
    return logCache
  }
  const logger = createLogger(loadConfig())
  logCache = (level, msg, data) => {
    logger[level](data ?? {}, msg)
  }
  return logCache
}

/* ---------- payload ---------- */

/**
 * Build the wire payload for one fire. `task.dueDate`/`task.dueTime` are the *effective* due the
 * caller chose (the task's own due for relative/auto reminders, the reminder's stored due for
 * absolute/recurring), so the body and `due` field always reflect what this reminder is about.
 */
export function buildReminderPayload(input: {
  task: {
    id: string
    content: string
    dueDate: string | null
    dueTime: string | null
    priority: 1 | 2 | 3 | 4
  }
  reminderId: string
  firedAt: string
  publicUrl: string | null
  timezone: string
  test?: boolean
}): ReminderPayload {
  const { task, reminderId, firedAt, publicUrl, timezone, test } = input
  const due = task.dueDate !== null ? { date: task.dueDate, time: task.dueTime } : null
  return {
    title: task.content,
    body: formatReminderBody(due, dateInTz(firedAt, timezone)),
    url: taskDeepLink(publicUrl, task.id),
    tag: `reminder-${reminderId}`,
    task_id: task.id,
    reminder_id: reminderId,
    fired_at: firedAt,
    priority: task.priority,
    due,
    test: test ?? false,
  }
}

/* ---------- fan-out ---------- */

/**
 * Deliver `payload` to every push subscription + every enabled channel of `userId`, returning the
 * per-sink tally. Dead push subscriptions ('gone') are always pruned. Channel failure bookkeeping
 * (counter increment, webhook auto-disable, SSE) runs only when `trackChannelHealth` is set — real
 * fires track health; test fires never mutate channel counters.
 */
async function fanOut(
  db: Db,
  userId: string,
  payload: ReminderPayload,
  opts: { trackChannelHealth: boolean },
): Promise<TestFireResult> {
  const log = serverLog()
  const result: TestFireResult = { push: { sent: 0, gone: 0, errors: 0 }, channels: [] }

  const subs = db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).all()
  for (const sub of subs) {
    const outcome = await sendWebPush(
      { id: sub.id, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      payload,
    )
    if (outcome === 'delivered') {
      result.push.sent++
      db.update(pushSubscriptions)
        .set({ lastUsedAt: nowIso() })
        .where(eq(pushSubscriptions.id, sub.id))
        .run()
    } else if (outcome === 'gone') {
      result.push.gone++
      db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)).run()
    } else {
      result.push.errors++
    }
  }

  // The per-TYPE `settings.notifications` toggles (a phase-5 vestige in core `UserSettings`) are
  // deliberately NOT consulted anywhere in this fan-out. Phase 6's delivery gates are per sink:
  // push = a subscription row exists for the device, ntfy/gotify/webhook = the channel row's
  // `enabled` flag (plan Task D frozen dispatcher; spec §2.2 "fires through enabled channels").
  // Gating on the toggles would silently mute channels the user explicitly created and enabled —
  // ntfy/gotify/webhook default to `false` and the phase-6 Notifications page exposes no UI for
  // them. Pinned by dispatch.test.ts ("ignores the vestigial settings.notifications toggles").
  const channels = db
    .select()
    .from(notificationChannels)
    .where(and(eq(notificationChannels.userId, userId), eq(notificationChannels.enabled, true)))
    .all()
  for (const ch of channels) {
    const outcome = await sendToChannel(ch.type, ch.configJson, payload, defaultChannelDeps(log))
    result.channels.push({ id: ch.id, name: ch.name, outcome })
    if (!opts.trackChannelHealth) continue
    if (outcome === 'delivered') {
      db.update(notificationChannels)
        .set({ consecutiveFailures: 0, updatedAt: nowIso() })
        .where(eq(notificationChannels.id, ch.id))
        .run()
    } else if (outcome === 'error') {
      const next = ch.consecutiveFailures + 1
      const disable = ch.type === 'webhook' && next >= WEBHOOK_AUTO_DISABLE_AFTER
      db.update(notificationChannels)
        .set({
          consecutiveFailures: next,
          ...(disable
            ? {
                enabled: false,
                disabledReason: 'Disabled automatically after 10 consecutive delivery failures',
              }
            : {}),
          updatedAt: nowIso(),
        })
        .where(eq(notificationChannels.id, ch.id))
        .run()
      if (disable) {
        reminderEventBus?.publish({
          userId,
          type: 'notification_channels.updated',
          entity: 'notification_channels',
          ids: [ch.id],
        })
      }
    }
    // 'gone' never originates from a channel adapter — record only, leave the counter alone.
  }

  return result
}

/* ---------- entry points ---------- */

/**
 * Deliver a claimed reminder. The scheduler has already set `fired_at`; a missing, soft-deleted,
 * or (for non-recurring reminders) completed task means nothing to send. Absolute/recurring
 * reminders carry their own stored due; relative/auto reminders use the task's due.
 */
export async function dispatchReminder(db: Db, reminderId: string): Promise<void> {
  const reminder = db.select().from(reminders).where(eq(reminders.id, reminderId)).get()
  if (reminder === undefined) return
  const task = db.select().from(tasks).where(eq(tasks.id, reminder.taskId)).get()
  // Already claimed by the scheduler; a task that is gone, deleted, or done (and not recurring)
  // has nothing to deliver — log and return rather than fan out to nowhere.
  if (task === undefined || task.deletedAt !== null) {
    serverLog()('info', 'reminder not dispatched: task missing or deleted', { reminderId })
    return
  }
  if (task.completedAt !== null && reminder.type !== 'recurring') {
    serverLog()('info', 'reminder not dispatched: task already completed', { reminderId })
    return
  }

  const timezone = getSettings(db, reminder.userId).timezone
  const publicUrl = loadConfig().publicUrl

  let effDate: string | null
  let effTime: string | null
  if (reminder.type === 'relative') {
    effDate = task.dueDate
    effTime = task.dueTime
  } else {
    const due = reminder.dueJson === null ? null : (JSON.parse(reminder.dueJson) as Due)
    effDate = due?.date ?? null
    effTime = due?.time ?? null
  }

  const payload = buildReminderPayload({
    task: {
      id: task.id,
      content: task.content,
      dueDate: effDate,
      dueTime: effTime,
      priority: task.priority as Priority,
    },
    reminderId,
    firedAt: nowIso(),
    publicUrl,
    timezone,
    test: false,
  })

  await fanOut(db, reminder.userId, payload, { trackChannelHealth: true })
}

/**
 * Deliver a caller-supplied payload (the "Send test notification" action) across the same sinks,
 * returning the tally. Test fires prune dead push subscriptions but never touch channel counters.
 */
export async function dispatchTestPayload(
  db: Db,
  userId: string,
  payload: ReminderPayload,
): Promise<TestFireResult> {
  return fanOut(db, userId, payload, { trackChannelHealth: false })
}
