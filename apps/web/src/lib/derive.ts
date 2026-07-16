/**
 * Pure client-side selectors over the single `useActiveTasks()` cache entry.
 * Views derive their slices here instead of issuing view-specific queries
 * (single-user app, small data — kills server-param drift, keeps optimistic
 * updates one-cache simple; server-side filter queries arrive in phase 5).
 */
import type { Task } from '@/api/schemas'

/** Tasks not yet completed (the server already excludes soft-deleted rows). */
export function activeTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => t.completed_at === null)
}

export function tasksInProject(tasks: Task[], projectId: string): Task[] {
  return tasks.filter((t) => t.project_id === projectId)
}

export function tasksWithLabel(tasks: Task[], name: string): Task[] {
  return tasks.filter((t) => t.labels.includes(name))
}

export function dueOn(tasks: Task[], dateIso: string): Task[] {
  return tasks.filter((t) => t.due !== null && t.due.date === dateIso)
}

export function overdue(tasks: Task[], todayIso: string): Task[] {
  return tasks.filter((t) => t.due !== null && t.due.date < todayIso)
}

export function inboxCount(tasks: Task[], inboxProjectId: string): number {
  return tasksInProject(activeTasks(tasks), inboxProjectId).length
}

/** Due today + overdue (matches the Today view's two blocks). */
export function todayCount(tasks: Task[], todayIso: string): number {
  const active = activeTasks(tasks)
  return dueOn(active, todayIso).length + overdue(active, todayIso).length
}

/** Stable sorted copy (ties broken by id so renders don't shuffle). */
export function byChildOrder(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.child_order - b.child_order || a.id.localeCompare(b.id))
}

export function byDayOrder(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.day_order - b.day_order || a.id.localeCompare(b.id))
}

/** Every descendant of `parentId` (depth-first by child_order; excludes the parent). */
export function subtreeOf(tasks: Task[], parentId: string): Task[] {
  const byParent = new Map<string | null, Task[]>()
  for (const t of tasks) {
    const list = byParent.get(t.parent_id) ?? []
    list.push(t)
    byParent.set(t.parent_id, list)
  }
  const out: Task[] = []
  const walk = (id: string): void => {
    for (const child of byChildOrder(byParent.get(id) ?? [])) {
      out.push(child)
      walk(child.id)
    }
  }
  walk(parentId)
  return out
}

export function topLevel(tasks: Task[]): Task[] {
  return tasks.filter((t) => t.parent_id === null)
}

/**
 * Depth-first flatten by child_order, respecting `is_collapsed` (a collapsed node
 * emits but its descendants are skipped). Tasks whose parent is not in the input
 * are treated as roots so filtered lists never lose rows.
 */
export function buildTaskTree(tasks: Task[]): Array<{ task: Task; depth: number }> {
  const present = new Set(tasks.map((t) => t.id))
  const byParent = new Map<string | null, Task[]>()
  const roots: Task[] = []
  for (const t of tasks) {
    if (t.parent_id !== null && present.has(t.parent_id)) {
      const list = byParent.get(t.parent_id) ?? []
      list.push(t)
      byParent.set(t.parent_id, list)
    } else {
      roots.push(t)
    }
  }
  const out: Array<{ task: Task; depth: number }> = []
  const walk = (nodes: Task[], depth: number): void => {
    for (const task of byChildOrder(nodes)) {
      out.push({ task, depth })
      if (!task.is_collapsed) walk(byParent.get(task.id) ?? [], depth + 1)
    }
  }
  walk(roots, 0)
  return out
}
