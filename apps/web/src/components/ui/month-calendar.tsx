/**
 * MonthCalendar (quick-add UX pass, Task E — replaces the Task A stub wholesale).
 *
 * A self-contained month grid built on core `dates.ts` helpers only (no new date deps): a
 * header with prev / next / go-to-current-month controls, a weekday header honoring
 * `weekStart`, and a fixed 6-row (42-cell) aria-grid. The current day carries a ring, the
 * selected `value` an accent fill, and days before `min` render disabled. Keyboard support
 * follows the APG grid pattern — arrows move by day/week, Home/End jump to the week edges,
 * PageUp/PageDown page months, and Enter/Space pick — with a roving tabindex so the grid is a
 * single tab stop.
 *
 * Props are FROZEN by Task A (`value`, `onPick`, `weekStart`, `min`); this component gets no
 * `now`/timezone, so "today" is the viewer's local calendar date (correct for the single-user
 * self-hosted app; the ring is a convenience, never authoritative state).
 */
import type { Weekday } from '@opentask/core'
import { addDaysIso, isoWeekday, lastDayOfMonth } from '@opentask/core'
import { CalendarCheck, ChevronLeft, ChevronRight } from 'lucide-react'
import { type ReactElement, useEffect, useId, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export interface MonthCalendarProps {
  /** selected ISO date (YYYY-MM-DD); null = nothing selected */
  value: string | null
  /** called with the picked ISO date (YYYY-MM-DD) */
  onPick: (date: string) => void
  /** ISO weekday the grid's first column shows (1 = Monday … 7 = Sunday) */
  weekStart: Weekday
  /** ISO date; days before it render disabled */
  min?: string
}

const pad = (n: number) => String(n).padStart(2, '0')

/** ISO weekday (1 = Mon … 7 = Sun) → short/full labels for the weekday header. */
const WEEKDAY_ABBR: Record<Weekday, string> = {
  1: 'Mo',
  2: 'Tu',
  3: 'We',
  4: 'Th',
  5: 'Fr',
  6: 'Sa',
  7: 'Su',
}
const WEEKDAY_FULL: Record<Weekday, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
}

/** First-of-month ISO (YYYY-MM-01) for any ISO date. */
function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`
}

/** Shift a first-of-month ISO by `n` whole months (n may be negative). */
function shiftMonthFirst(firstIso: string, n: number): string {
  const y = Number(firstIso.slice(0, 4))
  const m = Number(firstIso.slice(5, 7))
  const total = m - 1 + n
  const ny = y + Math.floor(total / 12)
  const nm = ((total % 12) + 12) % 12
  return `${ny}-${pad(nm + 1)}-01`
}

/** Viewer-local calendar date (see file header on why this is not tz-aware). */
function localToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** `2026-07-01` → `July 2026` (fixed en-US, UTC to avoid an off-by-one from the local zone). */
function monthTitle(firstIso: string): string {
  return new Date(`${firstIso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** `2026-07-15` → `Wednesday, July 15, 2026` for a day cell's accessible name. */
function fullDateLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** The 42 day-cell ISO dates for a month view (leading days from the previous month included). */
function gridDays(viewMonth: string, weekStart: Weekday): string[] {
  const lead = (isoWeekday(viewMonth) - weekStart + 7) % 7
  const start = addDaysIso(viewMonth, -lead)
  return Array.from({ length: 42 }, (_, i) => addDaysIso(start, i))
}

export function MonthCalendar({ value, onPick, weekStart, min }: MonthCalendarProps): ReactElement {
  const today = localToday()
  const seed = value ?? min ?? today
  const [viewMonth, setViewMonth] = useState(() => firstOfMonth(seed))
  const [focusedDate, setFocusedDate] = useState(() => value ?? today)
  const gridRef = useRef<HTMLDivElement>(null)
  const focusPending = useRef(false)
  const titleId = useId()

  // Move DOM focus onto the roving cell only after a keyboard/control-driven move — never on
  // mount or an unrelated re-render (which would steal focus from the panel's text input).
  useEffect(() => {
    if (!focusPending.current) return
    focusPending.current = false
    gridRef.current?.querySelector<HTMLButtonElement>(`button[data-date="${focusedDate}"]`)?.focus()
  }, [focusedDate])

  const days = gridDays(viewMonth, weekStart)
  const headerDays: Weekday[] = Array.from(
    { length: 7 },
    (_, i) => (((weekStart - 1 + i) % 7) + 1) as Weekday,
  )
  const isDisabled = (date: string) => min !== undefined && date < min

  /** Move the roving focus to `next`, paging the view if it fell outside the visible window. */
  function focusTo(next: string): void {
    // Re-seed the view when `next` falls outside the visible 6-week window (`days` is always 42
    // cells, so the undefined guards only satisfy noUncheckedIndexedAccess).
    const first = days[0]
    const last = days[days.length - 1]
    if (first === undefined || last === undefined || next < first || next > last) {
      setViewMonth(firstOfMonth(next))
    }
    focusPending.current = true
    setFocusedDate(next)
  }

  function pageMonths(n: number): void {
    const targetFirst = shiftMonthFirst(firstOfMonth(focusedDate), n)
    const ty = Number(targetFirst.slice(0, 4))
    const tm = Number(targetFirst.slice(5, 7))
    const day = Math.min(Number(focusedDate.slice(8, 10)), lastDayOfMonth(ty, tm))
    setViewMonth(targetFirst)
    focusPending.current = true
    setFocusedDate(`${targetFirst.slice(0, 7)}-${pad(day)}`)
  }

  function onGridKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const offsetInWeek = (isoWeekday(focusedDate) - weekStart + 7) % 7
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault()
        focusTo(addDaysIso(focusedDate, -1))
        break
      case 'ArrowRight':
        event.preventDefault()
        focusTo(addDaysIso(focusedDate, 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        focusTo(addDaysIso(focusedDate, -7))
        break
      case 'ArrowDown':
        event.preventDefault()
        focusTo(addDaysIso(focusedDate, 7))
        break
      case 'Home':
        event.preventDefault()
        focusTo(addDaysIso(focusedDate, -offsetInWeek))
        break
      case 'End':
        event.preventDefault()
        focusTo(addDaysIso(focusedDate, 6 - offsetInWeek))
        break
      case 'PageUp':
        event.preventDefault()
        pageMonths(-1)
        break
      case 'PageDown':
        event.preventDefault()
        pageMonths(1)
        break
      // Enter/Space are left to the focused day <button>'s native activation (onClick).
    }
  }

  function goToCurrentMonth(): void {
    setViewMonth(firstOfMonth(today))
    focusPending.current = true
    setFocusedDate(today)
  }

  return (
    <div data-slot="month-calendar" data-week-start={weekStart} className="flex flex-col">
      <div className="mb-1 flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setViewMonth(shiftMonthFirst(viewMonth, -1))}
          className="flex size-7 items-center justify-center rounded-sm text-text-secondary transition-colors duration-150 hover:bg-hover hover:text-text-primary focus-visible:bg-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ot-focus-ring)]"
        >
          <ChevronLeft size={18} aria-hidden />
        </button>
        <span
          id={titleId}
          data-testid="month-title"
          className="flex-1 text-center font-medium text-copy text-text-primary"
        >
          {monthTitle(viewMonth)}
        </span>
        <button
          type="button"
          aria-label="Go to current month"
          onClick={goToCurrentMonth}
          className="flex size-7 items-center justify-center rounded-sm text-text-secondary transition-colors duration-150 hover:bg-hover hover:text-text-primary focus-visible:bg-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ot-focus-ring)]"
        >
          <CalendarCheck size={16} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setViewMonth(shiftMonthFirst(viewMonth, 1))}
          className="flex size-7 items-center justify-center rounded-sm text-text-secondary transition-colors duration-150 hover:bg-hover hover:text-text-primary focus-visible:bg-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ot-focus-ring)]"
        >
          <ChevronRight size={18} aria-hidden />
        </button>
      </div>

      {/* biome-ignore lint/a11y/useSemanticElements: an ARIA grid of <div>s is the APG date-picker pattern; a <table> would fight the CSS grid layout. */}
      <div
        ref={gridRef}
        role="grid"
        aria-labelledby={titleId}
        onKeyDown={onGridKeyDown}
        className="flex flex-col gap-0.5"
      >
        {/* biome-ignore lint/a11y/useSemanticElements: APG grid pattern (div-based; a <table> would fight the CSS grid). */}
        {/* biome-ignore lint/a11y/useFocusableInteractive: grid rows are structural ARIA; the roving-tabindex day <button>s are the focusable widgets. */}
        <div role="row" className="grid grid-cols-7">
          {headerDays.map((wd) => (
            // biome-ignore lint/a11y/useSemanticElements: APG grid pattern (div-based; a <table> would fight the CSS grid).
            // biome-ignore lint/a11y/useFocusableInteractive: column headers are structural ARIA, not focusable widgets.
            <span
              key={wd}
              role="columnheader"
              aria-label={WEEKDAY_FULL[wd]}
              className="flex h-6 items-center justify-center text-caption text-text-tertiary"
            >
              {WEEKDAY_ABBR[wd]}
            </span>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, week) => days.slice(week * 7, week * 7 + 7)).map((row) => (
          // biome-ignore lint/a11y/useSemanticElements: APG grid pattern (div-based; a <table> would fight the CSS grid).
          // biome-ignore lint/a11y/useFocusableInteractive: grid rows are structural ARIA; the roving-tabindex day <button>s are the focusable widgets.
          <div key={row[0]} role="row" className="grid grid-cols-7">
            {row.map((date) => {
              const inMonth = date.slice(0, 7) === viewMonth.slice(0, 7)
              const selected = value !== null && date === value
              const isToday = date === today
              const disabled = isDisabled(date)
              return (
                // biome-ignore lint/a11y/useSemanticElements: APG grid pattern (div-based; a <table> would fight the CSS grid).
                // biome-ignore lint/a11y/useFocusableInteractive: the gridcell is structural ARIA; its day <button> is the focusable widget.
                <div key={date} role="gridcell" aria-selected={selected || undefined}>
                  <button
                    type="button"
                    data-date={date}
                    tabIndex={date === focusedDate ? 0 : -1}
                    aria-label={fullDateLabel(date)}
                    aria-current={isToday ? 'date' : undefined}
                    aria-disabled={disabled || undefined}
                    onClick={() => {
                      if (disabled) return
                      focusPending.current = false
                      setFocusedDate(date)
                      onPick(date)
                    }}
                    className={cn(
                      'flex h-8 w-full items-center justify-center rounded-sm text-copy transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ot-focus-ring)]',
                      disabled && 'cursor-not-allowed text-text-tertiary opacity-40',
                      !disabled &&
                        selected &&
                        'bg-accent font-medium text-on-accent hover:bg-accent-hover',
                      !disabled &&
                        !selected &&
                        isToday &&
                        'font-medium text-accent ring-1 ring-accent ring-inset hover:bg-hover',
                      !disabled &&
                        !selected &&
                        !isToday &&
                        `${inMonth ? 'text-text-primary' : 'text-text-tertiary'} hover:bg-hover`,
                    )}
                  >
                    {Number(date.slice(8, 10))}
                  </button>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
