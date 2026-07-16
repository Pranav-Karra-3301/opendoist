/**
 * The `?` shortcut overlay. Mounted once by `<GlobalHotkeys/>`; opens via the `?` key or the
 * topbar help button (both flip ui-store `shortcutOverlayOpen`). Lists every SHORTCUTS entry
 * grouped, two columns: description … <kbd> caps rendered per platform.
 */
import type { ReactElement } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useUiStore } from '@/stores/ui'
import { GROUP_ORDER, SHORTCUTS } from './map'

const IS_MAC =
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent)

/** Tokens in a `display` string rendered as plain separators rather than <kbd> caps. */
const SEPARATORS: ReadonlySet<string> = new Set(['or', 'then', '–'])

function KeyCaps({ display }: { display: string }): ReactElement {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {display.split(' ').map((token) =>
        SEPARATORS.has(token) ? (
          <span key={token} className="text-caption text-text-tertiary">
            {token}
          </span>
        ) : (
          <kbd
            key={token}
            className="inline-flex min-w-[20px] items-center justify-center rounded-xs border border-border bg-surface px-1 py-0.5 font-mono text-caption text-text-secondary"
          >
            {token === 'Mod' ? (IS_MAC ? '⌘' : 'Ctrl') : token}
          </kbd>
        ),
      )}
    </span>
  )
}

export function ShortcutOverlay(): ReactElement {
  const open = useUiStore((s) => s.shortcutOverlayOpen)
  const setOpen = useUiStore((s) => s.setShortcutOverlayOpen)
  return (
    <Dialog open={open} onOpenChange={(next) => setOpen(next)}>
      <DialogContent className="grid max-h-[80vh] w-[640px] max-w-[92vw] gap-4 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="grid gap-6">
          {GROUP_ORDER.map((group) => {
            const items = SHORTCUTS.filter((s) => s.group === group)
            if (items.length === 0) return null
            return (
              <section key={group}>
                <h3 className="mb-1 font-medium text-caption text-text-tertiary uppercase tracking-wide">
                  {group}
                </h3>
                <ul className="grid">
                  {items.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-4 rounded-sm px-2 py-1.5 text-copy text-text-primary"
                    >
                      <span>{s.desc}</span>
                      <KeyCaps display={s.display} />
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
