/**
 * Channel registry — FINAL (phase 6 Task A Step 6). No other task edits this file;
 * Tasks F/G/H replace the adapter modules it imports.
 */
import type { ChannelDeps, ChannelType, ReminderPayload, SendOutcome } from '../contracts'
import { gotifyAdapter } from './gotify'
import { ntfyAdapter } from './ntfy'
import { webhookAdapter } from './webhook'

export function defaultChannelDeps(log: ChannelDeps['log']): ChannelDeps {
  return { fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), log }
}

/** Validate configJson with the adapter's schema, then send. Invalid config → 'error'. */
export async function sendToChannel(
  type: ChannelType,
  configJson: string,
  payload: ReminderPayload,
  deps: ChannelDeps,
): Promise<SendOutcome> {
  const adapter = type === 'ntfy' ? ntfyAdapter : type === 'gotify' ? gotifyAdapter : webhookAdapter
  const parsed = adapter.configSchema.safeParse(JSON.parse(configJson))
  if (!parsed.success) {
    deps.log('error', 'channel config invalid', { type })
    return 'error'
  }
  // each branch is fully typed; the ternary above keeps adapter/config pairs aligned
  return adapter.send(payload, parsed.data as never, deps)
}
