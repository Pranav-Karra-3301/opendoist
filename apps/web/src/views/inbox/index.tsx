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
import { Inbox, Plus } from 'lucide-react'
import { useState } from 'react'
import { useProjects } from '@/api/hooks/projects'
import { useActiveTasks } from '@/api/hooks/tasks'
import { EmptyState, ODErrorBoundary, TaskListSkeleton } from '@/components/feedback'
import { InlineComposer, type InlineComposerContext } from '@/components/quick-add/inline-composer'
import { TaskList } from '@/components/task/task-list'
import { ViewHeader } from '@/components/view-header'
import { BoardView, groupBoardColumns, inboxBoardColumns } from '@/features/board/BoardView'
import { CompletedSection } from '@/features/display/CompletedSection'
import DisplayMenu, { GroupedTaskList, useFilterContext } from '@/features/display/DisplayMenu'
import { pipelineDeviates, pipelineGroups } from '@/features/display/pipeline'
import { useViewPrefs } from '@/features/display/useViewPrefs'
import { activeTasks, byChildOrder, tasksInProject } from '@/lib/derive'

const INBOX_KEY = viewKey('inbox')

/**
 * The in-list "+ Add task" row (Task H). List-anchored, so clicking it swaps the row for the
 * inline {@link InlineComposer} seeded with this row's context (never the centered dialog);
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
      className="group flex h-9 w-full items-center gap-2 rounded-sm px-[5px] text-left text-body text-text-secondary transition-colors duration-150 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]"
    >
      <Plus size={18} className="text-accent" aria-hidden />
      Add task
    </button>
  )
}

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

  if (prefs.layout === 'board') {
    const columns = !inbox
      ? []
      : prefs.groupBy === 'none'
        ? inboxBoardColumns(tasks, inbox.id)
        : groupBoardColumns(pipelineGroups(tasks, prefs, ctx, ctx.projects))
    return (
      <ODErrorBoundary label="Inbox">
        <div className="flex h-full flex-col px-6">
          <ViewHeader title="Inbox" actions={<DisplayMenu viewKey={INBOX_KEY} />} />
          {loading ? (
            <div aria-busy="true">
              <TaskListSkeleton rows={8} />
            </div>
          ) : (
            <BoardView
              columns={columns}
              label="Inbox"
              completed={prefs.showCompleted && inbox ? { projectId: inbox.id } : undefined}
              emptyText="Your inbox is empty"
            />
          )}
        </div>
      </ODErrorBoundary>
    )
  }

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
            {inbox && <AddTaskRow context={{ projectId: inbox.id }} />}
            {inbox && prefs.showCompleted && <CompletedSection projectId={inbox.id} />}
          </>
        )}
      </div>
    </ODErrorBoundary>
  )
}
