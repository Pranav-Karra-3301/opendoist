/**
 * Inbox view — the inbox project's active tasks rendered as a collapsible tree,
 * plus an inline "+ Add task" affordance scoped to the inbox project.
 *
 * The task list receives the FULL set of active inbox-project tasks (parents AND
 * subtasks): `tree` mode calls `buildTaskTree`, which derives the top-level roots
 * and nests children from its own input, so pre-filtering with `topLevel` (as the
 * plan line literally writes) would strip every subtask out of the tree. This
 * mirrors Task L's `proj-root` tree list ("no-section tasks", not top-level).
 *
 * Task H: the view header carries the Display menu (`viewKey('inbox')`); when its
 * prefs deviate from defaults the tree rendering is replaced by the group/sort/filter
 * pipeline, and `showCompleted` appends the inbox's completed tasks.
 */
import { viewKey } from '@opendoist/core'
import { Inbox } from 'lucide-react'
import { useProjects } from '@/api/hooks/projects'
import { useActiveTasks } from '@/api/hooks/tasks'
import { EmptyState, ODErrorBoundary, TaskListSkeleton } from '@/components/feedback'
import { InlineAdd } from '@/components/quick-add/inline-add'
import { TaskList } from '@/components/task/task-list'
import { ViewHeader } from '@/components/view-header'
import { CompletedSection } from '@/features/display/CompletedSection'
import DisplayMenu, { GroupedTaskList, useFilterContext } from '@/features/display/DisplayMenu'
import { pipelineDeviates, pipelineGroups } from '@/features/display/pipeline'
import { useViewPrefs } from '@/features/display/useViewPrefs'
import { activeTasks, byChildOrder, tasksInProject } from '@/lib/derive'

const INBOX_KEY = viewKey('inbox')

export function InboxView() {
  const projectsQuery = useProjects()
  const tasksQuery = useActiveTasks()
  const { prefs } = useViewPrefs(INBOX_KEY)
  const ctx = useFilterContext()
  const loading = projectsQuery.isPending || tasksQuery.isPending

  const inbox = projectsQuery.data?.find((p) => p.is_inbox)
  const tasks =
    inbox && tasksQuery.data
      ? byChildOrder(tasksInProject(activeTasks(tasksQuery.data), inbox.id))
      : []
  const deviates = pipelineDeviates(prefs)

  return (
    <ODErrorBoundary label="Inbox">
      <div className="mx-auto max-w-[var(--content-max)] px-6 pb-24">
        <ViewHeader title="Inbox" actions={<DisplayMenu viewKey={INBOX_KEY} />} />
        {loading ? (
          <div aria-busy="true">
            <TaskListSkeleton rows={8} />
          </div>
        ) : (
          <>
            {deviates ? (
              <GroupedTaskList
                groups={pipelineGroups(tasks, prefs, ctx, ctx.projects)}
                emptyText="Your inbox is empty"
              />
            ) : tasks.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title="Your Inbox is clear"
                description="Capture anything with Q — sort it later."
              />
            ) : (
              <TaskList tasks={tasks} groupId="inbox" tree />
            )}
            {inbox && <InlineAdd defaults={{ project_id: inbox.id }} placement="bottom" />}
            {inbox && prefs.showCompleted && <CompletedSection projectId={inbox.id} />}
          </>
        )}
      </div>
    </ODErrorBoundary>
  )
}
