import type { Logger } from 'pino'
// web-push is CommonJS: under real Node ESM only `WebPushError` (and little else) is a detectable
// named export — `sendNotification`/`setVapidDetails` exist solely on the synthetic default
// (module.exports). Vitest's interop hid this; `tsx src/index.ts` crashed on boot. Default-import.
import webpush, { WebPushError } from 'web-push'
import { loadConfig } from '../../config'
import { createLogger } from '../../logger'
import { getOrCreateVapidKeys } from '../../secrets'
import type { ReminderPayload, SendOutcome } from '../contracts'

/** The columns the dispatcher hands to {@link sendWebPush} — a decoded push subscription. */
export interface PushSubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

// VAPID is process-global in web-push, so init exactly once (the keys never rotate at runtime).
let vapidInitialized = false
function ensureVapid(): void {
  if (vapidInitialized) return
  const { publicKey, privateKey, subject } = getOrCreateVapidKeys()
  webpush.setVapidDetails(subject, publicKey, privateKey)
  vapidInitialized = true
}

// No logger is injected (frozen signature), so lazily build one from the ambient config.
let logger: Logger | undefined
function warn(msg: string, data: Record<string, unknown>): void {
  logger ??= createLogger(loadConfig())
  logger.warn(data, msg)
}

/**
 * Deliver a reminder to one browser push subscription.
 *
 * The body is a minimal 4-field envelope (`title`, `body`, `url`, `tag`) — the browser push
 * payload cap is ~4 KB, so the full ReminderPayload is NEVER sent; the service worker only needs
 * these fields to render the notification. `title`/`body` are truncated defensively.
 *
 * A 404/410 from the push service means the subscription is dead (`'gone'`) and the dispatcher
 * will delete it; every other failure is a transient/config `'error'`.
 */
export async function sendWebPush(
  sub: PushSubscriptionRow,
  payload: ReminderPayload,
): Promise<SendOutcome> {
  ensureVapid()
  const body = JSON.stringify({
    title: payload.title.slice(0, 120),
    body: payload.body.slice(0, 512),
    url: payload.url,
    tag: payload.tag,
  })
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      body,
      {
        TTL: 3600,
        urgency: 'high',
        topic: payload.reminder_id.slice(0, 32),
      },
    )
    return 'delivered'
  } catch (err) {
    if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) {
      return 'gone'
    }
    warn('web push send failed', {
      endpoint: sub.endpoint,
      statusCode: err instanceof WebPushError ? err.statusCode : undefined,
      error: err instanceof Error ? err.message : String(err),
    })
    return 'error'
  }
}
