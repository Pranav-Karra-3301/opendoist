/**
 * BoardCard — a single task rendered as a kanban card (Board View pass, Task B).
 *
 * The board shows only top-level tasks (`parent_id === null`); a card's subtree moves with it,
 * so cards never nest. Anatomy mirrors the §Reference: a priority-colored checkbox, the title
 * (wrapping to two lines), the SAME meta chips as the list row (`TaskMeta`, with the column's
 * implied date suppressed), a hover ⋯ button opening the EXISTING task row menu (`RowPopovers`),
 * and click-to-open-detail + selection semantics identical to `TaskRow`. Reuse over rebuild:
 * checkbox, meta chips, and the row popover are the exact list primitives — no forked rendering.
 *
 * Whole-card drag (Task C): `SortableBoardCard` wires `useSortable` and spreads the drag listeners
 * on the card ROOT (no 6-dot handle on boards). The pointer sensor's 4px activation distance keeps a
 * tap a click (title → detail, checkbox → complete, ⋯ → menu). We deliberately do NOT spread the
 * dnd `attributes` (they set `role="button"`), because the card nests interactive controls and a
 * `role="button"` wrapper would fail axe's nested-interactive rule; the card stays reachable and
 * openable via its title button (Enter), matching the list's pointer-only drag parity.
 */
import { useNavigate } from '@tanstack/react-router'
import { Ellipsis } from 'lucide-react'
import { type CSSProperties, type MouseEvent, useRef } from 'react'
import { useTaskMutations } from '@/api/hooks/tasks'
import type { Task } from '@/api/schemas'
import { CSS, useSortable } from '@/lib/dnd'
import { cn } from '@/lib/utils'
import { useSelectionStore } from '@/stores/selection'
import { useUiStore } from '@/stores/ui'
import { RowPopovers } from '../../components/task/row-popovers'
import { TaskCheckbox } from '../../components/task/task-checkbox'
import { TaskMeta } from '../../components/task/task-meta'

/** Drag wiring handed to the card root by `SortableBoardCard` (undefined in the drag overlay). */
interface CardDrag {
  setNodeRef: (node: HTMLElement | null) => void
  listeners: ReturnType<typeof useSortable>['listeners']
  style: CSSProperties
  isDragging: boolean
}

export interface BoardCardProps {
  task: Task
  showProject?: boolean
  /** ISO date implied by the card's column — a matching due chip is suppressed (see TaskMeta). */
  hideDueChipWhen?: string
  /** Rendered inside `<DragOverlay>` — drops the DOM id (avoids a duplicate) and the sortable ref. */
  overlay?: boolean
}

/** The draggable card used inside a column's `SortableContext`. */
export function SortableBoardCard(props: BoardCardProps) {
  // `attributes` (role="button", tabIndex) are intentionally NOT spread — see file header.
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
  })
  const drag: CardDrag = {
    setNodeRef,
    listeners,
    style: { transform: CSS.Transform.toString(transform), transition },
    isDragging,
  }
  return <BoardCard {...props} drag={drag} />
}

export function BoardCard({
  task,
  showProject,
  hideDueChipWhen,
  overlay,
  drag,
}: BoardCardProps & { drag?: CardDrag }) {
  const navigate = useNavigate()
  const { close, reopen } = useTaskMutations()
  const focused = useSelectionStore((s) => s.focusedId === task.id)
  const selected = useSelectionStore((s) => s.selectedIds.has(task.id))
  const setFocused = useSelectionStore((s) => s.setFocused)
  const toggleSelected = useSelectionStore((s) => s.toggleSelected)
  const rangeSelectTo = useSelectionStore((s) => s.rangeSelectTo)
  const openRowPopover = useUiStore((s) => s.openRowPopover)
  const popoverOpen = useUiStore((s) => s.activeRowPopover?.taskId === task.id)
  const shiftRef = useRef(false)

  const completed = task.completed_at !== null

  const openDetail = () => {
    void navigate({ to: '.', search: (prev) => ({ ...prev, task: task.id }) })
  }

  function handleTitleClick(event: MouseEvent) {
    if (event.metaKey || event.ctrlKey) {
      setFocused(task.id)
      toggleSelected(task.id)
      return
    }
    if (event.shiftKey) {
      rangeSelectTo(task.id)
      return
    }
    setFocused(task.id)
    openDetail()
  }

  function handleToggle() {
    if (completed) {
      reopen.mutate({ id: task.id })
      return
    }
    if (shiftRef.current && task.due?.recurrence != null) {
      close.mutate({ id: task.id, complete_series: true })
      return
    }
    close.mutate({ id: task.id })
  }

  return (
    <div
      ref={drag?.setNodeRef}
      id={overlay ? undefined : `task-${task.id}`}
      style={drag?.style}
      data-focused={focused || undefined}
      data-selected={selected || undefined}
      data-dragging={drag?.isDragging || undefined}
      {...drag?.listeners}
      className={cn(
        'group/card relative flex touch-none gap-2 rounded-[10px] border p-3 transition-shadow',
        overlay && 'cursor-grabbing bg-surface shadow-drag',
        drag?.isDragging && 'opacity-40',
        selected
          ? 'border-border bg-selected'
          : focused
            ? 'border-[var(--ot-row-focus-ring)] bg-[var(--ot-row-focus-bg)]'
            : 'border-border bg-surface hover:shadow-menu',
      )}
    >
      <span
        onClickCapture={(event) => {
          shiftRef.current = event.shiftKey
        }}
        className="mt-px shrink-0"
      >
        <TaskCheckbox
          priority={task.priority}
          checked={completed}
          uncompletable={task.uncompletable}
          onToggle={handleToggle}
          content={task.content}
        />
      </span>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={handleTitleClick}
          onDoubleClick={openDetail}
          className={cn(
            'block max-w-full cursor-pointer text-left text-body [overflow-wrap:anywhere] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-focus-ring)]',
            completed ? 'text-text-tertiary line-through' : 'text-text-primary',
          )}
        >
          {task.content}
        </button>
        <TaskMeta task={task} showProject={showProject} hideDueChipWhen={hideDueChipWhen} />
      </div>

      <div
        className={cn(
          'absolute top-1.5 right-1.5 transition-opacity',
          popoverOpen
            ? 'opacity-100'
            : 'opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100',
        )}
      >
        <button
          type="button"
          aria-label="More actions"
          onClick={(event) => {
            event.stopPropagation()
            openRowPopover(task.id, 'more')
          }}
          className="flex size-7 items-center justify-center rounded-sm bg-surface text-text-secondary transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-focus-ring)]"
        >
          <Ellipsis size={18} aria-hidden />
        </button>
        <RowPopovers taskId={task.id} />
      </div>
    </div>
  )
}
