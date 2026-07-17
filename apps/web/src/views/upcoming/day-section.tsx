/**
 * One day in the Upcoming list: a sticky `Jul 18 ‧ Saturday` heading (today reads
 * `Jul 16 ‧ Today ‧ Wednesday`), a droppable body accepting cross-day drags, the day's
 * dated tasks, and a per-day quick-add scoped to that date. The whole section is a
 * dnd-kit droppable (`day-<date>`) so drops on empty space still land on the day; the
 * heading pins just below the week strip via the measured `--od-strip-h` offset.
 */
import type { Task } from '@/api/schemas'
import { InlineAdd } from '@/components/quick-add/inline-add'
import { TaskList } from '@/components/task/task-list'
import { useDroppable } from '@/lib/dnd'
import { cn } from '@/lib/utils'
import { monthDayLabel, weekdayLongLabel } from './use-upcoming-days'

export interface DaySectionProps {
  date: string
  tasks: Task[]
  today: string
  /** false while Display prefs deviate (sorted/filtered) — disables per-day drag reorder. */
  sortable?: boolean
}

export function DaySection({ date, tasks, today, sortable = true }: DaySectionProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${date}` })
  const isToday = date === today

  return (
    <section
      ref={setNodeRef}
      id={`day-${date}`}
      aria-label={`${monthDayLabel(date)} ${weekdayLongLabel(date)}`}
      className="scroll-mt-[var(--od-strip-h)] pt-3"
    >
      <h2 className="-mx-6 sticky top-[var(--od-strip-h)] z-10 bg-bg px-6 py-1.5 font-medium text-copy">
        <span className="text-text-primary">{monthDayLabel(date)}</span>
        {isToday && (
          <>
            <span className="text-text-tertiary"> ‧ </span>
            <span className="text-accent">Today</span>
          </>
        )}
        <span className="text-text-tertiary"> ‧ </span>
        <span className="text-text-secondary">{weekdayLongLabel(date)}</span>
      </h2>
      <div className={cn('min-h-2 rounded-lg transition-colors', isOver && 'bg-accent-soft')}>
        {tasks.length > 0 ? (
          <TaskList tasks={tasks} groupId={`day-${date}`} sortable={sortable} />
        ) : (
          <p className="px-[5px] pt-1 text-caption text-text-tertiary">Nothing scheduled</p>
        )}
        <InlineAdd
          defaults={{ due: { date, time: null, string: date, recurrence: null } }}
          placement="bottom"
        />
      </div>
    </section>
  )
}
