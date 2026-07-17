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
            // A real <table> per group (caption = category) so screen readers announce the
            // shortcut list as structured data: each row is a description (row header) + its keys.
            return (
              <table key={group} className="w-full border-collapse">
                <caption className="mb-1 text-left font-medium text-caption text-text-tertiary uppercase tracking-wide">
                  {group}
                </caption>
                <tbody>
                  {items.map((s) => (
                    <tr key={s.id} className="align-middle">
                      <th
                        scope="row"
                        className="rounded-sm py-1.5 pr-4 text-left font-normal text-copy text-text-primary"
                      >
                        {s.desc}
                      </th>
                      <td className="py-1.5 text-right">
                        <div className="flex justify-end">
                          <KeyCaps display={s.display} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
