/**
 * Whole-card drag-and-drop for the board (Task C).
 *
 * The board is a renderer over the SAME slices the list computes, and this hook is a renderer over
 * the SAME mutations the list drags use — never a parallel data path. Every column carries a frozen
 * `drop`/`reorder` descriptor (see `BoardView`'s derivation helpers), so the drop→mutation mapping
 * here is view-agnostic: the hook only reads the source/target columns, never the view kind. PATCH
 * shapes are byte-equal to the list drags (Task A §3):
 *
 *  - cross-column `section` (project / inbox)  → `move.mutate({ to: { project_id, section_id,
 *    parent_id: null } })` (server appends: child_order max+1).
 *  - cross-column `due` / `dueToday` / `dueTomorrow` (Today Overdue→Today, Upcoming cross-day,
 *    grouped-by-date) → `update({ patch: { due: { ...sourceDue, date, string: date } } })` keeping
 *    time + recurrence; a `no-date` target clears the due date.
 *  - cross-column `priority` (grouped-by-priority) → `update({ patch: { priority } })`.
 *  - cross-column `label` (grouped-by-label) → swap the source column's label for the target's
 *    (`labels − src + dst`, deduped; `label:none` only strips the source).
 *  - within-column reorder → `child_order` (project/inbox, via the shared `reorderChildOrder`) or
 *    sequential silent `day_order` (Today's Today column, Upcoming days); disabled elsewhere.
 *
 * Sensors are pointer-only (4px activation distance), matching the list's `useAppSensors` — a tap
 * stays a click so the card's title/checkbox/⋯ keep working. Keyboard DRAG is deliberately not
 * wired (recorded descope, upheld in review): the plan's "existing dnd keyboard-sensor pattern"
 * does not exist — `KeyboardSensor` is re-exported by `lib/dnd` but never instantiated anywhere,
 * and every list drag is equally pointer-only — and dnd-kit keyboard activation requires the
 * sortable `attributes` (`role="button"` + tabIndex) on the card ROOT, which nests the card's
 * interactive controls and fails the axe gate (see `BoardCard`'s header). Keyboard users keep
 * full parity with every drop mutation through existing affordances: the focusable card title
 * (Enter) opens the detail panel, which edits project/section, due date, priority, and labels —
 * the exact PATCH/move shapes the drops fire.
 */

import { addDaysIso, type Due, dateInTz } from '@opentask/core'
import { useState } from 'react'
import { useTaskMutations } from '@/api/hooks/tasks'
import type { Task } from '@/api/schemas'
import { arrayMove, type DragEndEvent, type DragStartEvent, useAppSensors } from '@/lib/dnd'
import { useParseCtx } from '@/lib/parse-context'
import { playCue } from '@/lib/sound'
import { reorderChildOrder } from '@/views/project/use-project-dnd'
import type { BoardColumnModel, BoardDrop } from './BoardView'

interface Located {
  columnIndex: number
  column: BoardColumnModel
  task: Task
  taskIndex: number
}

/** The mutation a cross-column drop resolves to — pure, so the whole frozen §3 table is unit-testable. */
export type BoardCrossMutation =
  | {
      kind: 'move'
      id: string
      to: { project_id: string; section_id: string | null; parent_id: null }
    }
  | { kind: 'due'; id: string; due: Due | null }
  | { kind: 'priority'; id: string; priority: 1 | 2 | 3 | 4 }
  | { kind: 'labels'; id: string; labels: string[] }
  | null

/** Build a reschedule due value, preserving time/recurrence (frozen §3); `null` date clears it. */
function dueFor(task: Task, date: string | null): Due | null {
  if (date === null) return null
  if (task.due !== null) return { ...task.due, date, string: date }
  return { date, time: null, string: date, recurrence: null }
}

/**
 * Plan the cross-column drop of `task` (currently in a column with `sourceDrop`) onto a column with
 * `targetDrop`. `today` resolves the relative today/tomorrow date buckets. Returns `null` for
 * disabled / no-op drops (Overdue, `later`/`overdue`/project/none columns, or a label swap that
 * changes nothing).
 */
export function planCrossDrop(
  task: Task,
  sourceDrop: BoardDrop,
  targetDrop: BoardDrop,
  today: string,
): BoardCrossMutation {
  switch (targetDrop.type) {
    case 'none':
      return null
    case 'section':
      return {
        kind: 'move',
        id: task.id,
        to: { project_id: targetDrop.projectId, section_id: targetDrop.sectionId, parent_id: null },
      }
    case 'due':
      return { kind: 'due', id: task.id, due: dueFor(task, targetDrop.date) }
    case 'dueToday':
      return { kind: 'due', id: task.id, due: dueFor(task, today) }
    case 'dueTomorrow':
      return { kind: 'due', id: task.id, due: dueFor(task, addDaysIso(today, 1)) }
    case 'priority':
      return { kind: 'priority', id: task.id, priority: targetDrop.priority }
    case 'label': {
      const src = sourceDrop.type === 'label' ? sourceDrop.label : null
      let labels = task.labels
      if (src !== null) labels = labels.filter((l) => l !== src)
      if (targetDrop.label !== null && !labels.includes(targetDrop.label)) {
        labels = [...labels, targetDrop.label]
      }
      if (labels.length === task.labels.length && labels.every((l, i) => l === task.labels[i])) {
        return null
      }
      return { kind: 'labels', id: task.id, labels }
    }
  }
}

/** Find the column (and index) that holds `taskId`, plus the task itself. */
function locate(columns: BoardColumnModel[], taskId: string): Located | null {
  for (let c = 0; c < columns.length; c += 1) {
    const column = columns[c]
    if (column === undefined) continue
    const taskIndex = column.tasks.findIndex((t) => t.id === taskId)
    if (taskIndex !== -1) {
      const task = column.tasks[taskIndex]
      if (task !== undefined) return { columnIndex: c, column, task, taskIndex }
    }
  }
  return null
}

export interface UseBoardDnd {
  sensors: ReturnType<typeof useAppSensors>
  onDragStart: (event: DragStartEvent) => void
  onDragEnd: (event: DragEndEvent) => void
  onDragCancel: () => void
  activeTask: Task | undefined
  activeShowProject: boolean | undefined
  activeHideDueChipWhen: string | undefined
}

export function useBoardDnd(columns: BoardColumnModel[]): UseBoardDnd {
  const sensors = useAppSensors()
  const ctx = useParseCtx()
  const { update, move } = useTaskMutations()
  const [activeId, setActiveId] = useState<string | null>(null)

  function reorderWithin(column: BoardColumnModel, from: number, to: number): void {
    if (column.reorder === 'child_order') {
      const patches = reorderChildOrder(column.tasks, from, to)
      if (patches.length > 0) playCue('droplet')
      for (const patch of patches) {
        update.mutate({ id: patch.id, patch: { child_order: patch.child_order }, silent: true })
      }
      return
    }
    if (column.reorder === 'day_order') {
      if (from === -1 || to === -1 || from === to) return
      playCue('droplet')
      arrayMove(column.tasks, from, to).forEach((t, i) => {
        if (t.day_order !== i) update.mutate({ id: t.id, patch: { day_order: i }, silent: true })
      })
    }
  }

  function crossColumn(source: Located, target: BoardColumnModel): void {
    const today = dateInTz(ctx.now, ctx.timezone)
    const m = planCrossDrop(source.task, source.column.drop, target.drop, today)
    if (m === null) return
    playCue('droplet')
    if (m.kind === 'move') {
      move.mutate({ id: m.id, to: m.to })
      return
    }
    if (m.kind === 'due') {
      update.mutate({ id: m.id, patch: { due: m.due } })
      return
    }
    if (m.kind === 'priority') {
      update.mutate({ id: m.id, patch: { priority: m.priority } })
      return
    }
    update.mutate({ id: m.id, patch: { labels: m.labels } })
  }

  function onDragEnd(event: DragEndEvent): void {
    setActiveId(null)
    const activeIdStr = String(event.active.id)
    const overId = event.over ? String(event.over.id) : null
    if (overId === null || overId === activeIdStr) return

    const source = locate(columns, activeIdStr)
    if (source === null) return

    // `over` is either a column droppable (its `key`) or a card (its task id).
    const targetByKey = columns.find((c) => c.key === overId)
    const overCard = targetByKey === undefined ? locate(columns, overId) : null
    const target = targetByKey ?? overCard?.column
    if (target === undefined || target === null) return

    if (target === source.column) {
      const to = overCard === null ? source.column.tasks.length - 1 : overCard.taskIndex
      reorderWithin(source.column, source.taskIndex, to)
      return
    }
    crossColumn(source, target)
  }

  function onDragStart(event: DragStartEvent): void {
    setActiveId(String(event.active.id))
  }

  const located = activeId === null ? null : locate(columns, activeId)
  return {
    sensors,
    onDragStart,
    onDragEnd,
    onDragCancel: () => setActiveId(null),
    activeTask: located?.task,
    activeShowProject: located?.column.showProject,
    activeHideDueChipWhen: located?.column.impliedDate,
  }
}
