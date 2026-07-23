/**
 * Priority picker content (Task F). Bare menu list reused by the row popover, the
 * multi-select toolbar, and the task-detail sidebar (frozen export — Task H imports it).
 * P1–P3 render a filled flag in the priority color; P4 is an outline flag in tertiary.
 */
import type { Priority } from '@opentask/core'
import { Check, Flag } from 'lucide-react'
import type { ReactElement } from 'react'

export interface PriorityMenuProps {
  /** Currently applied priority — shown checked. */
  value: Priority
  /** Chosen priority. Caller performs the update and closes the surface. */
  onPick: (priority: Priority) => void
}

const ITEMS: ReadonlyArray<{ n: Priority; className: string; filled: boolean }> = [
  { n: 1, className: 'text-p1', filled: true },
  { n: 2, className: 'text-p2', filled: true },
  { n: 3, className: 'text-p3', filled: true },
  { n: 4, className: 'text-text-tertiary', filled: false },
]

/** Accessible name for a priority option — P1 is highest, P4 is the default (spec §Global). */
export function priorityOptionLabel(n: Priority): string {
  if (n === 1) return 'Priority 1 (highest)'
  if (n === 4) return 'Priority 4 (default)'
  return `Priority ${n}`
}

export function PriorityMenu({ value, onPick }: PriorityMenuProps): ReactElement {
  return (
    <div role="menu" className="flex flex-col">
      {ITEMS.map(({ n, className, filled }) => (
        <button
          key={n}
          type="button"
          role="menuitemradio"
          aria-checked={value === n}
          aria-label={priorityOptionLabel(n)}
          onClick={() => onPick(n)}
          className="flex h-8 items-center gap-2.5 rounded-sm px-2 text-copy text-text-primary transition-colors duration-150 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
        >
          <Flag
            size={16}
            className={className}
            fill={filled ? 'currentColor' : 'none'}
            aria-hidden
          />
          <span>Priority {n}</span>
          {value === n && (
            <Check size={16} className="ml-auto shrink-0 text-text-secondary" aria-hidden />
          )}
        </button>
      ))}
    </div>
  )
}
