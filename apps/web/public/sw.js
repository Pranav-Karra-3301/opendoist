/**
 * OpenDoist service worker — push delivery only (phase 6, Task K).
 *
 * Hand-rolled, no Workbox: phases 4-5 ship no PWA/precache layer (deferred to phase 10,
 * which migrates these three handlers verbatim into its Workbox `src/sw.ts` and deletes
 * this file). Registered once from `initPushOnBoot()` in `src/push/index.tsx`.
 *
 * Served verbatim from `/sw.js` — Vite copies `public/` without transforming it, so this
 * stays plain ES that every push-capable browser runs as a classic worker script.
 */

const ICON_URL = '/icons/icon-192.png'
const BADGE_URL = '/icons/badge-72.png'
const SUBSCRIBE_ENDPOINT = '/api/v1/push-subscriptions'

// Activate immediately so the very first subscription can deliver without a reload.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
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
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          client.focus()
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
