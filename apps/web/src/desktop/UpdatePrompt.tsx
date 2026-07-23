/**
 * Desktop-only "update installed — restart to update" banner.
 *
 * The Rust self-update loop (`src-tauri/src/updater.rs`) downloads and installs updates
 * silently; the new version takes over at the next launch. When an install lands it emits
 * `opentask://update-installed` with the version — this component listens for that event
 * and offers the quit-and-relaunch that actually applies it (plugin-process `relaunch()`),
 * mirroring the server `UpdateBanner`'s visual language. "Later" just hides the banner:
 * the update still applies whenever the app next starts.
 *
 * Renders nothing on the web (no Tauri), and loads no Tauri code there — both the event
 * and process plugins come in via dynamic imports, mirroring `api/transport.ts`.
 */
import { RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { isTauri } from '@/api/transport'

const UPDATE_EVENT = 'opentask://update-installed'

export function DesktopUpdatePrompt() {
  const [version, setVersion] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    let unlisten: (() => void) | null = null
    void import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<string>(UPDATE_EVENT, (event) => {
          setVersion(event.payload)
          setDismissed(false)
        }),
      )
      .then((fn) => {
        if (disposed) fn()
        else unlisten = fn
      })
      .catch(() => {
        // Non-Tauri test env or missing plugin — the banner simply never shows.
      })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  if (version === null || dismissed) return null

  const restart = () => {
    setRestarting(true)
    void import('@tauri-apps/plugin-process')
      .then(({ relaunch }) => relaunch())
      .catch(() => {
        // Relaunch failed (should not happen) — stay actionable instead of wedging.
        setRestarting(false)
      })
  }

  return (
    <div
      role="status"
      className="relative flex items-center justify-center gap-3 border-border border-b bg-accent-soft px-9 py-1.5 text-copy text-text-primary"
    >
      <span>OpenTask {version} is ready</span>
      <button
        type="button"
        onClick={restart}
        disabled={restarting}
        className="inline-flex cursor-pointer items-center gap-1 font-medium text-accent underline-offset-4 hover:underline disabled:cursor-default disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-focus-ring)]"
      >
        <RefreshCw
          size={13}
          aria-hidden="true"
          className={restarting ? 'animate-spin' : undefined}
        />
        {restarting ? 'Restarting…' : 'Restart to update'}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss update prompt"
        className="-translate-y-1/2 absolute top-1/2 right-2 inline-flex size-5 cursor-pointer items-center justify-center rounded-sm text-text-secondary hover:bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-focus-ring)]"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
