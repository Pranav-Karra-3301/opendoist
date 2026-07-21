import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  /** ISO date implied by the surrounding view — rows suppress a matching due chip (see TaskMeta). */
  hideDueChipWhen?: string
}

type TaskRowSpec = { task: Task; depth: number }
type UpdateMutation = ReturnType<typeof useTaskMutations>['update']

/**
 * Module-level visible-id registry. Several lists coexist on one screen (e.g. Upcoming's
 * per-day sections); each publishes its ordered ids under its `groupId` and the merged,
 * insertion-ordered concatenation becomes the selection store's `visibleIds` so ⌘/Shift
 * range selection and j/k focus traverse every row in DOM order. A `Map` preserves the
 * order groups first register in, which matches their top-to-bottom mount order.
 *
 * The registry publishes the FULL ordered id set regardless of virtualization, so j/k walk
 * every task even when only a window of rows is in the DOM.
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

/** Build one `<TaskRow>` — shared by the plain and virtualized render paths so both stay identical. */
function renderTaskRow(
  { task, depth }: TaskRowSpec,
  opts: {
    tree: boolean | undefined
    parentIds: Set<string | null> | null
    showProject: boolean | undefined
    sortable: boolean | undefined
    hideDueChipWhen: string | undefined
    update: UpdateMutation
  },
) {
  const collapse =
    opts.tree === true
      ? opts.parentIds?.has(task.id)
        ? {
            collapsed: task.is_collapsed,
            onToggle: () =>
              opts.update.mutate({
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
      showProject={opts.showProject}
      sortable={opts.sortable}
      hideDueChipWhen={opts.hideDueChipWhen}
      collapse={collapse}
    />
  )
}

/**
 * Rendered-row count past which the list switches from one DOM node per task to a windowed
 * (virtualized) list. 500 keeps the fast path byte-for-byte identical for the overwhelmingly
 * common case — where drag-and-drop and j/k focus both rely on every row being in the DOM — and
 * only pays the virtualization cost (and its drag-reorder trade-off) once a list is large enough
 * that a full render would actually jank. The threshold is measured on RENDERED rows (post
 * `is_collapsed` flatten), i.e. the DOM nodes virtualization elides, not the raw task total.
 */
const VIRTUALIZE_THRESHOLD = 500

export function TaskList({
  tasks,
  groupId,
  emptyText,
  showProject,
  tree,
  sortable,
  hideDueChipWhen,
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

  // Windowed rendering for very large lists (a 1,000+ task project or Inbox). Below the
  // threshold the original output is untouched; above it, per-row drag reordering is dropped
  // (dnd-kit's SortableContext must mount every sortable node, defeating the windowing) — an
  // acceptable trade at a size where dragging individual rows is impractical anyway.
  if (rows.length > VIRTUALIZE_THRESHOLD) {
    return (
      <VirtualTaskList
        rows={rows}
        tree={tree}
        parentIds={parentIds}
        showProject={showProject}
        hideDueChipWhen={hideDueChipWhen}
        update={update}
      />
    )
  }

  const rendered = rows.map((row) =>
    renderTaskRow(row, { tree, parentIds, showProject, sortable, hideDueChipWhen, update }),
  )

  if (sortable) {
    return (
      <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
        {rendered}
      </SortableContext>
    )
  }
  return <>{rendered}</>
}

/** Nearest scrollable ancestor of `node` (the view's `<main>` here); null if the page itself scrolls. */
function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  for (let el = node?.parentElement ?? null; el !== null; el = el.parentElement) {
    const overflowY = getComputedStyle(el).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return el
  }
  return null
}

/**
 * Virtualized variant of {@link TaskList}. The scroll container is an ancestor (the view's
 * `<main>`), not this list, so we resolve it after mount and feed the virtualizer a `scrollMargin`
 * equal to the list's offset from the top of the scrollable content — the standard
 * "list is not the scroll container" @tanstack/react-virtual recipe. Rows are dynamically
 * measured (`measureElement`) so variable-height rows (description + meta lines) don't overlap.
 */
function VirtualTaskList({
  rows,
  tree,
  parentIds,
  showProject,
  hideDueChipWhen,
  update,
}: {
  rows: TaskRowSpec[]
  tree: boolean | undefined
  parentIds: Set<string | null> | null
  showProject: boolean | undefined
  hideDueChipWhen: string | undefined
  update: UpdateMutation
}) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const focusedId = useSelectionStore((s) => s.focusedId)

  useLayoutEffect(() => {
    const node = parentRef.current
    if (node === null) return
    const el = findScrollParent(node)
    setScrollEl(el)
    if (el !== null) {
      setScrollMargin(
        node.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop,
      )
    }
  }, [])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => 42,
    overscan: 12,
    scrollMargin,
    getItemKey: (index) => rows[index]?.task.id ?? index,
  })

  // j/k focus can land on a row outside the window (use-focus-nav's getElementById then finds
  // nothing); pull the focused row in when it belongs to this list. A ref keeps this effect off
  // the per-render `rows` identity so it fires only on focus changes, never on every scroll tick.
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  useEffect(() => {
    if (focusedId === null) return
    const index = rowsRef.current.findIndex((r) => r.task.id === focusedId)
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' })
  }, [focusedId, virtualizer])

  return (
    <div ref={parentRef} style={{ position: 'relative', height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => {
        const row = rows[item.index]
        if (row === undefined) return null
        return (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${item.start - scrollMargin}px)`,
            }}
          >
            {renderTaskRow(row, {
              tree,
              parentIds,
              showProject,
              sortable: false,
              hideDueChipWhen,
              update,
            })}
          </div>
        )
      })}
    </div>
  )
}
