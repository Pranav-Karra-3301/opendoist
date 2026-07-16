/**
 * Pure helpers for the Notifications settings page (plan Task T).
 *
 * The user-settings PATCH shallow-merges at the TOP level of the document, so every channel
 * toggle must send the COMPLETE `NotificationToggles` object (mirrors Task P's sidebar patch); a
 * partial like `{ ntfy: true }` would drop the untouched toggles on the server round-trip. These
 * switches only persist intent for now — phase 6 (reminders) reads `settings.notifications` when
 * it wires the actual delivery paths and each channel's configuration.
 */
import type { NotificationToggles, UserSettingsPatch } from '@opendoist/core'

export type NotificationChannelKey = keyof NotificationToggles

export interface NotificationChannelDef {
  key: NotificationChannelKey
  title: string
  /** One-line summary shown under the channel title. */
  description: string
}

/**
 * The four reminder delivery channels, in card order (matches `NotificationTogglesSchema`'s key
 * order). Descriptions track the spec's channel interface (Web Push · ntfy · Gotify · webhook).
 */
export const NOTIFICATION_CHANNELS: readonly NotificationChannelDef[] = [
  {
    key: 'push',
    title: 'Push',
    description: 'Web Push to this browser or installed app — the default on desktop and Android.',
  },
  {
    key: 'ntfy',
    title: 'ntfy',
    description: 'Publish reminders to an ntfy topic. A dependable mobile fallback, iOS included.',
  },
  {
    key: 'gotify',
    title: 'Gotify',
    description: 'Deliver reminders to your self-hosted Gotify server and its connected apps.',
  },
  {
    key: 'webhook',
    title: 'Webhook',
    description: 'POST a signed JSON payload to your own endpoint whenever a reminder fires.',
  },
]

/**
 * Build a settings patch carrying the full notifications object with exactly one channel changed.
 * Non-mutating: `current` is spread, never edited in place.
 */
export function notificationsPatch(
  current: NotificationToggles,
  key: NotificationChannelKey,
  value: boolean,
): UserSettingsPatch {
  return { notifications: { ...current, [key]: value } }
}

/** Browser `Notification.permission` values (plus the safe fallback when the API is unavailable). */
export type BrowserPermission = 'granted' | 'denied' | 'default'

export interface PermissionBadge {
  label: string
  tone: BrowserPermission
}

/** Map the browser push-permission state to a display badge (informational only). */
export function permissionBadge(permission: string): PermissionBadge {
  switch (permission) {
    case 'granted':
      return { label: 'Allowed', tone: 'granted' }
    case 'denied':
      return { label: 'Blocked', tone: 'denied' }
    default:
      return { label: 'Not enabled', tone: 'default' }
  }
}

/**
 * Read the browser push-permission state, tolerating environments without the Notification API
 * (SSR / tests / older browsers) by falling back to `'default'`.
 */
export function readNotificationPermission(): BrowserPermission {
  if (typeof Notification === 'undefined') return 'default'
  const value = Notification.permission
  return value === 'granted' || value === 'denied' ? value : 'default'
}
