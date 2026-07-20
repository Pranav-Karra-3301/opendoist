/**
 * DurationMenu (quick-add UX pass, plan Task F). Inserts or replaces the `for X` duration token
 * that follows a TIMED due in the Quick Add input (the text is the single source of truth). A
 * duration only attaches to a due that carries a wall-clock time (dossier §2.3), so with no timed
 * due the menu shows a hint instead of presets. Presets plus a custom-minutes field; the footer
 * teaches `for 45min`.
 */
import type { Due, QuickAddToken } from '@opendoist/core'
import { type ReactElement, useState } from 'react'
import { cn } from '@/lib/utils'
import { replaceRange } from '../quick-add-model'

export interface DurationMenuProps {
  text: string
  activeTokens: QuickAddToken[]
  durationMin: number | null
  /** the parsed due — a duration only attaches to a due with a wall-clock time */
  due: Due | null
  commit: (next: string) => void
  close: () => void
}

/** minutes → the canonical `for …` phrase (`for 45min`, `for 1h`, `for 1h 30m`). */
export function durationPhrase(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `for ${mins}min`
  if (mins === 0) return `for ${hours}h`
  return `for ${hours}h ${mins}m`
}

/**
 * Replace an existing duration token, or insert `for …` immediately after the due token (where the
 * parser attaches it). Returns the text unchanged when there is no due to attach to.
 */
export function upsertDuration(
  text: string,
  tokens: readonly QuickAddToken[],
  phrase: string,
): string {
  const duration = tokens.find((token) => token.kind === 'duration')
  if (duration) return replaceRange(text, duration.start, duration.end, phrase)
  const due = tokens.find((token) => token.kind === 'due')
  if (due === undefined) return text
  return `${text.slice(0, due.end)} ${phrase}${text.slice(due.end)}`
}

const PRESETS: { label: string; minutes: number }[] = [
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '45 min', minutes: 45 },
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
]

export function DurationMenu({
  text,
  activeTokens,
  durationMin,
  due,
  commit,
  close,
}: DurationMenuProps): ReactElement {
  const [custom, setCustom] = useState('')
  const hasDueTime = due?.time != null

  const apply = (minutes: number): void => {
    commit(upsertDuration(text, activeTokens, durationPhrase(minutes)))
    close()
  }
  const applyCustom = (): void => {
    const minutes = Number(custom)
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return
    apply(minutes)
  }

  if (!hasDueTime) {
    return (
      <div data-slot="duration-menu" className="flex flex-col gap-1">
        <span className="px-1 font-medium text-caption text-text-secondary">Duration</span>
        <p className="px-1 text-copy text-text-tertiary">
          Add a due time first (e.g. <span className="text-text-secondary">3pm</span>), then set how
          long it takes.
        </p>
        <p className="px-1 pt-1 text-caption text-text-tertiary">
          Syntax: <code className="text-text-secondary">for 45min</code>
        </p>
      </div>
    )
  }

  return (
    <div data-slot="duration-menu" className="flex flex-col">
      {PRESETS.map(({ label, minutes }) => (
        <button
          key={minutes}
          type="button"
          onClick={() => apply(minutes)}
          className={cn(
            'flex h-8 items-center rounded-sm px-2 text-left text-copy text-text-primary transition-colors duration-150 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none',
            durationMin === minutes && 'font-medium text-accent',
          )}
        >
          {label}
        </button>
      ))}
      <div className="mt-1 flex items-center gap-2 border-border-subtle border-t px-1 pt-2">
        <input
          type="number"
          min={1}
          max={1440}
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              applyCustom()
            }
          }}
          placeholder="Custom min"
          aria-label="Custom duration in minutes"
          className="h-7 w-24 rounded-sm border border-input-border bg-surface-raised px-2 text-copy text-text-primary outline-none transition-colors duration-150 focus:border-input-border-focus"
        />
        <button
          type="button"
          disabled={custom === ''}
          onClick={applyCustom}
          className="inline-flex h-7 shrink-0 items-center rounded-sm bg-accent px-2 font-medium text-caption text-on-accent transition-colors duration-150 hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-accent-disabled"
        >
          Set
        </button>
      </div>
      <p className="px-1 pt-2 text-caption text-text-tertiary">
        Syntax: <code className="text-text-secondary">for 45min</code>
      </p>
    </div>
  )
}
