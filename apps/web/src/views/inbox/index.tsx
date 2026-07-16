/**
 * Inbox view — the inbox project's active tasks rendered as a collapsible tree,
 * plus an inline "+ Add task" affordance scoped to the inbox project.
 *
 * The task list receives the FULL set of active inbox-project tasks (parents AND
 * subtasks): `tree` mode calls `buildTaskTree`, which derives the top-level roots
 * and nests children from its own input, so pre-filtering with `topLevel` (as the
 * plan line literally writes) would strip every subtask out of the tree. This
 * mirrors Task L's `proj-root` tree list ("no-section tasks", not top-level).
 */
import { useProjects } from '@/api/hooks/projects'
import { useActiveTasks } from '@/api/hooks/tasks'
import { InlineAdd } from '@/components/quick-add/inline-add'
import { TaskList } from '@/components/task/task-list'
import { Skeleton } from '@/components/ui/skeleton'
import { ViewHeader } from '@/components/view-header'
import { activeTasks, byChildOrder, tasksInProject } from '@/lib/derive'

const SKELETON_ROWS = ['a', 'b', 'c']

export function InboxView() {
  const projectsQuery = useProjects()
  const tasksQuery = useActiveTasks()
  const loading = projectsQuery.isPending || tasksQuery.isPending

  const inbox = projectsQuery.data?.find((p) => p.is_inbox)
  const tasks =
    inbox && tasksQuery.data
      ? byChildOrder(tasksInProject(activeTasks(tasksQuery.data), inbox.id))
      : []

  return (
    <div className="mx-auto max-w-[var(--content-max)] px-6 pb-24">
      <ViewHeader title="Inbox" />
      {loading ? (
        <div className="flex flex-col gap-1">
          {SKELETON_ROWS.map((key) => (
            <Skeleton key={key} className="h-[42px] w-full" />
          ))}
        </div>
      ) : (
        <>
          <TaskList tasks={tasks} groupId="inbox" tree emptyText="Your inbox is empty" />
          {inbox && <InlineAdd defaults={{ project_id: inbox.id }} placement="bottom" />}
        </>
      )}
    </div>
  )
}
