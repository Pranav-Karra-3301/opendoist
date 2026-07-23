/**
 * A single project section: collapse chevron, inline-editable name, task count, more-menu
 * (rename / delete), and — when expanded — a droppable `tree`+`sortable` TaskList plus an
 * inline "+ Add task" row scoped to the section.
 *
 * Task H: the "+ Add task" row is list-anchored, so it swaps in the inline {@link InlineComposer}
 * (never the centered dialog). The swap lives in {@link AddTaskRow}, exported here and reused by
 * the project root rows in `./index` (as `EditableText` already is).
 */
import { ChevronDown, ChevronRight, Ellipsis, Pencil, Plus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useSectionMutations } from '@/api/hooks/sections'
import type { Section, Task } from '@/api/schemas'
import { InlineComposer, type InlineComposerContext } from '@/components/quick-add/inline-composer'
import { TaskList } from '@/components/task/task-list'
import { buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useDialogStore } from '@/features/dialogs/store'
import { useDroppable } from '@/lib/dnd'
import { cn } from '@/lib/utils'
import { sectionDropId } from './use-project-dnd'

export interface EditableTextProps {
  value: string
  editing: boolean
  onEditingChange: (editing: boolean) => void
  onSave: (next: string) => void
  ariaLabel: string
  className?: string
  inputClassName?: string
}

/** Click-to-edit text: renders a button until `editing`, then an autofocused input.
 *  Enter or blur saves a non-empty change; Escape reverts. Shared by the project title
 *  and section names (rename is also driven imperatively by each more-menu). */
export function EditableText({
  value,
  editing,
  onEditingChange,
  onSave,
  ariaLabel,
  className,
  inputClassName,
}: EditableTextProps) {
  // Set before any programmatic end-of-edit so the unmount-triggered blur doesn't re-save.
  const skipBlur = useRef(false)

  if (!editing) {
    return (
      <button
        type="button"
        className={cn('max-w-full truncate rounded-sm text-left hover:bg-hover', className)}
        onClick={() => onEditingChange(true)}
        aria-label={`Edit ${ariaLabel}`}
      >
        {value}
      </button>
    )
  }

  const commit = (raw: string): void => {
    const next = raw.trim()
    if (next !== '' && next !== value) onSave(next)
    skipBlur.current = true
    onEditingChange(false)
  }
  const cancel = (): void => {
    skipBlur.current = true
    onEditingChange(false)
  }

  return (
    <Input
      autoFocus
      aria-label={ariaLabel}
      defaultValue={value}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => {
        if (skipBlur.current) {
          skipBlur.current = false
          return
        }
        commit(e.currentTarget.value)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit(e.currentTarget.value)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancel()
        }
      }}
      className={cn('h-7', inputClassName)}
    />
  )
}

/**
 * The in-list "+ Add task" row (Task H). Collapsed it is the accent affordance; clicking it swaps
 * the row for the list-anchored {@link InlineComposer} seeded with this row's context (project /
 * section / due date), and `onClose` (Esc, Cancel, or blur while empty) restores the row. Enter
 * inside the composer saves and keeps it open for the next task (Todoist save-and-new).
 */
export function AddTaskRow({ context }: { context: InlineComposerContext }) {
  const [open, setOpen] = useState(false)
  if (open) {
    return <InlineComposer context={context} onClose={() => setOpen(false)} />
  }
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="group flex h-9 w-full items-center gap-2 rounded-sm px-[5px] text-left text-body text-text-secondary transition-colors duration-150 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-focus-ring)]"
    >
      <Plus size={18} className="text-accent" aria-hidden />
      Add task
    </button>
  )
}

export interface SectionBlockProps {
  projectId: string
  section: Section
  /** Container tasks (top-level members of this section plus their subtrees). */
  tasks: Task[]
}

export function SectionBlock({ projectId, section, tasks }: SectionBlockProps) {
  const { update } = useSectionMutations()
  const openDialog = useDialogStore((s) => s.openDialog)
  const { setNodeRef } = useDroppable({ id: sectionDropId(section.id) })
  const [editing, setEditing] = useState(false)
  const collapsed = section.is_collapsed
  const count = tasks.filter((t) => t.parent_id === null).length

  return (
    <section className="pt-6">
      {/* Real section heading for heading navigation; the visible name is a click-to-edit
          button (its accessible name is the edit action), so this carries the section name. */}
      <h2 className="sr-only">{section.name}</h2>
      <div className="group/section flex items-center gap-1 border-border-subtle border-b pb-1">
        <button
          type="button"
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-text-secondary hover:bg-hover hover:text-text-primary"
          onClick={() => update.mutate({ id: section.id, patch: { is_collapsed: !collapsed } })}
          aria-label={
            collapsed ? `Expand section ${section.name}` : `Collapse section ${section.name}`
          }
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronRight size={16} aria-hidden />
          ) : (
            <ChevronDown size={16} aria-hidden />
          )}
        </button>

        <EditableText
          value={section.name}
          editing={editing}
          onEditingChange={setEditing}
          onSave={(name) => update.mutate({ id: section.id, patch: { name } })}
          ariaLabel="Section name"
          className="font-medium text-body text-text-primary"
          inputClassName="max-w-xs font-medium"
        />

        {count > 0 && !editing && (
          <span className="text-caption text-text-tertiary tabular-nums">{count}</span>
        )}

        <div className="ml-auto opacity-0 transition-opacity focus-within:opacity-100 group-hover/section:opacity-100">
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
              {/* Task X gate wiring: confirm + undo via ProjectConfirms (Task F). */}
              <DropdownMenuItem
                variant="destructive"
                onClick={() => openDialog({ kind: 'section-delete', sectionId: section.id })}
              >
                <Trash2 size={16} aria-hidden /> Delete section
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {!collapsed && (
        <div ref={setNodeRef}>
          <TaskList tasks={tasks} groupId={sectionDropId(section.id)} tree sortable />
          <AddTaskRow context={{ projectId, sectionId: section.id }} />
        </div>
      )}
    </section>
  )
}
