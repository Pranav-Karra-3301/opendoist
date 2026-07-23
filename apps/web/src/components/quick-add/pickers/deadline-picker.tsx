/**
 * DeadlinePicker (quick-add UX pass, plan Task F). A month calendar + an optional wall-clock time
 * that compose the single `{…}` deadline token in the Quick Add input — the text stays the single
 * source of truth (dossier §2.2: a deadline is a hard cutoff of date + OPTIONAL time, the owner's
 * deliberate divergence from Todoist's date-only deadlines, 2026-07-18).
 *
 * The time field is a draft applied when a day is picked: set the time (optional), then click a
 * day to write `{YYYY-MM-DD}` (or `{YYYY-MM-DD HH:mm}`) and close. Re-clicking the highlighted day
 * re-applies an edited time. The NL row reminds the user the same phrase (`{next friday 5pm}`)
 * works typed straight into the task. Both writes route through the parent's `commit`, so the
 * picker never keeps parallel deadline state.
 */
import type { Deadline, QuickAddToken, Weekday } from '@opentask/core'
import { X } from 'lucide-react'
import { type ReactElement, useState } from 'react'
import { MonthCalendar } from '@/components/ui/month-calendar'
import { formatDueChip } from '@/lib/format-date'
import { replaceRange, stripRange } from '../quick-add-model'

export interface DeadlinePickerProps {
  text: string
  activeTokens: QuickAddToken[]
  /** the current parsed deadline (seeds the calendar highlight + time draft); null = none */
  deadline: Deadline | null
  /** today in the user's timezone (ISO) — for the current-deadline chip label */
  today: string
  /** ISO weekday the calendar's first column shows */
  weekStart: Weekday
  /** replace the whole input text (caret to end) — the single source of truth */
  commit: (next: string) => void
  /** close the popover */
  close: () => void
}

/** ISO date (+ optional HH:mm) → the `{…}` phrase the parser resolves back to this deadline. */
export function deadlineBrace(date: string, time: string | null): string {
  return time === null ? `{${date}}` : `{${date} ${time}}`
}

/** Insert or replace the single `{…}` deadline token; append when none exists yet. */
export function upsertDeadline(
  text: string,
  tokens: readonly QuickAddToken[],
  brace: string,
): string {
  const token = tokens.find((t) => t.kind === 'deadline')
  if (token) return replaceRange(text, token.start, token.end, brace)
  const head = text.replace(/\s+$/, '')
  return head === '' ? brace : `${head} ${brace}`
}

/** Remove the `{…}` deadline token (tidy the seam); no-op when none exists. */
export function clearDeadline(text: string, tokens: readonly QuickAddToken[]): string {
  const token = tokens.find((t) => t.kind === 'deadline')
  return token ? stripRange(text, token.start, token.end) : text
}

export function DeadlinePicker({
  text,
  activeTokens,
  deadline,
  today,
  weekStart,
  commit,
  close,
}: DeadlinePickerProps): ReactElement {
  // Draft time, seeded from the current deadline; applied when a day is picked. Not a competing
  // source of truth — nothing is stored until a calendar pick writes the `{…}` token.
  const [time, setTime] = useState(deadline?.time ?? '')

  const pickDay = (date: string): void => {
    commit(upsertDeadline(text, activeTokens, deadlineBrace(date, time === '' ? null : time)))
    close()
  }
  const clear = (): void => {
    commit(clearDeadline(text, activeTokens))
    close()
  }

  const chip = deadline ? formatDueChip({ date: deadline.date, time: deadline.time }, today) : null

  return (
    <div data-slot="deadline-picker" className="flex flex-col gap-2">
      <div className="flex h-6 items-center justify-between px-1">
        <span className="font-medium text-caption text-text-secondary">Deadline</span>
        {chip && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear deadline"
            className="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-caption text-text-tertiary transition-colors duration-150 hover:bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ot-focus-ring)]"
          >
            <span style={{ color: 'var(--ot-date-overdue)' }}>{chip.label}</span>
            <X size={12} aria-hidden />
          </button>
        )}
      </div>

      <label className="flex items-center gap-2 px-1 text-caption text-text-secondary">
        <span className="shrink-0">Time</span>
        <input
          type="time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
          aria-label="Deadline time (optional)"
          className="h-7 flex-1 rounded-sm border border-input-border bg-surface-raised px-2 text-copy text-text-primary outline-none transition-colors duration-150 focus:border-input-border-focus"
        />
      </label>

      <MonthCalendar value={deadline?.date ?? null} onPick={pickDay} weekStart={weekStart} />

      <p className="px-1 text-caption text-text-tertiary">
        or type a phrase — <code className="text-text-secondary">{'{next friday 5pm}'}</code> in the
        task works too
      </p>
    </div>
  )
}
