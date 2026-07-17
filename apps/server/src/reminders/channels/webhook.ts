import { createHmac } from 'node:crypto'
import {
  type ChannelAdapter,
  type ReminderPayload,
  type SendOutcome,
  WebhookConfigSchema,
} from '../contracts'

/** Per-attempt request timeout (frozen, Task H). */
const WEBHOOK_TIMEOUT_MS = 10_000
/** Back-off before the 2nd and 3rd delivery attempts; 3 attempts total (frozen, Task H). */
const RETRY_BACKOFF_MS: readonly number[] = [1000, 5000]

/**
 * Canonical JSON body — exact key order is a frozen contract (Task H golden vector):
 * `{ event, task: { id, title, due, url }, firedAt }`. The HMAC signature is computed
 * over these exact bytes, so this shape must never drift.
 */
export function webhookBody(payload: ReminderPayload): string {
  return JSON.stringify({
    event: payload.test ? 'reminder.test' : 'reminder.due',
    task: {
      id: payload.task_id,
      title: payload.title,
      due: payload.due,
      url: payload.url,
    },
    firedAt: payload.fired_at,
  })
}

/** Hex-encoded HMAC-SHA256 of the canonical body, keyed by the channel secret. */
export function signWebhookBody(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

export const webhookAdapter: ChannelAdapter<'webhook'> = {
  type: 'webhook',
  configSchema: WebhookConfigSchema,
  async send(payload, config, deps): Promise<SendOutcome> {
    const body = webhookBody(payload)
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-signature': `sha256=${signWebhookBody(body, config.secret)}`,
      'user-agent': 'OpenDoist-Webhook',
    }

    // Up to 3 attempts: fire immediately, then back off 1 s and 5 s before each retry.
    // First 2xx wins; a non-2xx status or a thrown request is retryable.
    const totalAttempts = RETRY_BACKOFF_MS.length + 1
    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      try {
        const res = await deps.fetch(config.url, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        })
        if (res.ok) return 'delivered'
        deps.log('warn', 'webhook non-2xx response', {
          url: config.url,
          status: res.status,
          attempt,
        })
      } catch (err) {
        deps.log('warn', 'webhook request failed', {
          url: config.url,
          attempt,
          error: String(err),
        })
      }
      const backoff = RETRY_BACKOFF_MS[attempt - 1]
      if (backoff !== undefined) await deps.sleep(backoff)
    }

    deps.log('error', 'webhook delivery failed after retries', {
      url: config.url,
      attempts: totalAttempts,
    })
    return 'error'
  },
}
