/**
 * Drag-and-drop + view-local UI state for the Project view.
 *
 * FROZEN exports consumed by Task N's keyboard map:
 *  - `useProjectViewStore` — `{ addingSectionAt, startAddSection(), stop() }` (`s` opens add-section)
 *  - `indentTask(id)` / `outdentTask(id)` — subtask nesting via the move endpoint (`ctrl+]` / `ctrl+[`)
 *  - `useProjectDnd(projectId)` — sensors + `onDragEnd` for the view's `<DndContext>`
 *
 * indent/outdent are module-level (Task N calls them as plain functions), so they read the
 * task cache and reach the server through the `queryClient` singleton exported by `@/router`.
 * That import forms a cycle (router → project view → here → router), which is safe because
 * `queryClient` is only ever *read inside a function body*, never at module-eval time.
 */
import { useQueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import { apiVoid, endpoints } from '@/api/client'
import { useTaskMutations } from '@/api/hooks/tasks'
import { qk } from '@/api/keys'
import { type Task, toMoveBody } from '@/api/schemas'
import { byChildOrder } from '@/lib/derive'
import { arrayMove, type DragEndEvent, useAppSensors } from '@/lib/dnd'
import { queryClient } from '@/router'
import { toast } from '@/stores/toasts'

/** Droppable id (and TaskList groupId) for the project's no-section (root) list. */
export const ROOT_DROP_ID = 'proj-root'
const SECTION_DROP_PREFIX = 'sec-'

/** Droppable id (and TaskList groupId) for a section's list. */
export function sectionDropId(sectionId: string): string {
  return `${SECTION_DROP_PREFIX}${sectionId}`
}

interface ProjectViewState {
  /** Anchor key of the open "Add section" input, or null.
   *  `'__end__'` (append) · `'__first__'` (before first section) · `'after:<sectionId>'`. */
  addingSectionAt: string | null
  startAddSection: (at?: string) => void
  stop: () => void
}

export const useProjectViewStore = create<ProjectViewState>((set) => ({
  addingSectionAt: null,
  startAddSection: (at = '__end__') => set({ addingSectionAt: at }),
  stop: () => set({ addingSectionAt: null }),
}))

/* ---------- module-level subtask nesting (Task N shortcuts) ---------- */

function readTasks(): Task[] {
  return queryClient.getQueryData<Task[]>(qk.tasks) ?? []
}

async function reparent(id: string, parentId: string | null): Promise<void> {
  await apiVoid(endpoints.move(id), { method: 'POST', body: toMoveBody({ parent_id: parentId }) })
  await queryClient.invalidateQueries({ queryKey: qk.tasks })
}

function reportNesting(err: unknown, fallback: string): void {
  // ApiError extends Error, so this covers both.
  toast.error(err instanceof Error ? err.message : fallback)
}

/** Nest a task under its previous same-depth sibling (same parent, section, project). No-op if none. */
export function indentTask(taskId: string): void {
  const tasks = readTasks()
  const task = tasks.find((t) => t.id === taskId)
  if (task === undefined) return
  const siblings = byChildOrder(
    tasks.filter(
      (t) =>
        t.parent_id === task.parent_id &&
        t.section_id === task.section_id &&
        t.project_id === task.project_id,
    ),
  )
  const index = siblings.findIndex((t) => t.id === taskId)
  const prev = index > 0 ? siblings[index - 1] : undefined
  if (prev === undefined) return
  reparent(taskId, prev.id).catch((err: unknown) => reportNesting(err, 'Could not indent task'))
}

/** Promote a subtask to its grandparent (possibly top-level). No-op if already top-level. */
export function outdentTask(taskId: string): void {
  const tasks = readTasks()
  const task = tasks.find((t) => t.id === taskId)
  if (task === undefined || task.parent_id === null) return
  const parent = tasks.find((t) => t.id === task.parent_id)
  const grandparentId = parent?.parent_id ?? null
  reparent(taskId, grandparentId).catch((err: unknown) =>
    reportNesting(err, 'Could not outdent task'),
  )
}

/* ---------- drag-and-drop ---------- */

interface DropTarget {
  sectionId: string | null
  overTask: Task | undefined
}

/**
 * Within-container reorder → the `child_order` patches to apply (silent). The container's existing
 * `child_order` value SET is kept and re-assigned across the moved order, preserving the
 * container's position in the project's global ordering. Shared by the list drag (here) and the
 * board's `use-board-dnd` (Task C), so both write byte-identical patches. `from === to` or an
 * out-of-range index yields no patches.
 */
export function reorderChildOrder(
  group: Task[],
  from: number,
  to: number,
): Array<{ id: string; child_order: number }> {
  if (from === -1 || to === -1 || from === to) return []
  const orders = group.map((t) => t.child_order)
  const patches: Array<{ id: string; child_order: number }> = []
  for (const [i, task] of arrayMove(group, from, to).entries()) {
    const nextOrder = orders[i]
    if (nextOrder !== undefined && task.child_order !== nextOrder) {
      patches.push({ id: task.id, child_order: nextOrder })
    }
  }
  return patches
}

/** Resolve the container a drop landed in from the `over` id (a container droppable or a task row). */
function resolveTarget(overId: string, tasks: Task[]): DropTarget | null {
  if (overId === ROOT_DROP_ID) return { sectionId: null, overTask: undefined }
  if (overId.startsWith(SECTION_DROP_PREFIX)) {
    return { sectionId: overId.slice(SECTION_DROP_PREFIX.length), overTask: undefined }
  }
  const overTask = tasks.find((t) => t.id === overId)
  if (overTask === undefined) return null
  return { sectionId: overTask.section_id, overTask }
}

export function useProjectDnd(projectId: string): {
  sensors: ReturnType<typeof useAppSensors>
  onDragEnd: (event: DragEndEvent) => void
} {
  const sensors = useAppSensors()
  const qc = useQueryClient()
  const { update, move } = useTaskMutations()

  function onDragEnd(event: DragEndEvent): void {
    const activeId = String(event.active.id)
    const overId = event.over ? String(event.over.id) : null
    if (overId === null || overId === activeId) return

    const tasks = qc.getQueryData<Task[]>(qk.tasks) ?? []
    const active = tasks.find((t) => t.id === activeId)
    if (active === undefined) return
    const target = resolveTarget(overId, tasks)
    if (target === null) return

    const sameContainer = active.section_id === target.sectionId

    // Reorder among siblings within the same container: keep the container's existing
    // child_order value set, reassigning which task holds which value (preserves the
    // container's position in the project's global child_order ordering).
    if (
      target.overTask !== undefined &&
      sameContainer &&
      active.parent_id === target.overTask.parent_id
    ) {
      const group = byChildOrder(
        tasks.filter(
          (t) =>
            t.parent_id === active.parent_id &&
            t.section_id === target.sectionId &&
            t.project_id === projectId,
        ),
      )
      const from = group.findIndex((t) => t.id === activeId)
      const to = group.findIndex((t) => t.id === overId)
      for (const patch of reorderChildOrder(group, from, to)) {
        update.mutate({ id: patch.id, patch: { child_order: patch.child_order }, silent: true })
      }
      return
    }

    // Cross-container drop: move to the target section as a top-level task (server appends
    // at the end — POST /tasks/{id}/move ignores child_order). Undo is wired by Task B.
    if (!sameContainer) {
      move.mutate({
        id: activeId,
        to: { project_id: projectId, section_id: target.sectionId, parent_id: null },
      })
    }
  }

  return { sensors, onDragEnd }
}
