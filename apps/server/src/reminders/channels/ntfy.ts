// Task F (phase 6): ntfy channel adapter — one JSON publish to the server root (dossier §5.5).
import type { Priority } from '@opendoist/core'
import {
  type ChannelAdapter,
  type ChannelDeps,
  type NtfyConfig,
  NtfyConfigSchema,
  type ReminderPayload,
  type SendOutcome,
} from '../contracts'

/** OpenDoist priority (1 = highest … 4 = default) → ntfy scale (1 min … 5 max). FROZEN. */
const NTFY_PRIORITY: Record<Priority, number> = { 1: 5, 2: 4, 3: 3, 4: 3 }

const REQUEST_TIMEOUT_MS = 10_000

async function send(
  payload: ReminderPayload,
  config: NtfyConfig,
  deps: ChannelDeps,
): Promise<SendOutcome> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (config.token) headers.authorization = `Bearer ${config.token}`

  const body = JSON.stringify({
    topic: config.topic,
    title: payload.title,
    message: payload.body,
    priority: NTFY_PRIORITY[payload.priority],
    click: payload.url,
    tags: ['bell'],
  })

  try {
    const res = await deps.fetch(config.server, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (res.ok) return 'delivered'
    deps.log('warn', 'ntfy publish returned a non-ok status', {
      status: res.status,
      topic: config.topic,
    })
    return 'error'
  } catch (err) {
    deps.log('warn', 'ntfy publish request failed', {
      error: String(err),
      topic: config.topic,
    })
    return 'error'
  }
}

export const ntfyAdapter: ChannelAdapter<'ntfy'> = {
  type: 'ntfy',
  configSchema: NtfyConfigSchema,
  send,
}
