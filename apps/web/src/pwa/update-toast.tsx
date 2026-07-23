/**
 * Update-available toast (phase 10, Task C). Shown when workbox-window reports a waiting
 * service worker (a new build is precached and ready). The app's toast store only carries
 * transient auto-dismissing info/error messages with no action, so — per the plan's fallback
 * — this is a bespoke `role="status"` card with a Reload action, positioned by `PwaProvider`
 * in the shared bottom-right stack. Reload applies the update (skip-waiting + reload).
 */
import { RefreshCw, X } from 'lucide-react'

export function UpdateToast({
  onReload,
  onDismiss,
}: {
  onReload: () => void
  onDismiss: () => void
}) {
  return (
    <div
      role="status"
      className="pointer-events-auto flex min-w-[280px] max-w-[420px] items-center gap-2.5 rounded-lg bg-surface-overlay py-2.5 pr-2 pl-3.5 text-white [box-shadow:var(--shadow-toast)]"
    >
      <RefreshCw size={16} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 flex-1 text-copy">A new version of OpenTask is available</span>
      <button
        type="button"
        onClick={onReload}
        className="shrink-0 cursor-pointer rounded-sm bg-white/15 px-2 py-1 font-medium text-copy text-white transition-colors duration-150 hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-focus-ring)]"
      >
        Reload
      </button>
      <button
        type="button"
        aria-label="Dismiss update notification"
        onClick={onDismiss}
        className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-white/70 transition-colors duration-150 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-focus-ring)]"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
