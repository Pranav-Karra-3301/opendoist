/**
 * Service-worker registration (phase 10, Task C) — the single registration path for
 * `/sw.js`, using workbox-window so the update lifecycle is observable.
 *
 * The worker is prompt-based (`registerType: 'prompt'`): a freshly-installed worker sits in
 * `waiting` until the user accepts. `registerSW` reports that via `onNeedRefresh` (the update
 * toast), and the returned `update()` applies it — it posts `SKIP_WAITING` to the waiting
 * worker and reloads once the new worker takes control. The `controlling` listener is wired
 * only inside `update()`, so the first-install `controlling` event (from the worker's
 * `clientsClaim()`) never triggers a spurious reload.
 *
 * No-ops in dev: `devOptions.enabled` is false, so vite-plugin-pwa emits no worker there.
 */
import { Workbox } from 'workbox-window'

export interface SWRegistration {
  /** Apply the waiting worker: skip-waiting, then reload when it takes control. */
  update: () => void
}

const NOOP: SWRegistration = { update: () => {} }

export function registerSW(onNeedRefresh: () => void): SWRegistration {
  if (import.meta.env.DEV || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return NOOP
  }

  const wb = new Workbox('/sw.js', { scope: '/' })
  wb.addEventListener('waiting', () => onNeedRefresh())
  void wb.register()

  let reloading = false
  return {
    update: () => {
      wb.addEventListener('controlling', () => {
        if (reloading) return
        reloading = true
        window.location.reload()
      })
      wb.messageSkipWaiting()
    },
  }
}
