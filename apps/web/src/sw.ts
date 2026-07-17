/// <reference lib="webworker" />
/**
 * OpenDoist service worker (phase 10, Task C).
 *
 * Built by vite-plugin-pwa in `injectManifest` mode (`vite.config.ts`) and emitted to
 * `/sw.js` at the same scope the hand-rolled phase-6 worker used — so activating this one
 * replaces `public/sw.js` (now deleted). It owns three concerns:
 *
 *   1. App-shell precache (`__WB_MANIFEST`) so the SPA opens offline.
 *   2. A NetworkFirst runtime cache of `GET /api/v1/*` reads, so the last-viewed lists
 *      still render when the connection drops (SSE / auth / docs excluded).
 *   3. Web Push delivery — the phase-6 `push` / `notificationclick` / `pushsubscriptionchange`
 *      handlers, moved here verbatim (the client still registers `/sw.js` and reads
 *      `navigator.serviceWorker.ready`, so no push API changed).
 *
 * Update model is prompt-based (`registerType: 'prompt'`): the worker does NOT auto-skip
 * waiting. `pwa/register.ts` (workbox-window) detects the waiting worker, shows the update
 * toast, and — only when the user accepts — posts `SKIP_WAITING`, which the message handler
 * below honours before `clientsClaim()` lets the fresh worker take over on reload.
 */
import { clientsClaim } from 'workbox-core'
import { ExpirationPlugin } from 'workbox-expiration'
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  type PrecacheEntry,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { NetworkFirst } from 'workbox-strategies'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<PrecacheEntry | string>
}

const ICON_URL = '/icons/icon-192.png'
const BADGE_URL = '/icons/badge-72.png'
const SUBSCRIBE_ENDPOINT = '/api/v1/push-subscriptions'

clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Prompt-based updates: apply a waiting worker only when the app asks (workbox-window's
// `messageSkipWaiting()` posts exactly this). The `controlling` event then reloads clients.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    void self.skipWaiting()
  }
})

// SPA navigations → precached index.html, EXCEPT API calls and the public iCal feed
// (`/ical/<token>/tasks.ics` is mounted at the app root, not under /api).
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/ical\//],
  }),
)

// Offline read of last-cached queries: GET /api/v1/* NetworkFirst. The SSE stream, the
// Swagger docs, and the OpenAPI document are never cached (they are not list reads).
registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    url.pathname.startsWith('/api/v1/') &&
    !url.pathname.startsWith('/api/v1/events') &&
    !url.pathname.startsWith('/api/v1/docs') &&
    !url.pathname.startsWith('/api/v1/openapi.json'),
  new NetworkFirst({
    cacheName: 'od-api',
    networkTimeoutSeconds: 4,
    plugins: [new ExpirationPlugin({ maxEntries: 128, maxAgeSeconds: 7 * 24 * 3600 })],
  }),
)

/* ---------- push delivery (moved verbatim from phase-6 public/sw.js) ---------- */

self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; tag?: string; url?: string } = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const title = data.title || 'OpenDoist reminder'
  // userVisibleOnly contract: a notification MUST be shown for every push, or the browser
  // shows its own "site updated in background" warning and may revoke the subscription.
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag,
      icon: ICON_URL,
      badge: BADGE_URL,
      data: { url: data.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url: string = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          void client.focus()
          return client.navigate ? client.navigate(url) : self.clients.openWindow(url)
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const options = event.oldSubscription ? event.oldSubscription.options : undefined
      if (!options) return
      const sub = await self.registration.pushManager.subscribe(options)
      const json = sub.toJSON()
      const keys = json.keys || {}
      await fetch(SUBSCRIBE_ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          keys: { p256dh: keys.p256dh, auth: keys.auth },
        }),
      })
    })(),
  )
})
