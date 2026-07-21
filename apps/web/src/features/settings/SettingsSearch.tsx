/**
 * Settings search + navigation list (Task L). Pinned atop the settings left-nav: a
 * "Search settings…" box that fuzzy-lite filters the registry pages by title + keywords
 * (case-insensitive substring), highlights the matched run inside each visible title, opens the
 * first match on Enter, and shows "No settings found" when nothing matches. The filtered list
 * doubles as the settings navigation — clicking a row (or pressing Enter) calls `onPick`.
 *
 * `matchSettingsPage` / `filterSettingsPages` / `splitHighlight` are pure and exported for the
 * co-located unit tests; the web vitest harness runs in a `node` environment, so the DOM-level
 * behaviour (filtering, Enter-navigates) is additionally covered by the Playwright e2e.
 */
import { Search } from 'lucide-react'
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { SettingsPageDef } from './registry'

/** Case-insensitive substring match against the page title OR any of its keywords. */
export function matchSettingsPage(page: SettingsPageDef, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  if (page.title.toLowerCase().includes(needle)) return true
  return page.keywords.some((keyword) => keyword.toLowerCase().includes(needle))
}

/** Registry pages whose title/keywords match `query`, preserving registry order. */
export function filterSettingsPages(
  pages: readonly SettingsPageDef[],
  query: string,
): SettingsPageDef[] {
  return pages.filter((page) => matchSettingsPage(page, query))
}

export interface HighlightSegment {
  text: string
  hit: boolean
  /** Start offset in the source string — a stable React key (never the array index). */
  start: number
}

/**
 * Split `text` into alternating plain / matched segments for the (case-insensitive) `query`.
 * Only the title text is highlighted, so a keyword-only match yields a single plain segment.
 */
export function splitHighlight(text: string, query: string): HighlightSegment[] {
  const needle = query.trim()
  if (needle === '') return [{ text, hit: false, start: 0 }]
  const haystack = text.toLowerCase()
  const lowerNeedle = needle.toLowerCase()
  const segments: HighlightSegment[] = []
  let cursor = 0
  while (cursor <= text.length) {
    const idx = haystack.indexOf(lowerNeedle, cursor)
    if (idx === -1) {
      if (cursor < text.length) {
        segments.push({ text: text.slice(cursor), hit: false, start: cursor })
      }
      break
    }
    if (idx > cursor) segments.push({ text: text.slice(cursor, idx), hit: false, start: cursor })
    segments.push({ text: text.slice(idx, idx + needle.length), hit: true, start: idx })
    cursor = idx + needle.length
  }
  return segments.length > 0 ? segments : [{ text, hit: false, start: 0 }]
}

export function SettingsSearch({
  pages,
  activeKey,
  onPick,
}: {
  pages: readonly SettingsPageDef[]
  activeKey: string
  onPick: (key: string) => void
}) {
  const [query, setQuery] = useState('')
  const matches = filterSettingsPages(pages, query)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="p-2">
        <div className="relative">
          <Search
            size={16}
            aria-hidden="true"
            className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 text-text-tertiary"
          />
          <Input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              const first = matches[0]
              if (event.key === 'Enter' && first) {
                event.preventDefault()
                onPick(first.key)
              }
            }}
            placeholder="Search settings…"
            aria-label="Search settings"
            className="pl-7"
          />
        </div>
      </div>
      <nav aria-label="Settings" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {matches.length === 0 ? (
          <p className="px-2 py-3 text-copy text-text-tertiary">No settings found</p>
        ) : (
          <ul className="flex flex-col gap-px">
            {matches.map((page) => {
              const isActive = page.key === activeKey
              const Icon = page.icon
              return (
                <li key={page.key}>
                  <button
                    type="button"
                    onClick={() => onPick(page.key)}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-body outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus-ring',
                      isActive
                        ? 'bg-selected font-medium text-selected-text'
                        : 'text-text-primary hover:bg-hover',
                    )}
                  >
                    <Icon
                      size={18}
                      strokeWidth={1.75}
                      aria-hidden="true"
                      className={cn('shrink-0', isActive ? 'text-accent' : 'text-text-secondary')}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {splitHighlight(page.title, query).map((segment) =>
                        segment.hit ? (
                          <mark
                            key={segment.start}
                            className="rounded-xs bg-accent-soft text-inherit"
                          >
                            {segment.text}
                          </mark>
                        ) : (
                          <span key={segment.start}>{segment.text}</span>
                        ),
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </nav>
    </div>
  )
}
