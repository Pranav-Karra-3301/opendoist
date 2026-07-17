// Task G (phase 6) — Gotify channel adapter.
// Native Gotify push: a single JSON POST to `<server>/message` authenticated with the
// application token (`X-Gotify-Key`), mapping OpenDoist priority to Gotify importance and
// carrying a click-through URL via message extras. One attempt, 10 s timeout, no retries;
// consecutive-failure bookkeeping / auto-disable lives in the dispatcher (Task D), not here.
import type { Priority } from '@opendoist/core'
import { type ChannelAdapter, GotifyConfigSchema } from '../contracts'

/** Frozen map: OpenDoist p1..p4 → Gotify importance (0 quiet … 8 highest). */
const GOTIFY_PRIORITY: Record<Priority, number> = { 1: 8, 2: 6, 3: 4, 4: 2 }

const TIMEOUT_MS = 10_000

export const gotifyAdapter: ChannelAdapter<'gotify'> = {
  type: 'gotify',
  configSchema: GotifyConfigSchema,
  async send(payload, config, deps) {
    const url = `${config.server.replace(/\/+$/, '')}/message`
    const body = JSON.stringify({
      title: payload.title,
      message: payload.body,
      priority: GOTIFY_PRIORITY[payload.priority],
      extras: { 'client::notification': { click: { url: payload.url } } },
    })
    try {
      const res = await deps.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-gotify-key': config.app_token },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (res.ok) return 'delivered'
      deps.log('warn', 'gotify delivery failed', { status: res.status })
      return 'error'
    } catch (err) {
      deps.log('warn', 'gotify delivery error', { error: String(err) })
      return 'error'
    }
  },
}
