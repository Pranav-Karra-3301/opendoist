import { UserSettingsSchema } from '@opentask/core'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notificationChannels, pushSubscriptions, userSettings } from '../db/schema'
import { EventBus, type ServerEvent } from '../events/bus'
import { newId } from '../lib/ids'

vi.mock('./channels/webpush', () => ({ sendWebPush: vi.fn() }))
vi.mock('./channels/index', () => ({
  sendToChannel: vi.fn(),
  defaultChannelDeps: () => ({ fetch: globalThis.fetch, sleep: async () => {}, log: () => {} }),
}))

import { sendToChannel } from './channels/index'
import { sendWebPush } from './channels/webpush'
import type { ReminderPayload } from './contracts'
import {
  buildReminderPayload,
  dispatchReminder,
  dispatchTestPayload,
  setReminderEventBus,
} from './dispatch'
import { makeTestDb, seedReminder, seedTask, seedUser } from './test-helpers'

const sendWebPushMock = vi.mocked(sendWebPush)
const sendToChannelMock = vi.mocked(sendToChannel)

function seedPushSub(
  db: Awaited<ReturnType<typeof makeTestDb>>['db'],
  userId: string,
  endpoint: string,
) {
  const id = newId()
  db.insert(pushSubscriptions).values({ id, userId, endpoint, p256dh: 'p256', auth: 'auth' }).run()
  return id
}

function seedWebhook(
  db: Awaited<ReturnType<typeof makeTestDb>>['db'],
  userId: string,
  over?: { consecutiveFailures?: number; enabled?: boolean; name?: string },
) {
  const id = newId()
  db.insert(notificationChannels)
    .values({
      id,
      userId,
      type: 'webhook',
      name: over?.name ?? 'Home Assistant',
      enabled: over?.enabled ?? true,
      configJson: JSON.stringify({
        url: 'https://example.invalid/hook',
        secret: 'test-secret-123',
      }),
      consecutiveFailures: over?.consecutiveFailures ?? 0,
    })
    .run()
  return id
}

function testPayload(over?: Partial<ReminderPayload>): ReminderPayload {
  return {
    title: 'Test',
    body: 'body',
    url: 'http://localhost:7968/task/x',
    tag: 'reminder-x',
    task_id: 'x',
    reminder_id: 'x',
    fired_at: '2026-07-16T20:30:00.000Z',
    priority: 3,
    due: null,
    test: true,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  sendWebPushMock.mockResolvedValue('delivered')
  sendToChannelMock.mockResolvedValue('delivered')
})
afterEach(() => setReminderEventBus(null))

describe('buildReminderPayload', () => {
  it('renders a timed same-day due as "Due today at HH:mm" with the canonical deep link and tag', () => {
    const p = buildReminderPayload({
      task: {
        id: 't1',
        content: 'Renew passport',
        dueDate: '2026-07-16',
        dueTime: '17:00',
        priority: 1,
      },
      reminderId: 'r1',
      firedAt: '2026-07-16T20:30:00.000Z', // 16:30 EDT → today = 2026-07-16
      publicUrl: null,
      timezone: 'America/New_York',
      test: false,
    })
    expect(p).toEqual({
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
    })
  })

  it('labels a different day by date, honors publicUrl, and defaults test to false', () => {
    const p = buildReminderPayload({
      task: { id: 't2', content: 'Standup', dueDate: '2026-07-20', dueTime: '09:00', priority: 2 },
      reminderId: 'r2',
      firedAt: '2026-07-16T20:30:00.000Z',
      publicUrl: 'https://x.dev/',
      timezone: 'America/New_York',
    })
    expect(p.body).toBe('Due 2026-07-20 at 09:00')
    expect(p.url).toBe('https://x.dev/task/t2')
    expect(p.test).toBe(false)
  })

  it('renders an all-day due without a time and a dateless task as a bare "Reminder"', () => {
    const allDay = buildReminderPayload({
      task: { id: 't3', content: 'Pay rent', dueDate: '2026-07-16', dueTime: null, priority: 4 },
      reminderId: 'r3',
      firedAt: '2026-07-16T20:30:00.000Z',
      publicUrl: null,
      timezone: 'America/New_York',
    })
    expect(allDay.body).toBe('Due today')
    expect(allDay.due).toEqual({ date: '2026-07-16', time: null })

    const dateless = buildReminderPayload({
      task: { id: 't4', content: 'Someday', dueDate: null, dueTime: null, priority: 4 },
      reminderId: 'r4',
      firedAt: '2026-07-16T20:30:00.000Z',
      publicUrl: null,
      timezone: 'America/New_York',
    })
    expect(dateless.body).toBe('Reminder')
    expect(dateless.due).toBeNull()
  })
})

describe('dispatchReminder', () => {
  it('prunes a push subscription the endpoint reports as gone', async () => {
    const { db, close } = await makeTestDb()
    try {
      const { userId } = await seedUser(db)
      const { id: taskId } = await seedTask(db, userId, { dueDate: '2026-07-16', dueTime: '17:00' })
      const { id: reminderId } = await seedReminder(db, {
        userId,
        taskId,
        type: 'relative',
        minuteOffset: 0,
      })
      seedPushSub(db, userId, 'https://push.example/dead')
      sendWebPushMock.mockResolvedValue('gone')

      await dispatchReminder(db, reminderId)

      expect(sendWebPushMock).toHaveBeenCalledTimes(1)
      const remaining = db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId))
        .all()
      expect(remaining).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('updates last_used_at on a delivered push subscription', async () => {
    const { db, close } = await makeTestDb()
    try {
      const { userId } = await seedUser(db)
      const { id: taskId } = await seedTask(db, userId, { dueDate: '2026-07-16', dueTime: '17:00' })
      const { id: reminderId } = await seedReminder(db, {
        userId,
        taskId,
        type: 'relative',
        minuteOffset: 0,
      })
      const subId = seedPushSub(db, userId, 'https://push.example/live')
      sendWebPushMock.mockResolvedValue('delivered')

      await dispatchReminder(db, reminderId)

      const sub = db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, subId)).get()
      expect(sub?.lastUsedAt).not.toBeNull()
    } finally {
      close()
    }
  })

  it('auto-disables a webhook channel when its consecutive failures reach the threshold (9 → 10)', async () => {
    const { db, close } = await makeTestDb()
    try {
      const { userId } = await seedUser(db)
      const { id: taskId } = await seedTask(db, userId, { dueDate: '2026-07-16', dueTime: '17:00' })
      const { id: reminderId } = await seedReminder(db, {
        userId,
        taskId,
        type: 'relative',
        minuteOffset: 0,
      })
      const chId = seedWebhook(db, userId, { consecutiveFailures: 9 })
      sendToChannelMock.mockResolvedValue('error')

      await dispatchReminder(db, reminderId)

      const ch = db
        .select()
        .from(notificationChannels)
        .where(eq(notificationChannels.id, chId))
        .get()
      expect(ch?.consecutiveFailures).toBe(10)
      expect(ch?.enabled).toBe(false)
      expect(ch?.disabledReason).toBe(
        'Disabled automatically after 10 consecutive delivery failures',
      )
    } finally {
      close()
    }
  })

  it('does not disable a webhook below the threshold (8 → 9, still enabled)', async () => {
    const { db, close } = await makeTestDb()
    try {
      const { userId } = await seedUser(db)
      const { id: taskId } = await seedTask(db, userId, { dueDate: '2026-07-16', dueTime: '17:00' })
      const { id: reminderId } = await seedReminder(db, {
        userId,
        taskId,
        type: 'relative',
        minuteOffset: 0,
      })
      const chId = seedWebhook(db, userId, { consecutiveFailures: 8 })
      sendToChannelMock.mockResolvedValue('error')

      await dispatchReminder(db, reminderId)

      const ch = db
        .select()
        .from(notificationChannels)
        .where(eq(notificationChannels.id, chId))
        .get()
      expect(ch?.consecutiveFailures).toBe(9)
      expect(ch?.enabled).toBe(true)
      expect(ch?.disabledReason).toBeNull()
    } finally {
      close()
    }
  })

  it('resets the failure counter on a delivered channel', async () => {
    const { db, close } = await makeTestDb()
    try {
      const { userId } = await seedUser(db)
      const { id: taskId } = await seedTask(db, userId, { dueDate: '2026-07-16', dueTime: '17:00' })
      const { id: reminderId } = await seedReminder(db, {
        userId,
        taskId,
        type: 'relative',
        minuteOffset: 0,
      })
      const chId = seedWebhook(db, userId, { consecutiveFailures: 5 })
      sendToChannelMock.mockResolvedValue('delivered')

      await dispatchReminder(db, reminderId)

      const ch = db
        .select()
        .from(notificationChannels)
        .where(eq(notificationChannels.id, chId))
        .get()
      expect(ch?.consecutiveFailures).toBe(0)
    } finally {
      close()
    }
  })

  it('publishes a notification_channels SSE frame when a webhook auto-disables', async () => {
    const { db, close } = await makeTestDb()
    try {
      const bus = new EventBus()
      const seen: ServerEvent[] = []
      bus.subscribe((e) => seen.push(e))
      setReminderEventBus(bus)

      const { userId } = await seedUser(db)
      const { id: taskId } = await seedTask(db, userId, { dueDate: '2026-07-16', dueTime: '17:00' })
      const { id: reminderId } = await seedReminder(db, {
        userId,
        taskId,
        type: 'relative',
        minuteOffset: 0,
      })
      const chId = seedWebhook(db, userId, { consecutiveFailures: 9 })
      sendToChannelMock.mockResolvedValue('error')

      await dispatchReminder(db, reminderId)

      const evt = seen.find((e) => e.entity === 'notification_channels')
      expect(evt).toBeDefined()
      expect(evt?.ids).toEqual([chId])
      expect(evt?.userId).toBe(userId)
    } finally {
      close()
    }
  })

  it('sends nothing for a completed non-recurring task (already claimed, task done)', async () => {
    const { db, close } = await makeTestDb()
    try {
      const { userId } = await seedUser(db)
      const { id: taskId } = await seedTask(db, userId, {
        dueDate: '2026-07-16',
        dueTime: '17:00',
        completedAt: '2026-07-16T18:00:00.000Z',
      })
      const { id: reminderId } = await seedReminder(db, {
        userId,
        taskId,
        type: 'relative',
        minuteOffset: 0,
      })
      seedPushSub(db, userId, 'https://push.example/x')
      seedWebhook(db, userId)

      await dispatchReminder(db, reminderId)

      expect(sendWebPushMock).not.toHaveBeenCalled()
      expect(sendToChannelMock).not.toHaveBeenCalled()
    } finally {
      close()
    }
  })

  it('sends nothing for a soft-deleted task', async () => {
    const { db, close } = await makeTestDb()
    try {
      const { userId } = await seedUser(db)
      const { id: taskId } = await seedTask(db, userId, {
        dueDate: '2026-07-16',
        dueTime: '17:00',
        deletedAt: '2026-07-16T18:00:00.000Z',
      })
      const { id: reminderId } = await seedReminder(db, {
        userId,
        taskId,
        type: 'relative',
        minuteOffset: 0,
      })
      seedPushSub(db, userId, 'https://push.example/y')

      await dispatchReminder(db, reminderId)

      expect(sendWebPushMock).not.toHaveBeenCalled()
    } finally {
      close()
    }
  })

  it('ignores the vestigial settings.notifications toggles — sinks are gated per row, not per type', async () => {
    const { db, close } = await makeTestDb()
    try {
      const { userId } = await seedUser(db)
      // The phase-5 per-type toggles still live in the stored settings document (frozen core
      // schema). Turn every one of them off: delivery must be unaffected, because the phase-6
      // gates are the push-subscription row and the channel row's `enabled` flag (see fanOut).
      // If someone wires these toggles into dispatch, this test fails and forces the discussion:
      // with their ntfy/gotify/webhook defaults of `false` (and no phase-6 UI to change them),
      // such a gate would silently mute channels the user explicitly created and enabled.
      const row = db.select().from(userSettings).where(eq(userSettings.userId, userId)).get()
      const stored = UserSettingsSchema.parse(JSON.parse(row?.settings ?? '{}'))
      stored.notifications = { push: false, ntfy: false, gotify: false, webhook: false }
      db.update(userSettings)
        .set({ settings: JSON.stringify(stored) })
        .where(eq(userSettings.userId, userId))
        .run()

      const { id: taskId } = await seedTask(db, userId, { dueDate: '2026-07-16', dueTime: '17:00' })
      const { id: reminderId } = await seedReminder(db, {
        userId,
        taskId,
        type: 'relative',
        minuteOffset: 0,
      })
      seedPushSub(db, userId, 'https://push.example/toggles-off')
      const chId = seedWebhook(db, userId)

      await dispatchReminder(db, reminderId)

      expect(sendWebPushMock).toHaveBeenCalledTimes(1)
      expect(sendToChannelMock).toHaveBeenCalledTimes(1)
      expect(sendToChannelMock).toHaveBeenCalledWith(
        'webhook',
        expect.any(String),
        expect.objectContaining({ test: false }),
        expect.anything(),
      )
      // and the channel row itself stays healthy bookkeeping-wise
      const ch = db
        .select()
        .from(notificationChannels)
        .where(eq(notificationChannels.id, chId))
        .get()
      expect(ch?.consecutiveFailures).toBe(0)
    } finally {
      close()
    }
  })

  it('skips disabled channels', async () => {
    const { db, close } = await makeTestDb()
    try {
      const { userId } = await seedUser(db)
      const { id: taskId } = await seedTask(db, userId, { dueDate: '2026-07-16', dueTime: '17:00' })
      const { id: reminderId } = await seedReminder(db, {
        userId,
        taskId,
        type: 'relative',
        minuteOffset: 0,
      })
      seedWebhook(db, userId, { enabled: false })

      await dispatchReminder(db, reminderId)

      expect(sendToChannelMock).not.toHaveBeenCalled()
    } finally {
      close()
    }
  })
})

describe('dispatchTestPayload', () => {
  it('reports per-sink outcomes, prunes gone subscriptions, but never mutates channel counters', async () => {
    const { db, close } = await makeTestDb()
    try {
      const { userId } = await seedUser(db)
      seedPushSub(db, userId, 'https://push.example/a')
      seedPushSub(db, userId, 'https://push.example/b')
      const chId = seedWebhook(db, userId, { consecutiveFailures: 3, name: 'HA' })
      sendWebPushMock.mockResolvedValueOnce('delivered').mockResolvedValueOnce('gone')
      sendToChannelMock.mockResolvedValue('error')

      const result = await dispatchTestPayload(db, userId, testPayload())

      expect(result.push).toEqual({ sent: 1, gone: 1, errors: 0 })
      expect(result.channels).toEqual([{ id: chId, name: 'HA', outcome: 'error' }])
      // gone subscription pruned
      const subs = db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId))
        .all()
      expect(subs).toHaveLength(1)
      // channel counter untouched by a test fire
      const ch = db
        .select()
        .from(notificationChannels)
        .where(eq(notificationChannels.id, chId))
        .get()
      expect(ch?.consecutiveFailures).toBe(3)
      expect(ch?.enabled).toBe(true)
    } finally {
      close()
    }
  })
})
