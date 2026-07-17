/**
 * Sticky week navigator for the Upcoming view: the month/year acts as the page title
 * (Todoist replaces the plain "Upcoming" header with the month), a `‹ Today ›` pager,
 * and a 7-cell week aligned to the user's week start. Cells before today are inert;
 * the anchored day wears the accent circle; days carrying tasks show a dot. Keyboard
 * paging (`shift+←/→`, `home`) is bound centrally by Task N against `useUpcomingStore`.
 */

import type { Weekday } from '@opendoist/core'
import { addDaysIso } from '@opendoist/core'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  dayOfMonth,
  fullDateLabel,
  monthYearLabel,
  startOfWeek,
  weekdayInitialLabel,
} from './use-upcoming-days'

export interface WeekStripProps {
  today: string
  anchor: string
  weekStart: Weekday
  datesWithTasks: ReadonlySet<string>
  onSelectDay: (date: string) => void
  onPrevWeek: () => void
  onNextWeek: () => void
  onToday: () => void
  /** Toolbar slot rendered left of the pager — Upcoming's Display menu (Task H). */
  actions?: ReactNode
}

export function WeekStrip({
  today,
  anchor,
  weekStart,
  datesWithTasks,
  onSelectDay,
  onPrevWeek,
  onNextWeek,
  onToday,
  actions,
}: WeekStripProps) {
  const weekStartDate = startOfWeek(anchor, weekStart)
  const cells = Array.from({ length: 7 }, (_, i) => addDaysIso(weekStartDate, i))

  return (
    <div className="pt-6 pb-2">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h1 className="truncate font-strong text-header text-text-primary">
          {monthYearLabel(anchor)}
        </h1>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          <Button variant="ghost" size="sm" onClick={onToday}>
            Today
          </Button>
          <Button variant="ghost" size="icon" aria-label="Previous week" onClick={onPrevWeek}>
            <ChevronLeft size={18} />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Next week" onClick={onNextWeek}>
            <ChevronRight size={18} />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((date) => {
          const isPast = date < today
          const isToday = date === today
          const isSelected = date === anchor
          const hasTasks = datesWithTasks.has(date)
          return (
            <button
              key={date}
              type="button"
              disabled={isPast}
              aria-label={fullDateLabel(date)}
              aria-current={isSelected ? 'date' : undefined}
              onClick={() => onSelectDay(date)}
              className={cn(
                'flex flex-col items-center gap-1 rounded-sm py-1.5 transition-colors duration-150 ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]',
                isPast ? 'cursor-default opacity-40' : 'cursor-pointer hover:bg-hover',
              )}
            >
              <span className="text-caption text-text-tertiary">{weekdayInitialLabel(date)}</span>
              <span
                className={cn(
                  'flex size-7 items-center justify-center rounded-full text-copy',
                  isSelected
                    ? 'bg-accent font-medium text-on-accent'
                    : isToday
                      ? 'font-medium text-accent'
                      : 'text-text-primary',
                )}
              >
                {dayOfMonth(date)}
              </span>
              <span
                aria-hidden
                className={cn(
                  'size-1 rounded-full',
                  hasTasks && !isSelected ? 'bg-text-tertiary' : 'bg-transparent',
                )}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
