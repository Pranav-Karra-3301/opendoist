/**
 * Web Push client (phase 6, Task K) — replaces the Task A stub.
 *
 * Owns the whole browser side of reminders-over-push: registering the `/sw.js` worker,
 * the double-opt-in permission flow (pre-prompt dialog → native prompt → VAPID subscribe →
 * upsert to the server), boot-time re-sync, and the iOS "install to Home Screen" guide.
 * The two dialogs are presentational (`PermissionPreprompt`, `IosInstallScreen`); this
 * module hosts them from `PushPrompts` and drives them through a tiny Zustand store, the
 * same UI-state pattern the rest of the app uses.
 *
 * Export surface is frozen by Task A Step 7 — do not add/remove named exports.
 */
import { useState } from 'react'
import { z } from 'zod'
import { create } from 'zustand'
import { api, apiVoid } from '@/api/client'
import { toast } from '@/stores/toasts'
import { IosInstallScreen } from './IosInstallScreen'
import { PermissionPreprompt } from './PermissionPreprompt'
import type { PushState } from './types'

const SW_URL = '/sw.js'
const VAPID_KEY_PATH = '/push/vapid-public-key'
const SUBSCRIPTIONS_PATH = '/push-subscriptions'
/** localStorage key holding the epoch-ms until which the pre-prompt stays snoozed. */
const SNOOZE_KEY = 'od-push-preprompt-snooze-until'
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000

const VapidKeyResponse = z.object({ public_key: z.string().min(1) })
const SubscriptionListResponse = z.object({
  results: z.array(z.object({ id: z.string(), endpoint: z.string() })),
})

/* ---------- capability detection ---------- */

function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  )
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPadOS 13+ reports as desktop Safari, so fall back to a touch-capable "Mac" check.
  const iPadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return /iPad|iPhone|iPod/.test(ua) || iPadOs
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const displayMode = window.matchMedia('(display-mode: standalone)').matches
  const iosStandalone =
    'standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true
  return displayMode || iosStandalone
}

/** Standard VAPID base64url → Uint8Array for `applicationServerKey`. Returns a
 *  fresh-`ArrayBuffer`-backed view so it satisfies `BufferSource` (TS 5.7+ narrows the
 *  generic and rejects the `ArrayBufferLike` default here). */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i)
  }
  return output
}

/* ---------- subscription plumbing ---------- */

async function ensureRegistration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register(SW_URL)
  return navigator.serviceWorker.ready
}

async function fetchVapidPublicKey(): Promise<string> {
  const res = await api(VAPID_KEY_PATH, { schema: VapidKeyResponse })
  return res.public_key
}

/** Upsert the current subscription to the server (POST is upsert-on-endpoint, Task E). */
async function syncSubscription(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON()
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (p256dh === undefined || auth === undefined) return
  await apiVoid(SUBSCRIPTIONS_PATH, {
    method: 'POST',
    body: {
      endpoint: subscription.endpoint,
      keys: { p256dh, auth },
      user_agent: navigator.userAgent,
    },
  })
}

export async function getPushState(): Promise<PushState> {
  const supported = pushSupported()
  const state: PushState = {
    supported,
    permission: supported ? Notification.permission : 'default',
    subscribed: false,
    ios: isIos(),
    standalone: isStandalone(),
  }
  if (!supported) return state
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    const subscription = (await registration?.pushManager.getSubscription()) ?? null
    state.subscribed = subscription !== null
  } catch {
    state.subscribed = false
  }
  return state
}

export async function subscribeToPush(): Promise<void> {
  if (!pushSupported()) {
    throw new Error('This browser does not support push notifications.')
  }
  // MUST be the first async call in the tap's task — iOS silently ignores a permission
  // request that is not synchronous with the user gesture.
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notifications are blocked. Enable them in your browser settings for this site.'
        : 'Notification permission was dismissed.',
    )
  }
  const registration = await ensureRegistration()
  const existing = await registration.pushManager.getSubscription()
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(await fetchVapidPublicKey()),
    }))
  await syncSubscription(subscription)
}

export async function unsubscribeFromPush(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return
  const { endpoint } = subscription
  await subscription.unsubscribe()
  try {
    const list = await api(SUBSCRIPTIONS_PATH, { schema: SubscriptionListResponse })
    const row = list.results.find((r) => r.endpoint === endpoint)
    if (row !== undefined) await apiVoid(`${SUBSCRIPTIONS_PATH}/${row.id}`, { method: 'DELETE' })
  } catch {
    // Local unsubscribe already succeeded; the stale server row lapses on its next 410.
  }
}

export function initPushOnBoot(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  void (async () => {
    try {
      const registration = await navigator.serviceWorker.register(SW_URL)
      // Re-sync only when already permitted (dossier §5.1.6): browsers rotate endpoints
      // and `pushsubscriptionchange` support is spotty, so upsert the live subscription.
      if (!pushSupported() || Notification.permission !== 'granted') return
      await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) await syncSubscription(subscription)
    } catch {
      // Push is best-effort on boot and must never block app start.
    }
  })()
}

/* ---------- pre-prompt orchestration ---------- */

type PromptKind = 'none' | 'preprompt' | 'ios'

interface PushPromptStore {
  open: PromptKind
  show: (kind: Exclude<PromptKind, 'none'>) => void
  close: () => void
}

const usePushPromptStore = create<PushPromptStore>((set) => ({
  open: 'none',
  show: (kind) => set({ open: kind }),
  close: () => set({ open: 'none' }),
}))

function isSnoozed(): boolean {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY)
    if (raw === null) return false
    const until = Number(raw)
    return Number.isFinite(until) && until > Date.now()
  } catch {
    return false
  }
}

function snooze(): void {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS))
  } catch {
    // Storage unavailable (private mode) — the prompt simply reappears next time.
  }
}

/**
 * The spec's "first-reminder moment": nudge the user toward notifications, but only when
 * it can actually help. No-ops when snoozed, already granted/denied/subscribed, or the
 * platform can't do push at all. iOS-in-a-tab is a special case — push is impossible until
 * the app is installed, so we surface the install guide instead of the native prompt.
 */
export function maybeShowReminderPermissionPrompt(): void {
  if (isSnoozed()) return
  void (async () => {
    const state = await getPushState()
    if (state.ios && !state.standalone) {
      usePushPromptStore.getState().show('ios')
      return
    }
    if (!state.supported) return
    if (state.permission === 'granted' || state.permission === 'denied') return
    if (state.subscribed) return
    usePushPromptStore.getState().show('preprompt')
  })()
}

export function PushPrompts() {
  const open = usePushPromptStore((s) => s.open)
  const close = usePushPromptStore((s) => s.close)
  const [busy, setBusy] = useState(false)

  // Kept synchronous up to `Notification.requestPermission()` inside `subscribeToPush` so
  // the native prompt stays inside the click's task (iOS requirement).
  const enable = (): void => {
    setBusy(true)
    subscribeToPush()
      .then(() => {
        toast.info('Notifications enabled on this device.')
        close()
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : 'Could not enable notifications.')
      })
      .finally(() => setBusy(false))
  }

  const dismiss = (): void => {
    snooze()
    close()
  }

  return (
    <>
      <PermissionPreprompt
        open={open === 'preprompt'}
        busy={busy}
        onEnable={enable}
        onDismiss={dismiss}
      />
      <IosInstallScreen open={open === 'ios'} onClose={dismiss} />
    </>
  )
}
