import { useNavigate } from '@tanstack/react-router'
import { CalendarDays, ChevronDown, ChevronRight, Ellipsis, Pen } from 'lucide-react'
import { type CSSProperties, type MouseEvent, type ReactNode, useRef } from 'react'
import { useTaskMutations } from '@/api/hooks/tasks'
import type { Task } from '@/api/schemas'
import { CSS, useSortable } from '@/lib/dnd'
import { cn } from '@/lib/utils'
import { useSelectionStore } from '@/stores/selection'
import { useUiStore } from '@/stores/ui'
import { RowPopovers } from './row-popovers'
import { TaskCheckbox } from './task-checkbox'
import { TaskMeta } from './task-meta'

export interface TaskRowProps {
  task: Task
  showProject?: boolean
  depth?: number
  sortable?: boolean
  /**
   * Tree-mode collapse control. `undefined` = not in a tree (no chevron gutter);
   * `null` = a tree leaf (reserve the gutter so siblings stay aligned);
   * object = the row has children, render a toggle chevron.
   */
  collapse?: { collapsed: boolean; onToggle: () => void } | null
}

type SortableReturn = ReturnType<typeof useSortable>
interface RowDrag {
  setNodeRef: SortableReturn['setNodeRef']
  listeners: SortableReturn['listeners']
  style: CSSProperties
  isDragging: boolean
}

function RowActionButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className="flex size-7 items-center justify-center rounded-sm text-text-secondary transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]"
    >
      {children}
    </button>
  )
}

function RowView({
  task,
  showProject,
  depth = 0,
  collapse,
  drag,
}: TaskRowProps & { drag?: RowDrag }) {
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
  const description = task.description.split('\n')[0]?.trim() ?? ''

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
      id={`task-${task.id}`}
      data-focused={focused || undefined}
      data-selected={selected || undefined}
      style={{ paddingLeft: 5 + depth * 24, ...(drag?.style ?? {}) }}
      {...(drag?.listeners ?? {})}
      className={cn(
        'group/row relative flex min-h-[42px] items-start gap-1.5 rounded-sm border-border-subtle border-b py-2 pr-[38px]',
        focused && 'bg-[var(--od-row-focus-bg)] shadow-[inset_0_0_0_1px_var(--od-row-focus-ring)]',
        selected && 'bg-selected',
        drag?.isDragging && 'z-10 opacity-60 shadow-drag',
      )}
    >
      {collapse !== undefined &&
        (collapse ? (
          <button
            type="button"
            aria-label={collapse.collapsed ? 'Expand subtasks' : 'Collapse subtasks'}
            onClick={(event) => {
              event.stopPropagation()
              collapse.onToggle()
            }}
            className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm text-text-tertiary hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]"
          >
            {collapse.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </button>
        ) : (
          <span aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        ))}

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
        />
      </span>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={handleTitleClick}
          onDoubleClick={openDetail}
          className={cn(
            'block max-w-full cursor-pointer truncate text-left text-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]',
            completed ? 'text-text-tertiary line-through' : 'text-text-primary',
          )}
        >
          {task.content}
        </button>
        {description !== '' && (
          <p className="truncate text-copy text-text-secondary">{description}</p>
        )}
        <TaskMeta task={task} showProject={showProject} />
      </div>

      <div
        className={cn(
          'absolute top-1.5 right-1.5 flex items-center gap-0.5 pl-2 transition-opacity',
          selected ? 'bg-selected' : focused ? 'bg-[var(--od-row-focus-bg)]' : 'bg-bg',
          popoverOpen
            ? 'opacity-100'
            : 'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100',
        )}
      >
        <RowActionButton label="Edit task" onClick={openDetail}>
          <Pen size={18} />
        </RowActionButton>
        <RowActionButton label="Schedule" onClick={() => openRowPopover(task.id, 'schedule')}>
          <CalendarDays size={18} />
        </RowActionButton>
        <RowActionButton label="More actions" onClick={() => openRowPopover(task.id, 'more')}>
          <Ellipsis size={18} />
        </RowActionButton>
        <RowPopovers taskId={task.id} />
      </div>
    </div>
  )
}

function SortableRow(props: TaskRowProps) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
  })
  const drag: RowDrag = {
    setNodeRef,
    listeners,
    style: { transform: CSS.Transform.toString(transform), transition },
    isDragging,
  }
  return <RowView {...props} drag={drag} />
}

/**
 * A single 42px task row (dossier §2.3 / §2.9): checkbox, title (line-through when
 * complete), one-line description, and the meta line, with hover-revealed edit / schedule /
 * more actions and the row popovers anchored beside them. Click selection lives on the
 * title button (plain → open detail, ⌘/Ctrl → toggle-select, Shift → range-select);
 * keyboard nav drives everything else via the selection store. Set `sortable` inside a
 * `SortableContext` to make the row draggable.
 */
export function TaskRow(props: TaskRowProps) {
  if (props.sortable === true) return <SortableRow {...props} />
  return <RowView {...props} />
}
