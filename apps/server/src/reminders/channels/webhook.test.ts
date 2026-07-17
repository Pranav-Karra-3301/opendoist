import { describe, expect, it, vi } from 'vitest'
import type { ChannelDeps, ReminderPayload, WebhookConfig } from '../contracts'
import { signWebhookBody, webhookAdapter, webhookBody } from './webhook'

const CONFIG: WebhookConfig = { url: 'https://example.com/hook', secret: 'test-secret-123' }

/** Payload that produces the frozen golden HMAC vector (Task H). */
const GOLDEN_PAYLOAD: ReminderPayload = {
  title: 'Renew passport',
  body: 'Due 2026-07-16 at 17:00',
  url: 'http://localhost:7968/task/t1',
  tag: 'reminder-r1',
  task_id: 't1',
  reminder_id: 'r1',
  fired_at: '2026-07-16T20:30:00.000Z',
  priority: 4,
  due: { date: '2026-07-16', time: '17:00' },
  test: false,
}

const GOLDEN_BODY =
  '{"event":"reminder.due","task":{"id":"t1","title":"Renew passport","due":{"date":"2026-07-16","time":"17:00"},"url":"http://localhost:7968/task/t1"},"firedAt":"2026-07-16T20:30:00.000Z"}'
const GOLDEN_SIG = 'd857b874db1ac1d5100927ed749802850a73dedad3f5394d9b8e0c0d9542c50f'

function ok(status = 200): Response {
  return new Response(null, { status })
}

function harness() {
  const fetch = vi.fn<typeof globalThis.fetch>()
  const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined)
  const log = vi.fn<ChannelDeps['log']>()
  const deps: ChannelDeps = { fetch, sleep, log }
  return { fetch, sleep, log, deps }
}

describe('webhookBody', () => {
  it('emits the frozen canonical body byte-for-byte for the golden vector', () => {
    expect(webhookBody(GOLDEN_PAYLOAD)).toBe(GOLDEN_BODY)
  })

  it('uses the reminder.test event name when payload.test is set', () => {
    const body = webhookBody({ ...GOLDEN_PAYLOAD, test: true })
    expect(JSON.parse(body).event).toBe('reminder.test')
    expect(body).toBe(GOLDEN_BODY.replace('"reminder.due"', '"reminder.test"'))
  })

  it('preserves the frozen key order: event, task{id,title,due,url}, firedAt', () => {
    const body = webhookBody(GOLDEN_PAYLOAD)
    expect(Object.keys(JSON.parse(body))).toEqual(['event', 'task', 'firedAt'])
    expect(Object.keys(JSON.parse(body).task)).toEqual(['id', 'title', 'due', 'url'])
  })

  it('serializes a null due as null', () => {
    const body = webhookBody({ ...GOLDEN_PAYLOAD, due: null })
    expect(JSON.parse(body).task.due).toBeNull()
  })
})

describe('signWebhookBody', () => {
  it('matches the frozen golden HMAC-SHA256 hex vector', () => {
    expect(signWebhookBody(GOLDEN_BODY, 'test-secret-123')).toBe(GOLDEN_SIG)
  })

  it('is sensitive to both body and secret', () => {
    expect(signWebhookBody(GOLDEN_BODY, 'other-secret')).not.toBe(GOLDEN_SIG)
    expect(signWebhookBody(`${GOLDEN_BODY} `, 'test-secret-123')).not.toBe(GOLDEN_SIG)
  })
})

describe('webhookAdapter.send', () => {
  it('is registered with the frozen type and schema', () => {
    expect(webhookAdapter.type).toBe('webhook')
  })

  it('POSTs the signed canonical body and returns delivered on 2xx', async () => {
    const { fetch, sleep, deps } = harness()
    fetch.mockResolvedValue(ok(200))

    const outcome = await webhookAdapter.send(GOLDEN_PAYLOAD, CONFIG, deps)

    expect(outcome).toBe('delivered')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()

    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe(CONFIG.url)
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(GOLDEN_BODY)
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(init?.headers).toMatchObject({
      'content-type': 'application/json',
      'user-agent': 'OpenDoist-Webhook',
      'x-signature': `sha256=${GOLDEN_SIG}`,
    })

    // Recompute the signature from the exact bytes that were sent.
    const headers = init?.headers as Record<string, string>
    expect(headers['x-signature']).toBe(
      `sha256=${signWebhookBody(String(init?.body), CONFIG.secret)}`,
    )
  })

  it('signs a reminder.test payload with the test event name', async () => {
    const { fetch, deps } = harness()
    fetch.mockResolvedValue(ok(204))

    await webhookAdapter.send({ ...GOLDEN_PAYLOAD, test: true }, CONFIG, deps)

    const init = fetch.mock.calls[0]?.[1]
    const sentBody = String(init?.body)
    expect(JSON.parse(sentBody).event).toBe('reminder.test')
    const headers = init?.headers as Record<string, string>
    expect(headers['x-signature']).toBe(`sha256=${signWebhookBody(sentBody, CONFIG.secret)}`)
  })

  it('retries twice then succeeds: 3 fetches, back-off [1000, 5000]', async () => {
    const { fetch, sleep, deps } = harness()
    fetch
      .mockResolvedValueOnce(ok(500))
      .mockResolvedValueOnce(ok(502))
      .mockResolvedValueOnce(ok(200))

    const outcome = await webhookAdapter.send(GOLDEN_PAYLOAD, CONFIG, deps)

    expect(outcome).toBe('delivered')
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 5000])
  })

  it('returns error after 3 non-2xx attempts and does not sleep after the last', async () => {
    const { fetch, sleep, deps } = harness()
    fetch.mockResolvedValue(ok(500))

    const outcome = await webhookAdapter.send(GOLDEN_PAYLOAD, CONFIG, deps)

    expect(outcome).toBe('error')
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 5000])
  })

  it('treats a thrown request as a retryable failure', async () => {
    const { fetch, sleep, deps } = harness()
    fetch.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValueOnce(ok(200))

    const outcome = await webhookAdapter.send(GOLDEN_PAYLOAD, CONFIG, deps)

    expect(outcome).toBe('delivered')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000])
  })

  it('returns error when every attempt throws', async () => {
    const { fetch, deps } = harness()
    fetch.mockRejectedValue(new Error('network down'))

    const outcome = await webhookAdapter.send(GOLDEN_PAYLOAD, CONFIG, deps)

    expect(outcome).toBe('error')
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})
