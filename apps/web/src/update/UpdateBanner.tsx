/**
 * Slim "an update is available" banner (phase 9 Task O). Mounted above the app in main.tsx.
 *
 * Reads GET /api/v1/info (`['info']` query). The server's daily update-check job sets
 * `info.update` = `{ available, latestVersion, url } | null`; `InfoSchema` is `.passthrough()`,
 * so that field is untyped here — parse it locally like AboutPage. Renders nothing unless an
 * update is available and the user has not dismissed this specific version.
 */
import { ExternalLink, X } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { useInfo } from '@/api/hooks/info'

const DISMISS_KEY = 'od-dismissed-update'

const UpdateInfoSchema = z
  .object({ available: z.boolean(), latestVersion: z.string(), url: z.string() })
  .nullable()

export function UpdateBanner() {
  const { data: info } = useInfo()
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY)
    } catch {
      // localStorage unavailable (private mode) — treat as not-dismissed.
      return null
    }
  })

  const parsed = UpdateInfoSchema.safeParse(info?.update)
  const update = parsed.success ? parsed.data : null
  if (!update?.available || dismissedVersion === update.latestVersion) return null

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, update.latestVersion)
    } catch {
      // best-effort: still hide for this session even if the write fails.
    }
    setDismissedVersion(update.latestVersion)
  }

  return (
    <div
      role="status"
      className="relative flex items-center justify-center border-border border-b bg-accent-soft px-9 py-1.5 text-copy text-text-primary"
    >
      <span>
        OpenDoist v{update.latestVersion} is available —{' '}
        <a
          href={update.url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 font-medium text-accent underline-offset-4 hover:underline"
        >
          Release notes
          <ExternalLink size={13} aria-hidden="true" />
        </a>
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss update notification"
        className="-translate-y-1/2 absolute top-1/2 right-2 inline-flex size-5 cursor-pointer items-center justify-center rounded-sm text-text-secondary hover:bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
