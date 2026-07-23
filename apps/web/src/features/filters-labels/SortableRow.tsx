/**
 * Shared building blocks for the Filters & Labels lists (Task D): the draggable row plus the
 * section chrome (header + Add button, empty state, loading skeleton, delete-confirm dialog).
 * `FilterList` and `LabelList` compose these; keeping them in one place makes the two lists
 * pixel-identical.
 *
 * The row is a dnd-kit sortable with a dedicated grip handle: only the handle carries the
 * drag listeners, so the name `<Link>`, favorite star, and overflow menu stay ordinary
 * clicks/keyboard targets. All dnd symbols come through `@/lib/dnd` (the single allowed
 * dnd-kit importer).
 */

import { Ellipsis, GripVertical, Pen, Plus, Star, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { colorVar } from '@/features/dialogs/ColorPicker'
import { CSS, useSortable } from '@/lib/dnd'
import { cn } from '@/lib/utils'

/** 12px color dot painted from a palette color name via the frozen `--ot-palette-*` tokens. */
function ColorDot({ color }: { color: string }) {
  return (
    <span
      className="size-3 shrink-0 rounded-full"
      style={{ backgroundColor: colorVar(color) }}
      aria-hidden="true"
    />
  )
}

/** Name-link styling shared by both lists (the list supplies the typed `<Link>` as children). */
export const ROW_LINK_CLASS =
  'block max-w-full truncate rounded-sm text-body text-text-primary outline-none transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-focus-ring)]'

const HOVER_ACTION_CLASS =
  'flex size-7 shrink-0 items-center justify-center rounded-sm text-text-secondary opacity-0 outline-none transition-colors hover:bg-hover hover:text-text-primary focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-focus-ring)] group-hover/row:opacity-100 group-focus-within/row:opacity-100'

export interface SortableRowProps {
  id: string
  color: string
  isFavorite: boolean
  /** The name element — a typed router `<Link>` supplied by the list. */
  children: ReactNode
  /** aria-label for the Edit menu item and the overflow trigger, e.g. "filter" / "label". */
  entityLabel: string
  /** Human name (for accessible action labels). */
  name: string
  onToggleFavorite: () => void
  onEdit: () => void
  onDelete: () => void
}

/** A single reorderable filter/label row: grip · color dot · name link · favorite star · overflow menu. */
export function SortableRow({
  id,
  color,
  isFavorite,
  children,
  entityLabel,
  name,
  onToggleFavorite,
  onEdit,
  onDelete,
}: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group/row flex items-center gap-2 rounded-sm border-border-subtle border-b py-1.5 pr-1 pl-0.5',
        isDragging && 'z-10 opacity-60 shadow-drag',
      )}
    >
      <button
        type="button"
        aria-label={`Reorder ${name}`}
        className={cn(HOVER_ACTION_CLASS, 'cursor-grab text-text-tertiary active:cursor-grabbing')}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} aria-hidden="true" />
      </button>

      <ColorDot color={color} />

      <div className="min-w-0 flex-1">{children}</div>

      <button
        type="button"
        aria-pressed={isFavorite}
        aria-label={isFavorite ? `Remove ${name} from favorites` : `Add ${name} to favorites`}
        onClick={onToggleFavorite}
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-sm outline-none transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-focus-ring)]',
          isFavorite
            ? 'text-accent'
            : 'text-text-tertiary opacity-0 hover:text-text-primary focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100',
        )}
      >
        <Star size={16} className={isFavorite ? 'fill-current' : undefined} aria-hidden="true" />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`More actions for ${name}`}
          className={cn(HOVER_ACTION_CLASS, 'data-popup-open:opacity-100')}
        >
          <Ellipsis size={16} aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}>
            <Pen size={16} className="text-text-secondary" aria-hidden="true" />
            Edit {entityLabel}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 size={16} aria-hidden="true" />
            Delete {entityLabel}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

/** Section header: title + a round "Add" icon-button that opens the create dialog. */
export function SectionHeader({
  title,
  addLabel,
  onAdd,
}: {
  title: string
  addLabel: string
  onAdd: () => void
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="font-medium text-subtitle text-text-primary">{title}</h2>
      <button
        type="button"
        aria-label={addLabel}
        onClick={onAdd}
        className="flex size-7 items-center justify-center rounded-sm text-text-secondary outline-none transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-focus-ring)]"
      >
        <Plus size={18} aria-hidden="true" />
      </button>
    </div>
  )
}

/** Dashed empty-state card shown when a list has no rows. */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-sm border border-border-subtle border-dashed px-4 py-6 text-center text-copy text-text-tertiary">
      {children}
    </p>
  )
}

/** Three loading skeleton rows while a list query is pending. */
export function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {['a', 'b', 'c'].map((k) => (
        <Skeleton key={k} className="h-8 w-full" />
      ))}
    </div>
  )
}

/**
 * Delete confirmation. `item` null = closed; non-null opens with the name interpolated.
 * A confirmation *and* an undo toast is deliberate (the plan's "confirm then DELETE + undo"):
 * the dialog guards the click, undo recovers from a mistaken confirm.
 */
export function DeleteConfirmDialog({
  item,
  entityLabel,
  onCancel,
  onConfirm,
}: {
  item: { name: string } | null
  entityLabel: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Delete {entityLabel}?</DialogTitle>
          <DialogDescription>
            The {entityLabel} &ldquo;{item?.name}&rdquo; will be deleted. You can undo this right
            after.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
