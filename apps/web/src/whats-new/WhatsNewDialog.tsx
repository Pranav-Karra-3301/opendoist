/**
 * What's New — the changelog surface shared by the account-menu footer and the
 * About settings page.
 *
 * - `WhatsNewDialog` renders the featured entry (for `version`, else the newest)
 *   first, followed by the full history, all inside a scroll area.
 * - `useWhatsNew` is the module-global open/close store so any trigger (footer
 *   button, About page button) drives the single dialog mounted by the provider.
 * - `WhatsNewProvider` owns the auto-show-once-per-version logic and mounts the
 *   dialog. It is mounted once, from the account-menu component.
 */
import { ExternalLink } from 'lucide-react'
import { useEffect } from 'react'
import { create } from 'zustand'
import { useInfo } from '@/api/hooks/info'
import { buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { type ChangelogEntry, changelogEntries, selectChangelogEntry } from './changelog'

const RELEASES_URL = 'https://github.com/pranav-karra-3301/opendoist/releases'
const SEEN_VERSION_KEY = 'od-seen-version'

interface WhatsNewStore {
  open: boolean
  show: () => void
  close: () => void
}

/** Global open/close state for the single What's New dialog. */
export const useWhatsNew = create<WhatsNewStore>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}))

/** Featured entry first, then the remaining history in document order. */
function orderedEntries(version: string | undefined): ChangelogEntry[] {
  const focus = selectChangelogEntry(changelogEntries, version)
  if (focus === null) return []
  return [focus, ...changelogEntries.filter((e) => e !== focus)]
}

function entryHeading(entry: ChangelogEntry): string {
  return entry.version === 'Unreleased' ? 'Unreleased' : `v${entry.version}`
}

/**
 * The changelog dialog. Controlled via `open` / `onClose`; `version` selects the
 * featured entry (falls back to the newest entry when unknown or undefined).
 */
export function WhatsNewDialog({
  open,
  onClose,
  version,
}: {
  open: boolean
  onClose: () => void
  version?: string
}) {
  const entries = orderedEntries(version)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>What's New in OpenDoist</DialogTitle>
        </DialogHeader>

        {entries.length === 0 ? (
          <p className="text-copy text-text-secondary">No changelog is available yet.</p>
        ) : (
          <ScrollArea className="-mr-2 max-h-[min(60vh,32rem)] pr-2">
            <div className="flex flex-col gap-6">
              {entries.map((entry, index) => (
                <article
                  key={entry.version}
                  className={cn(index > 0 && 'border-border-subtle border-t pt-6')}
                >
                  <div className="mb-3 flex items-baseline gap-2">
                    <h3 className="font-medium text-subtitle text-text-primary">
                      {entryHeading(entry)}
                    </h3>
                    {entry.date !== null && (
                      <span className="text-caption text-text-tertiary">{entry.date}</span>
                    )}
                  </div>
                  {entry.sections.length === 0 ? (
                    <p className="text-copy text-text-tertiary">No notes for this release.</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {entry.sections.map((section) => (
                        <section key={section.title}>
                          <h4 className="mb-1 font-medium text-caption text-text-secondary uppercase tracking-wide">
                            {section.title}
                          </h4>
                          <ul className="flex flex-col gap-1">
                            {section.items.map((item) => (
                              <li
                                key={item}
                                className="flex gap-2 text-copy text-text-primary before:text-text-tertiary before:content-['•']"
                              >
                                <span className="min-w-0">{item}</span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </ScrollArea>
        )}

        <DialogFooter className="items-center justify-between">
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noreferrer noopener"
            className={cn(buttonVariants({ variant: 'link', size: 'sm' }), 'px-0')}
          >
            All releases
            <ExternalLink size={14} aria-hidden="true" />
          </a>
          <DialogClose className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
            Close
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function readSeenVersion(): string | null | undefined {
  try {
    return localStorage.getItem(SEEN_VERSION_KEY)
  } catch {
    // storage unavailable (private mode / disabled) — cannot track, skip auto-show
    return undefined
  }
}

function writeSeenVersion(version: string): void {
  try {
    localStorage.setItem(SEEN_VERSION_KEY, version)
  } catch {
    // storage unavailable — nothing to persist
  }
}

/**
 * Mounts the single What's New dialog and runs the auto-show logic: on first run
 * the current version is recorded silently (no dialog); when the stored version
 * differs from the running version the dialog is shown exactly once, then the new
 * version is recorded. Mount once, from the account-menu component.
 */
export function WhatsNewProvider() {
  const { data: info } = useInfo()
  const version = info?.version
  const open = useWhatsNew((s) => s.open)
  const show = useWhatsNew((s) => s.show)
  const close = useWhatsNew((s) => s.close)

  useEffect(() => {
    if (version === undefined) return
    const seen = readSeenVersion()
    if (seen === undefined) return // storage unavailable
    if (seen === null) {
      writeSeenVersion(version) // first run: remember silently
      return
    }
    if (seen !== version) {
      writeSeenVersion(version)
      show()
    }
  }, [version, show])

  return <WhatsNewDialog open={open} onClose={close} version={version} />
}
