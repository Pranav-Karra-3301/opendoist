/**
 * Today view — the day's plan. An Overdue block (with bulk Reschedule) sits above a
 * dated section listing everything due today, plus an inline add scoped to today.
 *
 * All data comes from the single `useActiveTasks()` cache, sliced client-side with
 * `lib/derive`; `today` is the user's calendar date derived from their server-side
 * timezone via `useParseCtx()`. Content-column wrapper + skeleton conventions mirror
 * the Inbox view.
 */
import { dateInTz } from '@opendoist/core'
import { useActiveTasks } from '@/api/hooks/tasks'
import { InlineAdd } from '@/components/quick-add/inline-add'
import { TaskList } from '@/components/task/task-list'
import { Skeleton } from '@/components/ui/skeleton'
import { ViewHeader } from '@/components/view-header'
import { activeTasks, byDayOrder, dueOn, overdue } from '@/lib/derive'
import { useParseCtx } from '@/lib/parse-context'
import { OverdueBlock } from './overdue-block'

const SKELETON_ROWS = ['a', 'b', 'c']
const MONTH_ABBREV = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]
/** indexed by `Date.getUTCDay()` (0 = Sunday … 6 = Saturday) */
const WEEKDAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** e.g. "Jul 16 · Today · Wednesday" */
function formatTodayLine(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const month = MONTH_ABBREV[d.getUTCMonth()] ?? ''
  const weekday = WEEKDAY_FULL[d.getUTCDay()] ?? ''
  return `${month} ${d.getUTCDate()} · Today · ${weekday}`
}

export function TodayView() {
  const ctx = useParseCtx()
  const today = dateInTz(ctx.now, ctx.timezone)
  const tasksQuery = useActiveTasks()

  const active = tasksQuery.data ? activeTasks(tasksQuery.data) : []
  const overdueTasks = overdue(active, today)
  const todayTasks = byDayOrder(dueOn(active, today))
  const count = overdueTasks.length + todayTasks.length

  return (
    <div className="mx-auto max-w-[var(--content-max)] px-6 pb-24">
      <ViewHeader
        title="Today"
        subtitle={tasksQuery.isPending ? undefined : `${count} ${count === 1 ? 'task' : 'tasks'}`}
      />
      {tasksQuery.isPending ? (
        <div className="flex flex-col gap-1">
          {SKELETON_ROWS.map((key) => (
            <Skeleton key={key} className="h-[42px] w-full" />
          ))}
        </div>
      ) : (
        <>
          <OverdueBlock tasks={active} />
          <section aria-label="Today">
            <h2 className="border-border-subtle border-b py-2 font-medium text-copy text-text-primary">
              {formatTodayLine(today)}
            </h2>
            <TaskList
              tasks={todayTasks}
              groupId="today"
              showProject
              emptyText="No tasks due today."
            />
            <InlineAdd
              defaults={{ due: { date: today, time: null, string: today, recurrence: null } }}
              placement="bottom"
            />
          </section>
        </>
      )}
    </div>
  )
}
