/**
 * shadcn-compatible Popover on @base-ui/react. `anchor` on PopoverContent forwards to the
 * Positioner so controlled popovers can anchor to arbitrary elements (row actions).
 * FROZEN by Task A — later tasks import, never edit.
 */
import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import type * as React from 'react'
import { cn } from '@/lib/utils'

export const Popover = PopoverPrimitive.Root

export const PopoverTrigger = PopoverPrimitive.Trigger

export const PopoverClose = PopoverPrimitive.Close

export function PopoverContent({
  className,
  sideOffset = 4,
  side,
  align = 'center',
  anchor,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Popup> & {
  sideOffset?: number
  side?: React.ComponentProps<typeof PopoverPrimitive.Positioner>['side']
  align?: React.ComponentProps<typeof PopoverPrimitive.Positioner>['align']
  anchor?: React.ComponentProps<typeof PopoverPrimitive.Positioner>['anchor']
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        sideOffset={sideOffset}
        side={side}
        align={align}
        anchor={anchor}
        className="z-[var(--z-popover)]"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            'w-72 rounded-lg bg-surface-raised p-4 text-text-primary outline-none transition-opacity duration-150 ease-standard data-ending-style:opacity-0 data-starting-style:opacity-0 dark:border dark:border-border [box-shadow:var(--shadow-popover)]',
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}
