/**
 * BoardColumn — one kanban column: a header (name + count + a kind-specific action slot), a
 * vertically-scrolling body of `BoardCard`s, and (where a column accepts new tasks) a bottom
 * "+ Add task" tile that swaps in the shared `InlineComposer`. Chrome is driven by the column's
 * `kind`:
 *  - `section` — the name is the SAME click-to-edit `EditableText` as the list, plus a ⋯ menu with
 *    Rename / Delete wired to the EXACT list mutations (`useSectionMutations` / the section-delete
 *    dialog).
 *  - `overdue` — a "Reschedule" popover that bulk-moves every overdue card to a chosen date (one
 *    undo entry), matching the list's Overdue affordance; no add-tile (you can't create overdue).
 *  - `plain` — just the label + count.
 *
 * The trailing project "Add section" tile lives here too (`AddSectionTile`). Cards are drag sources
 * (`SortableBoardCard`) inside a per-column `SortableContext`, and the scrolling body is the column's
 * drop target (`useDroppable`) — but only when the column `accepts` a drop/reorder, so Overdue and
 * pipeline-sorted grouped columns stay inert. The drop→mutation mapping lives in `use-board-dnd`.
 */
import type { CompletedTask, Due } from '@opendoist/core'
import { addDaysIso, dateInTz, nextWeekdayOnOrAfter } from '@opendoist/core'
import {
  Armchair,
  Ban,
  CalendarArrowUp,
  CalendarDays,
  Ellipsis,
  Pencil,
  Plus,
  Sun,
  Trash2,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useSectionMutations } from '@/api/hooks/sections'
import { useTaskMutations } from '@/api/hooks/tasks'
import type { Task } from '@/api/schemas'
import { InlineComposer, type InlineComposerContext } from '@/components/quick-add/inline-composer'
import { buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useDialogStore } from '@/features/dialogs/store'
import { useUndoStore } from '@/features/undo/store'
import { SortableContext, useDroppable, verticalListSortingStrategy } from '@/lib/dnd'
import { useParseCtx } from '@/lib/parse-context'
import { cn } from '@/lib/utils'
import { TaskCheckbox } from '../../components/task/task-checkbox'
import { EditableText } from '../../views/project/section-block'
import { useProjectViewStore } from '../../views/project/use-project-dnd'
import { SortableBoardCard } from './BoardCard'
import type { BoardColumnModel } from './BoardView'

export function BoardColumn({
  column,
  completed = [],
  onReopen,
}: {
  column: BoardColumnModel
  /** This column's completed rows (see `completedForColumn`) — greyed/struck cards at the bottom. */
  completed?: CompletedTask[]
  onReopen?: (id: string) => void
}) {
  const ariaLabel = column.label === '' ? 'Tasks' : column.label
  // A column is a drop target when it accepts a cross-column drop OR a within-column reorder;
  // Overdue and pipeline-sorted grouped columns accept neither, so they register no droppable and
  // stay inert (a card dropped over their cards resolves to a no-op in the dnd hook).
  const accepts = column.drop.type !== 'none' || column.reorder !== 'none'
  const { setNodeRef, isOver } = useDroppable({ id: column.key, disabled: !accepts })
  const ids = column.tasks.map((t) => t.id)
  return (
    <section aria-label={ariaLabel} className="flex max-h-full w-[280px] shrink-0 flex-col">
      <ColumnHeader column={column} />
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-[10px] pr-0.5 transition-colors',
          isOver && accepts && 'bg-accent-soft',
        )}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {column.tasks.map((task) => (
            <SortableBoardCard
              key={task.id}
              task={task}
              showProject={column.showProject}
              hideDueChipWhen={column.impliedDate}
            />
          ))}
        </SortableContext>
        {column.addContext !== undefined && <AddTaskTile context={column.addContext} />}
        {/* §Reference: completed cards sit greyed/struck at the BOTTOM of their column, below the
            add tile — the same active-list → add-row → completed ordering as the list views. */}
        {completed.map((task) => (
          <CompletedBoardCard key={task.id} task={task} onReopen={onReopen} />
        ))}
      </div>
    </section>
  )
}

/**
 * A completed task as a board card (Show completed on): checked priority circle that reopens the
 * task (the list `CompletedSection` flow), greyed struck-through title, no meta/drag/menu — the
 * board twin of the list's `CompletedRow`, reusing the same `TaskCheckbox` primitive.
 */
function CompletedBoardCard({
  task,
  onReopen,
}: {
  task: CompletedTask
  onReopen?: (id: string) => void
}) {
  return (
    <div className="flex gap-2 rounded-[10px] border border-border bg-surface p-3">
      <span className="mt-px shrink-0">
        <TaskCheckbox
          priority={task.priority}
          checked
          uncompletable={false}
          onToggle={() => onReopen?.(task.id)}
          content={task.content}
        />
      </span>
      <span className="min-w-0 flex-1 pt-px text-body text-text-tertiary line-through [overflow-wrap:anywhere]">
        {task.content}
      </span>
    </div>
  )
}

function ColumnHeaderShell({
  label,
  count,
  action,
}: {
  label: ReactNode
  count: number
  action?: ReactNode
}) {
  return (
    <div className="group/col flex min-h-8 items-center gap-2 pb-2">
      {label}
      {count > 0 && (
        <span data-testid="column-count" className="text-caption text-text-tertiary tabular-nums">
          {count}
        </span>
      )}
      {action !== undefined && <div className="ml-auto">{action}</div>}
    </div>
  )
}

function ColumnHeader({ column }: { column: BoardColumnModel }) {
  const { kind } = column
  if (kind.type === 'section') {
    return <SectionHeader column={column} sectionId={kind.sectionId} />
  }
  const label =
    column.label === '' ? null : (
      <span className="truncate font-medium text-body text-text-primary">{column.label}</span>
    )
  const action =
    kind.type === 'overdue' && column.tasks.length > 0 ? (
      <RescheduleControl tasks={column.tasks} />
    ) : undefined
  return <ColumnHeaderShell label={label} count={column.count} action={action} />
}

function SectionHeader({ column, sectionId }: { column: BoardColumnModel; sectionId: string }) {
  const { update } = useSectionMutations()
  const openDialog = useDialogStore((s) => s.openDialog)
  const [editing, setEditing] = useState(false)

  const menu = (
    <div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover/col:opacity-100">
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'size-7')}
          aria-label="Section actions"
        >
          <Ellipsis size={18} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <Pencil size={16} aria-hidden /> Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => openDialog({ kind: 'section-delete', sectionId })}
          >
            <Trash2 size={16} aria-hidden /> Delete section
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  return (
    <ColumnHeaderShell
      label={
        <EditableText
          value={column.label}
          editing={editing}
          onEditingChange={setEditing}
          onSave={(name) => update.mutate({ id: sectionId, patch: { name } })}
          ariaLabel="Section name"
          className="font-medium text-body text-text-primary"
          inputClassName="max-w-[180px] font-medium"
        />
      }
      count={editing ? 0 : column.count}
      action={menu}
    />
  )
}

/* ------------------------------------ overdue reschedule ------------------------------------ */

interface Preset {
  key: string
  label: string
  icon: ReactNode
  date: string | null
}

/**
 * Overdue-column "Reschedule": bulk-moves every overdue card to a chosen date (preserving each
 * task's time/recurrence) with a single undo entry — the same shape as the list's OverdueBlock.
 */
function RescheduleControl({ tasks }: { tasks: Task[] }) {
  const ctx = useParseCtx()
  const today = dateInTz(ctx.now, ctx.timezone)
  const { update } = useTaskMutations()
  const pushUndo = useUndoStore((s) => s.push)
  const [open, setOpen] = useState(false)

  const rescheduleAll = (target: string | null): void => {
    const restores: Array<{ id: string; due: Due | null }> = []
    for (const t of tasks) {
      if (t.due === null) continue
      restores.push({ id: t.id, due: t.due })
      const nextDue: Due | null = target === null ? null : { ...t.due, date: target }
      update.mutate({ id: t.id, patch: { due: nextDue }, silent: true })
    }
    if (restores.length > 0) {
      const n = restores.length
      pushUndo({
        message: `Rescheduled ${n} ${n === 1 ? 'task' : 'tasks'}`,
        undo: async () => {
          await Promise.all(
            restores.map((r) =>
              update.mutateAsync({ id: r.id, patch: { due: r.due }, silent: true }),
            ),
          )
        },
      })
    }
    setOpen(false)
  }

  const presets: Preset[] = [
    { key: 'today', label: 'Today', icon: <CalendarDays size={16} />, date: today },
    { key: 'tomorrow', label: 'Tomorrow', icon: <Sun size={16} />, date: addDaysIso(today, 1) },
    {
      key: 'next-week',
      label: 'Next week',
      icon: <CalendarArrowUp size={16} />,
      date: nextWeekdayOnOrAfter(today, ctx.nextWeekDay, false),
    },
    {
      key: 'next-weekend',
      label: 'Next weekend',
      icon: <Armchair size={16} />,
      date: nextWeekdayOnOrAfter(today, ctx.weekendDay, false),
    },
    { key: 'no-date', label: 'No date', icon: <Ban size={16} />, date: null },
  ]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Reschedule all overdue tasks"
        className={cn(buttonVariants({ variant: 'link', size: 'sm' }))}
      >
        Reschedule
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        <div className="flex flex-col gap-0.5">
          {presets.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => rescheduleAll(p.date)}
              className="flex h-8 w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 text-copy text-text-primary outline-none transition-colors hover:bg-hover focus-visible:bg-hover"
            >
              <span className="text-text-secondary">{p.icon}</span>
              <span className="flex-1 text-left">{p.label}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/* --------------------------------------- add tiles --------------------------------------- */

/** The column's bottom "+ Add task" tile → swaps in the shared inline composer, scoped to the column. */
function AddTaskTile({ context }: { context: InlineComposerContext }) {
  const [open, setOpen] = useState(false)
  if (open) {
    return <InlineComposer context={context} onClose={() => setOpen(false)} />
  }
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="group flex w-full items-center gap-2 rounded-[10px] px-2 py-2 text-left text-body text-text-secondary transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]"
    >
      <Plus size={18} className="text-accent" aria-hidden />
      Add task
    </button>
  )
}

/**
 * The trailing "Add section" tile (project board): a quiet 10px `--od-hover` rect that expands to
 * an inline name input and appends a new section (`__end__` semantics — append, no renumber). It
 * shares the project view's `useProjectViewStore` add-section state, so the project header's
 * "Add section" button (and the `s` shortcut) open this same inline input.
 */
export function AddSectionTile({ projectId }: { projectId: string }) {
  const { create } = useSectionMutations()
  const addingSectionAt = useProjectViewStore((s) => s.addingSectionAt)
  const startAddSection = useProjectViewStore((s) => s.startAddSection)
  const stop = useProjectViewStore((s) => s.stop)
  const [name, setName] = useState('')
  const open = addingSectionAt === '__end__'

  const submit = (): void => {
    const trimmed = name.trim()
    setName('')
    stop()
    if (trimmed === '') return
    create.mutate({ project_id: projectId, name: trimmed })
  }
  const cancel = (): void => {
    setName('')
    stop()
  }

  if (open) {
    return (
      <div className="flex w-[280px] shrink-0 flex-col gap-2 rounded-[10px] border border-border bg-surface-raised p-2">
        <Input
          autoFocus
          aria-label="Section name"
          placeholder="Name this section"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
          }}
          className="font-medium"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={name.trim() === ''}
            className={cn(buttonVariants({ size: 'sm' }))}
          >
            Add section
          </button>
          <button
            type="button"
            onClick={cancel}
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => startAddSection('__end__')}
      aria-label="Add section"
      className="flex w-[280px] shrink-0 items-center gap-2 rounded-[10px] bg-hover px-3 py-2 text-body text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]"
    >
      <Plus size={18} aria-hidden />
      Add section
    </button>
  )
}
