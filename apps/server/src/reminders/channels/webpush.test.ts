import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendNotification, setVapidDetails, WebPushError } from 'web-push'
import type { ReminderPayload } from '../contracts'
import { type PushSubscriptionRow, sendWebPush } from './webpush'

// Keep the VAPID init off the real filesystem (no /data access in a unit test).
vi.mock('../../secrets', () => ({
  getOrCreateVapidKeys: () => ({
    publicKey: 'test-public-key',
    privateKey: 'test-private-key',
    subject: 'mailto:admin@opendoist.local',
  }),
}))

// Replace web-push wholesale; supply a WebPushError shaped exactly like the real one (statusCode).
// The implementation default-imports (CJS interop — see webpush.ts), so the factory exposes the
// SAME fn instances both as named exports (asserted on below) and on `default` (called by source).
vi.mock('web-push', () => {
  class WebPushError extends Error {
    statusCode: number
    constructor(message: string, statusCode: number) {
      super(message)
      this.name = 'WebPushError'
      this.statusCode = statusCode
    }
  }
  const setVapidDetails = vi.fn()
  const sendNotification = vi.fn()
  return {
    setVapidDetails,
    sendNotification,
    WebPushError,
    default: { setVapidDetails, sendNotification, WebPushError },
  }
})

const sub: PushSubscriptionRow = {
  id: 's1',
  endpoint: 'https://push.example.com/abc',
  p256dh: 'p256dh-key',
  auth: 'auth-secret',
}

function makePayload(over: Partial<ReminderPayload> = {}): ReminderPayload {
  return {
    title: 'Renew passport',
    body: 'Due today at 17:00',
    url: 'http://localhost:7968/task/t1',
    tag: 'reminder-r1',
    task_id: 't1',
    reminder_id: 'r1',
    fired_at: '2026-07-16T20:30:00.000Z',
    priority: 1,
    due: { date: '2026-07-16', time: '17:00' },
    test: false,
    ...over,
  }
}

// Silence the lazy diagnostic logger the error path builds from config.
const prevLogLevel = process.env.OPENDOIST_LOG_LEVEL
beforeAll(() => {
  process.env.OPENDOIST_LOG_LEVEL = 'silent'
})
afterAll(() => {
  if (prevLogLevel === undefined) delete process.env.OPENDOIST_LOG_LEVEL
  else process.env.OPENDOIST_LOG_LEVEL = prevLogLevel
})
beforeEach(() => {
  vi.mocked(sendNotification).mockReset()
  vi.mocked(sendNotification).mockResolvedValue({ statusCode: 201, body: '', headers: {} })
})

describe('sendWebPush', () => {
  it('delivers with the exact 4-field body and high-urgency TTL/topic options', async () => {
    const outcome = await sendWebPush(sub, makePayload())
    expect(outcome).toBe('delivered')

    // VAPID is initialised lazily from the persisted keys before the first send.
    expect(setVapidDetails).toHaveBeenCalledWith(
      'mailto:admin@opendoist.local',
      'test-public-key',
      'test-private-key',
    )

    expect(sendNotification).toHaveBeenCalledTimes(1)
    expect(sendNotification).toHaveBeenCalledWith(
      {
        endpoint: 'https://push.example.com/abc',
        keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
      },
      JSON.stringify({
        title: 'Renew passport',
        body: 'Due today at 17:00',
        url: 'http://localhost:7968/task/t1',
        tag: 'reminder-r1',
      }),
      { TTL: 3600, urgency: 'high', topic: 'r1' },
    )
  })

  it('never sends the full payload — only title/body/url/tag reach the wire', async () => {
    await sendWebPush(sub, makePayload())
    const body = vi.mocked(sendNotification).mock.calls[0]?.[1] as string
    expect(JSON.parse(body)).toStrictEqual({
      title: 'Renew passport',
      body: 'Due today at 17:00',
      url: 'http://localhost:7968/task/t1',
      tag: 'reminder-r1',
    })
  })

  it('truncates title to 120 and body to 512 characters', async () => {
    await sendWebPush(sub, makePayload({ title: 'T'.repeat(200), body: 'B'.repeat(600) }))
    const body = JSON.parse(vi.mocked(sendNotification).mock.calls[0]?.[1] as string) as {
      title: string
      body: string
    }
    expect(body.title).toHaveLength(120)
    expect(body.body).toHaveLength(512)
  })

  it('caps the coalescing topic at 32 characters', async () => {
    await sendWebPush(sub, makePayload({ reminder_id: 'r'.repeat(50) }))
    const opts = vi.mocked(sendNotification).mock.calls[0]?.[2] as { topic: string }
    expect(opts.topic).toHaveLength(32)
  })

  it('maps a 410 Gone to "gone" so the dispatcher prunes the subscription', async () => {
    // Real WebPushError takes (message, statusCode, headers, body, endpoint); the runtime mock
    // only reads statusCode, but the static @types signature requires all five arguments.
    vi.mocked(sendNotification).mockRejectedValue(
      new WebPushError('gone', 410, {}, '', sub.endpoint),
    )
    expect(await sendWebPush(sub, makePayload())).toBe('gone')
  })

  it('maps a 404 Not Found to "gone"', async () => {
    vi.mocked(sendNotification).mockRejectedValue(
      new WebPushError('missing', 404, {}, '', sub.endpoint),
    )
    expect(await sendWebPush(sub, makePayload())).toBe('gone')
  })

  it('maps other push-service failures to "error"', async () => {
    vi.mocked(sendNotification).mockRejectedValue(
      new WebPushError('boom', 500, {}, '', sub.endpoint),
    )
    expect(await sendWebPush(sub, makePayload())).toBe('error')
  })

  it('maps a non-WebPushError rejection (network) to "error"', async () => {
    vi.mocked(sendNotification).mockRejectedValue(new Error('ECONNREFUSED'))
    expect(await sendWebPush(sub, makePayload())).toBe('error')
  })
})
