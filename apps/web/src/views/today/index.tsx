/**
 * Today view — the day's plan. An Overdue block (with bulk Reschedule) sits above a
 * dated section listing everything due today, plus an inline add scoped to today.
 *
 * All data comes from the single `useActiveTasks()` cache, sliced client-side with
 * `lib/derive`; `today` is the user's calendar date derived from their server-side
 * timezone via `useParseCtx()`. Content-column wrapper + skeleton conventions mirror
 * the Inbox view.
 *
 * Task H: the header carries the Display menu (`viewKey('today')`). The Overdue block
 * always stays on top; when prefs deviate from defaults the today list is replaced by
 * the group/sort/filter pipeline (dossier §1.8: group-by applies within the day block),
 * and `showCompleted` appends recently completed tasks.
 */
import { dateInTz, viewKey } from '@opendoist/core'
import { Sun } from 'lucide-react'
import { useActiveTasks } from '@/api/hooks/tasks'
import { EmptyState, ODErrorBoundary, TaskListSkeleton } from '@/components/feedback'
import { InlineAdd } from '@/components/quick-add/inline-add'
import { TaskList } from '@/components/task/task-list'
import { ViewHeader } from '@/components/view-header'
import { CompletedSection } from '@/features/display/CompletedSection'
import DisplayMenu, { GroupedTaskList, useFilterContext } from '@/features/display/DisplayMenu'
import { pipelineDeviates, pipelineGroups } from '@/features/display/pipeline'
import { useViewPrefs } from '@/features/display/useViewPrefs'
import { activeTasks, byDayOrder, dueOn, overdue } from '@/lib/derive'
import { useParseCtx } from '@/lib/parse-context'
import { OverdueBlock } from './overdue-block'

const TODAY_KEY = viewKey('today')
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
  const filterCtx = useFilterContext()
  const { prefs } = useViewPrefs(TODAY_KEY)
  const today = dateInTz(ctx.now, ctx.timezone)
  const tasksQuery = useActiveTasks()

  const active = tasksQuery.data ? activeTasks(tasksQuery.data) : []
  const overdueTasks = overdue(active, today)
  const todayTasks = byDayOrder(dueOn(active, today))
  const count = overdueTasks.length + todayTasks.length
  const deviates = pipelineDeviates(prefs)

  return (
    <ODErrorBoundary label="Today">
      <div className="mx-auto max-w-[var(--content-max)] px-6 pb-24">
        <ViewHeader
          title="Today"
          subtitle={tasksQuery.isPending ? undefined : `${count} ${count === 1 ? 'task' : 'tasks'}`}
          actions={<DisplayMenu viewKey={TODAY_KEY} />}
        />
        {tasksQuery.isPending ? (
          <div aria-busy="true">
            <TaskListSkeleton rows={8} />
          </div>
        ) : (
          <>
            <OverdueBlock tasks={active} />
            <section aria-label="Today">
              <h2 className="border-border-subtle border-b py-2 font-medium text-copy text-text-primary">
                {formatTodayLine(today)}
              </h2>
              {deviates ? (
                <GroupedTaskList
                  groups={pipelineGroups(todayTasks, prefs, filterCtx, filterCtx.projects)}
                  showProject
                  emptyText="No tasks due today."
                />
              ) : todayTasks.length === 0 ? (
                <EmptyState
                  icon={Sun}
                  title="No tasks today"
                  description="Enjoy the calm, or press Q to plan something."
                />
              ) : (
                <TaskList tasks={todayTasks} groupId="today" showProject />
              )}
              <InlineAdd
                defaults={{ due: { date: today, time: null, string: today, recurrence: null } }}
                placement="bottom"
              />
            </section>
            {prefs.showCompleted && <CompletedSection />}
          </>
        )}
      </div>
    </ODErrorBoundary>
  )
}
