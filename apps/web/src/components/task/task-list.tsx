import { useEffect } from 'react'
import { useTaskMutations } from '@/api/hooks/tasks'
import type { Task } from '@/api/schemas'
import { buildTaskTree } from '@/lib/derive'
import { SortableContext, verticalListSortingStrategy } from '@/lib/dnd'
import { useSelectionStore } from '@/stores/selection'
import { TaskRow } from './task-row'

/** FROZEN props (Task A). Task E renders rows + registers visible ids per groupId. */
export interface TaskListProps {
  tasks: Task[]
  groupId: string
  emptyText?: string
  showProject?: boolean
  tree?: boolean
  sortable?: boolean
}

/**
 * Module-level visible-id registry. Several lists coexist on one screen (e.g. Upcoming's
 * per-day sections); each publishes its ordered ids under its `groupId` and the merged,
 * insertion-ordered concatenation becomes the selection store's `visibleIds` so ⌘/Shift
 * range selection and j/k focus traverse every row in DOM order. A `Map` preserves the
 * order groups first register in, which matches their top-to-bottom mount order.
 */
const registry = new Map<string, string[]>()

function flushRegistry() {
  const all: string[] = []
  for (const ids of registry.values()) all.push(...ids)
  useSelectionStore.getState().setVisibleIds(all)
}

function registerVisible(groupId: string, ids: string[]) {
  registry.set(groupId, ids)
  flushRegistry()
}

function unregisterVisible(groupId: string) {
  if (registry.delete(groupId)) flushRegistry()
}

export function TaskList({
  tasks,
  groupId,
  emptyText,
  showProject,
  tree,
  sortable,
}: TaskListProps) {
  const { update } = useTaskMutations()

  const rows = tree ? buildTaskTree(tasks) : tasks.map((task) => ({ task, depth: 0 }))
  const parentIds =
    tree === true
      ? new Set(tasks.filter((t) => t.parent_id !== null).map((t) => t.parent_id))
      : null
  const orderedIds = rows.map((r) => r.task.id)
  const idsKey = JSON.stringify(orderedIds)

  useEffect(() => {
    registerVisible(groupId, JSON.parse(idsKey) as string[])
  }, [groupId, idsKey])

  useEffect(() => () => unregisterVisible(groupId), [groupId])

  if (tasks.length === 0) {
    return <p className="py-2 text-copy text-text-tertiary italic">{emptyText ?? 'No tasks'}</p>
  }

  const rendered = rows.map(({ task, depth }) => {
    const collapse =
      tree === true
        ? parentIds?.has(task.id)
          ? {
              collapsed: task.is_collapsed,
              onToggle: () =>
                update.mutate({
                  id: task.id,
                  patch: { is_collapsed: !task.is_collapsed },
                  silent: true,
                }),
            }
          : null
        : undefined
    return (
      <TaskRow
        key={task.id}
        task={task}
        depth={depth}
        showProject={showProject}
        sortable={sortable}
        collapse={collapse}
      />
    )
  })

  if (sortable) {
    return (
      <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
        {rendered}
      </SortableContext>
    )
  }
  return <>{rendered}</>
}
