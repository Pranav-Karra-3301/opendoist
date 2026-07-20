/**
 * Scheduler surface (Task F; month calendar added by Task E). `SchedulerPanel` is the
 * uncontained content reused by the row popover, the multi-select toolbar, and Today's
 * Reschedule action (frozen export — Tasks J and H import it). It only reports the chosen
 * due through `onPick`; the caller owns the mutation(s) and decides whether to dismiss the
 * container.
 *
 * A day picked in the embedded `MonthCalendar` keeps whatever wall-clock time is currently in
 * play — the free-text box's parsed time if one is typed, else (when the box is empty) the
 * `current` due's time — so scheduling a new day never silently drops an existing due time.
 */
import {
  type Due,
  dateInTz,
  isoWeekday,
  type ParseContext,
  parseQuickAdd,
  resolveNaturalDate,
} from '@opendoist/core'
import { CalendarClock, CalendarDays, CalendarRange, CalendarX2, Sun } from 'lucide-react'
import { type ComponentType, type ReactElement, useEffect, useMemo, useRef, useState } from 'react'
import { MonthCalendar } from '@/components/ui/month-calendar'
import { DUE_TONE_VAR, formatDueChip } from '@/lib/format-date'
import { useParseCtx } from '@/lib/parse-context'

export interface SchedulerPanelProps {
  /** Chosen due (null clears the date). Caller performs the update and closes the surface. */
  onPick: (due: Due | null) => void
  /** The task's existing due, when the surface schedules a single task — seeds the calendar
   *  highlight and supplies the time preserved by a calendar-day pick. Optional/additive. */
  current?: Due | null
}

/** Re-parseable canonical string for a calendar-picked due (ISO date, optional wall time). */
function isoDueString(date: string, time: string | null): string {
  return time === null ? date : `${date} ${time}`
}

const SHORT_DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** Resolve a canonical preset phrase into a concrete due (parser is the source of truth). */
function presetDue(phrase: string, ctx: ParseContext): Due | null {
  const resolved = resolveNaturalDate(phrase, ctx)
  return resolved === null
    ? null
    : { date: resolved.date, time: resolved.time, string: phrase, recurrence: null }
}

/** Parse the free-text box: recurrence phrases go through the full Quick Add parser. */
function parseInput(text: string, ctx: ParseContext): Due | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (/^every\b/i.test(trimmed)) return parseQuickAdd(trimmed, ctx).due
  const resolved = resolveNaturalDate(trimmed, ctx)
  return resolved === null
    ? null
    : { date: resolved.date, time: resolved.time, string: trimmed, recurrence: null }
}

interface PresetRow {
  key: string
  label: string
  icon: ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>
  due: Due | null
}

export function SchedulerPanel({ onPick, current }: SchedulerPanelProps): ReactElement {
  const ctx = useParseCtx()
  const [text, setText] = useState('')
  const today = dateInTz(ctx.now, ctx.timezone)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const presets = useMemo<PresetRow[]>(
    () => [
      { key: 'today', label: 'Today', icon: CalendarDays, due: presetDue('today', ctx) },
      { key: 'tomorrow', label: 'Tomorrow', icon: Sun, due: presetDue('tomorrow', ctx) },
      {
        key: 'nextweek',
        label: 'Next week',
        icon: CalendarClock,
        due: presetDue('next week', ctx),
      },
      {
        key: 'weekend',
        label: 'Next weekend',
        icon: CalendarRange,
        due: presetDue('weekend', ctx),
      },
    ],
    [ctx],
  )

  const preview = parseInput(text, ctx)
  const previewChip = preview
    ? formatDueChip({ date: preview.date, time: preview.time }, today)
    : null

  // A day picked in the calendar is date-only; it keeps whatever wall-clock time is in play — the
  // free-text box's parsed time when one is typed, else the existing due's time — so scheduling a
  // new day never silently drops a due time. `current` also seeds the highlighted day.
  const timeInPlay = preview?.time ?? current?.time ?? null
  const pickDay = (date: string): void => {
    onPick({ date, time: timeInPlay, string: isoDueString(date, timeInPlay), recurrence: null })
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && preview) {
            event.preventDefault()
            onPick(preview)
          }
        }}
        placeholder="Type a date…"
        aria-label="Due date"
        className="h-8 w-full rounded-sm border border-input-border bg-surface-raised px-2 text-body text-text-primary outline-none transition-colors duration-150 ease-standard placeholder:text-text-tertiary focus:border-input-border-focus"
      />
      {text.trim() !== '' && (
        <div className="px-1 text-caption" role="status" aria-live="polite">
          {previewChip ? (
            <span style={{ color: `var(${DUE_TONE_VAR[previewChip.tone]})` }}>
              {previewChip.label}
              {preview?.recurrence != null ? ' · repeats' : ''}
            </span>
          ) : (
            <span className="text-text-tertiary">No date recognized</span>
          )}
        </div>
      )}
      <div className="flex flex-col">
        {presets.map(({ key, label, icon: Icon, due }) => (
          <button
            key={key}
            type="button"
            onClick={() => onPick(due)}
            className="flex h-8 items-center gap-2.5 rounded-sm px-2 text-copy text-text-primary transition-colors duration-150 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
          >
            <Icon size={16} className="shrink-0 text-text-secondary" aria-hidden />
            <span>{label}</span>
            {due && (
              <span className="ml-auto text-caption text-text-tertiary">
                {SHORT_DOW[isoWeekday(due.date) - 1]}
              </span>
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPick(null)}
          className="flex h-8 items-center gap-2.5 rounded-sm px-2 text-copy text-text-primary transition-colors duration-150 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
        >
          <CalendarX2 size={16} className="shrink-0 text-text-secondary" aria-hidden />
          <span>No date</span>
        </button>
      </div>
      <div className="border-border-subtle border-t pt-2">
        <MonthCalendar value={current?.date ?? null} onPick={pickDay} weekStart={ctx.weekStart} />
      </div>
    </div>
  )
}
