/**
 * Pure transforms over the single `qk.tasks` cache array (every active task). The optimistic
 * layer in hooks/tasks.ts applies these inside `onMutate`; the undo store replays their
 * inverses. No React, no IO — each function is unit-tested in cache-updates.test.ts.
 */
import type { Due, ParseContext, Priority } from '@opentask/core'
import { nextOccurrence } from '@opentask/core'
import type { Task, TaskCreate, TaskMove, TaskPatch } from './schemas'

/** Sort key that lands an optimistic (not-yet-persisted) row at the end of any manual-order
 *  list until the server row arrives on the next refetch. */
const OPTIMISTIC_ORDER = 1_000_000_000

/** Rollback context returned by every optimistic `onMutate`: the whole cache before the write. */
export interface Snapshot {
  prev: Task[] | undefined
}

export function findTask(tasks: Task[] | undefined, id: string): Task | undefined {
  return tasks?.find((t) => t.id === id)
}

/** Apply a partial patch to task `id`, leaving every other task untouched. */
export function applyPatch(tasks: Task[], id: string, patch: TaskPatch): Task[] {
  return tasks.map((t) => (t.id === id ? mergePatch(t, patch) : t))
}

function mergePatch(task: Task, patch: TaskPatch): Task {
  const next: Task = { ...task }
  if (patch.content !== undefined) next.content = patch.content
  if (patch.description !== undefined) next.description = patch.description
  if (patch.project_id !== undefined) next.project_id = patch.project_id
  if (patch.section_id !== undefined) next.section_id = patch.section_id
  if (patch.parent_id !== undefined) next.parent_id = patch.parent_id
  if (patch.priority !== undefined) next.priority = patch.priority
  if (patch.due !== undefined) next.due = patch.due
  if (patch.deadline_date !== undefined) next.deadline_date = patch.deadline_date
  if (patch.deadline_time !== undefined) next.deadline_time = patch.deadline_time
  if (patch.duration_min !== undefined) next.duration_min = patch.duration_min
  if (patch.labels !== undefined) next.labels = patch.labels
  if (patch.uncompletable !== undefined) next.uncompletable = patch.uncompletable
  if (patch.day_order !== undefined) next.day_order = patch.day_order
  if (patch.child_order !== undefined) next.child_order = patch.child_order
  if (patch.is_collapsed !== undefined) next.is_collapsed = patch.is_collapsed
  return next
}

/**
 * Every id in the subtree rooted at `id` — the task itself plus every descendant, transitively
 * (the same closure the server walks when it cascades a delete/complete over a subtree).
 */
function subtreeIds(tasks: Task[], id: string): Set<string> {
  const ids = new Set<string>([id])
  for (;;) {
    let grew = false
    for (const t of tasks) {
      if (!ids.has(t.id) && t.parent_id !== null && ids.has(t.parent_id)) {
        ids.add(t.id)
        grew = true
      }
    }
    if (!grew) break
  }
  return ids
}

/**
 * Complete task `id`. A recurring due (recurrence non-null) advances to its next occurrence —
 * keeping the natural-language `string` and the `recurrence` spec — and stays in the list (the
 * server does not complete its children on an advance, so neither do we). A non-recurring task,
 * or a recurring series that has ended (nextOccurrence → null past `until`), is completed AND its
 * whole open subtree is dropped from the active-tasks cache — mirroring the server close route,
 * which closes every open descendant. Dropping only the parent would leave orphaned subtasks in
 * the cache, and buildTaskTree promotes an orphan (parent absent) to a top-level root, so the
 * subtasks would visibly jump to the top of the list on parent completion.
 */
export function applyClose(tasks: Task[], id: string, ctx: ParseContext): Task[] {
  const task = tasks.find((t) => t.id === id)
  if (task === undefined) return tasks
  if (task.due !== null && task.due.recurrence !== null) {
    const next = nextOccurrence(task.due.recurrence, {
      after: { date: task.due.date, time: task.due.time },
      ctx,
    })
    if (next !== null) {
      const advanced: Due = { ...task.due, date: next.date, time: next.time }
      return tasks.map((t) => (t.id === id ? { ...t, due: advanced } : t))
    }
  }
  const closed = subtreeIds(tasks, id)
  return tasks.filter((t) => !closed.has(t.id))
}

/** Inverse of a completion for a task still present in the cache (best-effort; the reopen
 *  mutation's refetch is the source of truth when the task was removed by applyClose). */
export function applyReopen(tasks: Task[], id: string): Task[] {
  return tasks.map((t) => (t.id === id ? { ...t, completed_at: null } : t))
}

/** Drop task `id` and its entire subtree (soft-delete removes descendants from the active list). */
export function applyRemove(tasks: Task[], id: string): Task[] {
  const removed = subtreeIds(tasks, id)
  return tasks.filter((t) => !removed.has(t.id))
}

/** Re-parent / re-order task `id` (only the keys present in `to` are written). */
export function applyMove(tasks: Task[], id: string, to: TaskMove): Task[] {
  return tasks.map((t) => {
    if (t.id !== id) return t
    const next: Task = { ...t }
    if (to.project_id !== undefined) next.project_id = to.project_id
    if (to.section_id !== undefined) next.section_id = to.section_id
    if (to.parent_id !== undefined) next.parent_id = to.parent_id
    if (to.child_order !== undefined) next.child_order = to.child_order
    return next
  })
}

/** Insert `task`, or replace an existing entry sharing its id. */
export function applyCreate(tasks: Task[], task: Task): Task[] {
  return tasks.some((t) => t.id === task.id)
    ? tasks.map((t) => (t.id === task.id ? task : t))
    : [...tasks, task]
}

/** Build a placeholder Task for an optimistic create, replaced by the real server row on the
 *  invalidation refetch. `id`/`now` are injected so the function stays pure and testable. */
export function optimisticTaskFromCreate(
  input: TaskCreate,
  opts: { id: string; now: string },
): Task {
  const priority: Priority = input.priority ?? 4
  return {
    id: opts.id,
    project_id: input.project_id ?? '',
    section_id: input.section_id ?? null,
    parent_id: input.parent_id ?? null,
    child_order: OPTIMISTIC_ORDER,
    day_order: OPTIMISTIC_ORDER,
    content: input.content,
    description: input.description ?? '',
    priority,
    due: input.due ?? null,
    deadline_date: input.deadline_date ?? null,
    deadline_time: input.deadline_time ?? null,
    duration_min: input.duration_min ?? null,
    labels: input.labels ?? [],
    is_collapsed: false,
    uncompletable: input.uncompletable ?? false,
    completed_at: null,
    created_at: opts.now,
    updated_at: opts.now,
  }
}

/** Reduce a Task to the create payload used to restore it after an undo of delete (new id). */
export function taskToCreate(task: Task): TaskCreate {
  return {
    content: task.content,
    description: task.description,
    project_id: task.project_id,
    section_id: task.section_id,
    parent_id: task.parent_id,
    priority: task.priority,
    due: task.due,
    deadline_date: task.deadline_date,
    deadline_time: task.deadline_time ?? null,
    duration_min: task.duration_min,
    labels: task.labels,
    uncompletable: task.uncompletable,
  }
}

/** Structural equality for a Due — distinguishes a genuine reschedule from a no-op update so the
 *  update mutation only pushes an undo entry when `due` actually changed. */
export function dueEqual(a: Due | null, b: Due | null | undefined): boolean {
  const bb = b ?? null
  if (a === null || bb === null) return a === bb
  return JSON.stringify(a) === JSON.stringify(bb)
}
