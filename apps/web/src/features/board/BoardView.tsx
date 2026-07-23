/**
 * BoardView — the kanban renderer (Board View pass, Task B).
 *
 * A SECOND renderer over the exact same sliced/grouped tasks the list already computes — never a
 * parallel data path. Each view shell derives its columns with the pure `*BoardColumns` helpers
 * exported here (unit-tested, no React) and hands them to `<BoardView>`, which lays them out as a
 * full-bleed, horizontally-scrolling row of fixed-width columns; each column scrolls vertically
 * inside itself (§Reference layout mechanics). The board fills the height its shell gives it
 * (`flex-1 min-h-0`), so the page body never scrolls horizontally.
 *
 * Whole-card drag (Task C) lives in the `DndContext` this component owns, driven by `use-board-dnd`
 * off each column's frozen `drop`/`reorder` descriptor — so the view shells keep rendering a bare
 * `<BoardView>` and the drop→mutation mapping stays view-agnostic.
 */
import {
  applyViewFilter,
  type CompletedTask,
  type FilterContext,
  type FilterTaskView,
  groupTasks,
  sortTasks,
  type ViewPrefs,
} from '@opentask/core'
import type { Section, Task } from '@/api/schemas'
import type { InlineComposerContext } from '@/components/quick-add/inline-composer'
import { byChildOrder, byDayOrder, dueOn, overdue } from '@/lib/derive'
import { closestCenter, DndContext, DragOverlay } from '@/lib/dnd'
import { cn } from '@/lib/utils'
import { monthDayLabel, weekdayLongLabel } from '../../views/upcoming/use-upcoming-days'
import type { RenderGroup } from '../display/pipeline'
import { pickDtos } from '../filter-view/FilterPane'
import { BoardCard } from './BoardCard'
import { AddSectionTile, BoardColumn } from './BoardColumn'
import { type BoardCompletedScope, useBoardCompleted } from './use-board-completed'
import { useBoardDnd } from './use-board-dnd'

/** How a column's header + drop affordances behave. Data-only (no React) so helpers stay pure. */
export type BoardColumnKind =
  | { type: 'plain' }
  | { type: 'section'; sectionId: string; projectId: string }
  | { type: 'overdue' }

/**
 * What a card dropped onto this column PERSISTS (cross-column). `none` ⇒ the column is not a drop
 * target and registers no droppable (Overdue, `later`/`overdue` date buckets, project/none
 * grouping). The relative `dueToday`/`dueTomorrow` are resolved to an ISO date by the board dnd
 * hook (it has the parse context), keeping these derivation helpers pure. PATCH shapes are frozen
 * byte-equal to the list drags (Task A §3).
 */
export type BoardDrop =
  | { type: 'none' }
  | { type: 'section'; projectId: string; sectionId: string | null }
  | { type: 'due'; date: string | null }
  | { type: 'dueToday' }
  | { type: 'dueTomorrow' }
  | { type: 'priority'; priority: 1 | 2 | 3 | 4 }
  | { type: 'label'; label: string | null }

/** How a WITHIN-column reorder persists. `none` ⇒ reorder is disabled (pipeline-sorted / Overdue). */
export type BoardReorder = 'none' | 'child_order' | 'day_order'

/** A single board column: header label + count, its cards, and per-column context. */
export interface BoardColumnModel {
  /** stable react key + droppable id */
  key: string
  label: string
  count: number
  /** top-level cards to render, already ordered */
  tasks: Task[]
  kind: BoardColumnKind
  /** show the project breadcrumb chip on cards (Today/Upcoming/label/filter) */
  showProject?: boolean
  /** ISO date implied by this column — cards suppress a matching due chip */
  impliedDate?: string
  /** seeds the column's "+ Add task" tile; omit to hide the tile (Overdue, grouped columns) */
  addContext?: InlineComposerContext
  /** cross-column drop mutation (Task C) */
  drop: BoardDrop
  /** within-column reorder persistence (Task C) */
  reorder: BoardReorder
}

/**
 * Map a `pipelineGroups`/core group key to its cross-column drop mutation — pure, so it needs no
 * parse context: today/tomorrow buckets defer their ISO resolution to the dnd hook. `overdue`,
 * `later`, `project:*`, and `all` (groupBy none) buckets are non-targets (frozen §3).
 */
export function groupDropFromKey(key: string): BoardDrop {
  if (key.startsWith('priority:')) {
    const p = Number(key.slice('priority:'.length))
    return p === 1 || p === 2 || p === 3 || p === 4
      ? { type: 'priority', priority: p }
      : { type: 'none' }
  }
  if (key === 'label:none') return { type: 'label', label: null }
  if (key.startsWith('label:')) return { type: 'label', label: key.slice('label:'.length) }
  if (key === 'today') return { type: 'dueToday' }
  if (key === 'tomorrow') return { type: 'dueTomorrow' }
  if (key.startsWith('day:')) return { type: 'due', date: key.slice('day:'.length) }
  if (key === 'no-date') return { type: 'due', date: null }
  return { type: 'none' }
}

/* ---------------------------------- pure column derivation ---------------------------------- */

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

/** e.g. `2026-07-22` → `Jul 22`. */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return `${MONTH_ABBREV[d.getUTCMonth()] ?? ''} ${d.getUTCDate()}`
}

/** Overdue order: by due date, then time (all-day first), then stable by id (mirrors OverdueBlock). */
function sortByDue(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const ad = a.due?.date ?? ''
    const bd = b.due?.date ?? ''
    if (ad !== bd) return ad < bd ? -1 : 1
    const at = a.due?.time ?? ''
    const bt = b.due?.time ?? ''
    if (at !== bt) return at < bt ? -1 : 1
    return a.id.localeCompare(b.id)
  })
}

/** Only top-level members of a container slice — the board's cards (subtrees move with the parent). */
function topLevelIn(active: Task[], predicate: (t: Task) => boolean): Task[] {
  return byChildOrder(active.filter((t) => t.parent_id === null && predicate(t)))
}

/**
 * Project board (groupBy none): a leading `(No section)` column shown only when non-empty, then
 * one column per section in the caller's `section_order`. Cards are the top-level tasks of each
 * container; the count matches the list's `SectionBlock` count.
 */
export function projectBoardColumns(
  active: Task[],
  sections: readonly Pick<Section, 'id' | 'name'>[],
  projectId: string,
): BoardColumnModel[] {
  const columns: BoardColumnModel[] = []
  const rootTasks = topLevelIn(active, (t) => t.section_id === null)
  if (rootTasks.length > 0) {
    columns.push({
      key: '__no_section__',
      label: '(No section)',
      count: rootTasks.length,
      tasks: rootTasks,
      kind: { type: 'plain' },
      addContext: { projectId },
      drop: { type: 'section', projectId, sectionId: null },
      reorder: 'child_order',
    })
  }
  for (const section of sections) {
    const tasks = topLevelIn(active, (t) => t.section_id === section.id)
    columns.push({
      key: `section:${section.id}`,
      label: section.name,
      count: tasks.length,
      tasks,
      kind: { type: 'section', sectionId: section.id, projectId },
      addContext: { projectId, sectionId: section.id },
      drop: { type: 'section', projectId, sectionId: section.id },
      reorder: 'child_order',
    })
  }
  return columns
}

/** Inbox board (groupBy none): one unlabeled column of the inbox's top-level tasks, child-ordered. */
export function inboxBoardColumns(active: Task[], inboxProjectId: string): BoardColumnModel[] {
  const tasks = topLevelIn(active, () => true)
  return [
    {
      key: 'inbox',
      label: '',
      count: tasks.length,
      tasks,
      kind: { type: 'plain' },
      addContext: { projectId: inboxProjectId },
      drop: { type: 'section', projectId: inboxProjectId, sectionId: null },
      reorder: 'child_order',
    },
  ]
}

/**
 * Today board: an Overdue column (with a Reschedule affordance, no add-tile, no drop-in) and a
 * `‹Mon D› · Today` column whose cards imply today (so a plain "today" due chip is suppressed).
 */
export function todayBoardColumns(active: Task[], today: string): BoardColumnModel[] {
  const overdueTasks = sortByDue(overdue(active, today))
  const todayTasks = byDayOrder(dueOn(active, today))
  return [
    {
      key: 'overdue',
      label: 'Overdue',
      count: overdueTasks.length,
      tasks: overdueTasks,
      kind: { type: 'overdue' },
      showProject: true,
      drop: { type: 'none' },
      reorder: 'none',
    },
    {
      key: 'today',
      label: `${shortDate(today)} · Today`,
      count: todayTasks.length,
      tasks: todayTasks,
      kind: { type: 'plain' },
      showProject: true,
      impliedDate: today,
      addContext: { dueDate: today },
      drop: { type: 'due', date: today },
      reorder: 'day_order',
    },
  ]
}

/** Upcoming board: one column per rendered day; each column's cards imply that day. */
export function upcomingBoardColumns(
  days: readonly string[],
  tasksByDay: ReadonlyMap<string, Task[]>,
  today: string,
): BoardColumnModel[] {
  return days.map((date) => {
    const tasks = tasksByDay.get(date) ?? []
    const label =
      date === today
        ? `${monthDayLabel(date)} · Today`
        : `${monthDayLabel(date)} · ${weekdayLongLabel(date)}`
    return {
      key: `day:${date}`,
      label,
      count: tasks.length,
      tasks,
      kind: { type: 'plain' },
      showProject: true,
      impliedDate: date,
      addContext: { dueDate: date },
      drop: { type: 'due', date },
      reorder: 'day_order',
    }
  })
}

/** Grouped columns for label/filter/explicit-groupBy views: one column per `RenderGroup`. */
export function groupBoardColumns(groups: readonly RenderGroup[]): BoardColumnModel[] {
  return groups.map((g) => ({
    key: g.key,
    label: g.label,
    count: g.tasks.length,
    tasks: g.tasks,
    kind: { type: 'plain' },
    showProject: true,
    drop: groupDropFromKey(g.key),
    reorder: 'none',
  }))
}

/**
 * Run the Display-prefs pipeline (`applyViewFilter → sortTasks → groupTasks`) over a pane's
 * `FilterTaskView[]` and map each group back to `Task` cards — the label/filter view's board
 * columns. `groupBy none` yields a single (unlabeled) column.
 */
export function viewsToBoardColumns(
  views: FilterTaskView[],
  prefs: ViewPrefs,
  ctx: FilterContext,
  taskById: ReadonlyMap<string, Task>,
): BoardColumnModel[] {
  const filtered = applyViewFilter(views, prefs.filterBy, ctx)
  const sorted = sortTasks(filtered, prefs.sortBy, prefs.sortDir, ctx)
  const groups = groupTasks(sorted, prefs.groupBy, ctx)
  return groups.map((g) => {
    const tasks = pickDtos(g.tasks, taskById)
    return {
      key: g.key,
      label: g.label,
      count: tasks.length,
      tasks,
      kind: { type: 'plain' } as BoardColumnKind,
      showProject: true,
      drop: groupDropFromKey(g.key),
      reorder: 'none' as BoardReorder,
    }
  })
}

/**
 * Distribute the view's completed rows (`useBoardCompleted`) onto a column — the board's
 * counterpart of the list's bottom `CompletedSection`, per §Reference: "Completed cards … appear
 * greyed/struck at the bottom of their column." Pure, so the attribution table is unit-testable:
 *  - section columns (project board) take their section's rows; `(No section)` takes the rest.
 *  - the single inbox column takes every row of its (project-scoped) list.
 *  - day-implied columns (Today's Today, Upcoming days) take rows whose due DATE is that day.
 *  - Overdue and grouped (`pipelineGroups`) columns take none — a completed task is no longer
 *    overdue, and arbitrary group keys have no completed-side counterpart (the deviating list
 *    shows the same flat CompletedSection, not per-group slices).
 */
export function completedForColumn(
  column: BoardColumnModel,
  completed: readonly CompletedTask[],
): CompletedTask[] {
  if (column.kind.type === 'overdue') return []
  if (column.kind.type === 'section') {
    const sectionId = column.kind.sectionId
    return completed.filter((t) => t.section_id === sectionId)
  }
  if (column.key === '__no_section__') return completed.filter((t) => t.section_id === null)
  if (column.key === 'inbox') return [...completed]
  if (column.impliedDate !== undefined) {
    const date = column.impliedDate
    return completed.filter((t) => t.due?.date === date)
  }
  return []
}

/* ------------------------------------- the renderer ------------------------------------- */

export interface BoardViewProps {
  columns: BoardColumnModel[]
  /** ARIA label for the board region (e.g. the view name). */
  label: string
  /** Project sections context — renders the trailing "Add section" tile (project board only). */
  addSection?: { projectId: string }
  /**
   * Present when the view's Display prefs have `showCompleted` on: fetches the view's completed
   * list (project-scoped or global) and renders greyed/struck cards at the bottom of each column
   * via `completedForColumn`. Omit to render no completed cards.
   */
  completed?: BoardCompletedScope
  className?: string
  emptyText?: string
}

export function BoardView({
  columns,
  label,
  addSection,
  completed,
  className,
  emptyText,
}: BoardViewProps) {
  // Whole-card drag lives here so every view shell keeps rendering a bare `<BoardView>` (no per-view
  // DndContext). The hook reads each column's frozen `drop`/`reorder` descriptor, so the mapping is
  // view-agnostic. Clicking empty rail space deselects via the app-frame `<main>` mousedown seam
  // (cards carry `id="task-…"`, headers carry buttons — both kept by that seam's KEEP_SELECTION).
  const dnd = useBoardDnd(columns)
  const done = useBoardCompleted(completed)
  return (
    <DndContext
      sensors={dnd.sensors}
      collisionDetection={closestCenter}
      onDragStart={dnd.onDragStart}
      onDragEnd={dnd.onDragEnd}
      onDragCancel={dnd.onDragCancel}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: a horizontally-scrolling column rail; the labelled columns inside carry the list semantics */}
      <div
        role="group"
        aria-label={label}
        className={cn(
          // Full-bleed to the page's horizontal padding; the rail scrolls horizontally while each
          // column scrolls vertically inside itself. Negative margin + padding lets the last column
          // reach the viewport edge during scroll without the page body scrolling sideways.
          '-mx-6 flex min-h-0 flex-1 items-start gap-4 overflow-x-auto px-6 pb-4',
          className,
        )}
      >
        {columns.length === 0 && (
          <p className="py-2 text-copy text-text-tertiary italic">{emptyText ?? 'No tasks'}</p>
        )}
        {columns.map((column) => (
          <BoardColumn
            key={column.key}
            column={column}
            completed={completedForColumn(column, done.tasks)}
            onReopen={done.reopen}
          />
        ))}
        {addSection !== undefined && <AddSectionTile projectId={addSection.projectId} />}
      </div>
      <DragOverlay dropAnimation={null}>
        {dnd.activeTask ? (
          <div className="w-[280px] cursor-grabbing">
            <BoardCard
              task={dnd.activeTask}
              showProject={dnd.activeShowProject}
              hideDueChipWhen={dnd.activeHideDueChipWhen}
              overlay
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
