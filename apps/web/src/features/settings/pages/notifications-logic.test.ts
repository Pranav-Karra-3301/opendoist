import { DEFAULT_USER_SETTINGS } from '@opendoist/core'
import { describe, expect, it } from 'vitest'
import {
  NOTIFICATION_CHANNELS,
  notificationsPatch,
  permissionBadge,
  readNotificationPermission,
} from './notifications-logic'

const BASE = DEFAULT_USER_SETTINGS.notifications

describe('notificationsPatch', () => {
  it('toggling ntfy patches the FULL notifications object with ntfy on', () => {
    const patch = notificationsPatch(BASE, 'ntfy', true)
    expect(Object.keys(patch)).toEqual(['notifications'])
    expect(patch.notifications).toEqual({
      push: true,
      ntfy: true,
      gotify: false,
      webhook: false,
    })
  })

  it('changes only the targeted channel and preserves other prior (non-default) values', () => {
    const current: typeof BASE = { ...BASE, push: false, gotify: true }
    const patch = notificationsPatch(current, 'webhook', true)
    expect(patch.notifications).toEqual({ ...current, webhook: true })
    expect(patch.notifications?.push).toBe(false)
    expect(patch.notifications?.gotify).toBe(true)
  })

  it('can turn a channel off as well as on', () => {
    expect(notificationsPatch(BASE, 'push', false).notifications?.push).toBe(false)
  })

  it('does not mutate the input object', () => {
    const current = { ...BASE }
    notificationsPatch(current, 'push', false)
    expect(current).toEqual(BASE)
  })
})

describe('NOTIFICATION_CHANNELS', () => {
  it('covers exactly the four channels in NotificationToggles key order', () => {
    expect(NOTIFICATION_CHANNELS.map((c) => c.key)).toEqual(['push', 'ntfy', 'gotify', 'webhook'])
  })

  it('gives every channel a title and a one-line description', () => {
    for (const channel of NOTIFICATION_CHANNELS) {
      expect(channel.title.length).toBeGreaterThan(0)
      expect(channel.description.length).toBeGreaterThan(0)
    }
  })
})

describe('permissionBadge', () => {
  it('maps granted/denied to allowed/blocked tones', () => {
    expect(permissionBadge('granted')).toEqual({ label: 'Allowed', tone: 'granted' })
    expect(permissionBadge('denied')).toEqual({ label: 'Blocked', tone: 'denied' })
  })

  it('treats the browser "default" (and any unknown value) as not-enabled', () => {
    expect(permissionBadge('default')).toEqual({ label: 'Not enabled', tone: 'default' })
    expect(permissionBadge('prompt')).toEqual({ label: 'Not enabled', tone: 'default' })
  })
})

describe('readNotificationPermission', () => {
  it('falls back to "default" when the Notification API is unavailable (node/SSR)', () => {
    expect(readNotificationPermission()).toBe('default')
  })
})
