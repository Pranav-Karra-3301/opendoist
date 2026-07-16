/**
 * Subtask list inside the task detail (Task H). The open task's descendants, flattened via
 * the core-derived `subtreeOf` + `buildTaskTree` (proper depth + collapse), each rendered
 * with the shared TaskRow. A trailing InlineAdd creates children scoped to this task.
 */
import { useActiveTasks } from '@/api/hooks/tasks'
import type { Task } from '@/api/schemas'
import { InlineAdd } from '@/components/quick-add/inline-add'
import { TaskRow } from '@/components/task/task-row'
import { buildTaskTree, subtreeOf } from '@/lib/derive'

export function SubtaskList({ task }: { task: Task }) {
  const { data: tasks } = useActiveTasks()
  const rows = buildTaskTree(subtreeOf(tasks ?? [], task.id))

  return (
    <section aria-label="Subtasks" className="flex flex-col">
      {rows.length > 0 && (
        <div className="flex flex-col">
          {rows.map(({ task: subtask, depth }) => (
            <TaskRow key={subtask.id} task={subtask} depth={depth} />
          ))}
        </div>
      )}
      <InlineAdd
        defaults={{ parent_id: task.id, project_id: task.project_id }}
        placement="bottom"
      />
    </section>
  )
}
