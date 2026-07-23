/**
 * One day in the Upcoming list: a sticky `Jul 18 ‧ Saturday` heading (today reads
 * `Jul 16 ‧ Today ‧ Wednesday`), a droppable body accepting cross-day drags, the day's
 * dated tasks, and a per-day quick-add scoped to that date. The whole section is a
 * dnd-kit droppable (`day-<date>`) so drops on empty space still land on the day; the
 * heading pins just below the week strip via the measured `--ot-strip-h` offset.
 */
import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { Task } from '@/api/schemas'
import { InlineComposer, type InlineComposerContext } from '@/components/quick-add/inline-composer'
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

/**
 * The per-day "+ Add task" row (Task H). List-anchored, so clicking it swaps the row for the
 * inline {@link InlineComposer} seeded with this day's due date (never the centered dialog);
 * `onClose` (Esc, Cancel, or blur while empty) restores the row. Mirrors the exported `AddTaskRow`
 * in the project view — kept local here to avoid a cross-view import.
 */
function AddTaskRow({ context }: { context: InlineComposerContext }) {
  const [open, setOpen] = useState(false)
  if (open) {
    return <InlineComposer context={context} onClose={() => setOpen(false)} />
  }
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="group flex h-9 w-full items-center gap-2 rounded-sm px-[5px] text-left text-body text-text-secondary transition-colors duration-150 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-focus-ring)]"
    >
      <Plus size={18} className="text-accent" aria-hidden />
      Add task
    </button>
  )
}

export function DaySection({ date, tasks, today, sortable = true }: DaySectionProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${date}` })
  const isToday = date === today

  return (
    <section
      ref={setNodeRef}
      id={`day-${date}`}
      aria-label={`${monthDayLabel(date)} ${weekdayLongLabel(date)}`}
      className="scroll-mt-[var(--ot-strip-h)] pt-3"
    >
      <h2 className="-mx-6 sticky top-[var(--ot-strip-h)] z-10 bg-bg px-6 py-1.5 font-medium text-copy">
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
          <TaskList
            tasks={tasks}
            groupId={`day-${date}`}
            sortable={sortable}
            hideDueChipWhen={date}
          />
        ) : (
          <p className="px-[5px] pt-1 text-caption text-text-tertiary">Nothing scheduled</p>
        )}
        <AddTaskRow context={{ dueDate: date }} />
      </div>
    </section>
  )
}
