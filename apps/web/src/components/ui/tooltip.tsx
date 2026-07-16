/**
 * shadcn-compatible Tooltip on @base-ui/react.
 * FROZEN by Task A — later tasks import, never edit.
 */
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import type * as React from 'react'
import { cn } from '@/lib/utils'

export const TooltipProvider = TooltipPrimitive.Provider

export const Tooltip = TooltipPrimitive.Root

export const TooltipTrigger = TooltipPrimitive.Trigger

export function TooltipContent({
  className,
  sideOffset = 6,
  side = 'top',
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Popup> & {
  sideOffset?: number
  side?: React.ComponentProps<typeof TooltipPrimitive.Positioner>['side']
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        sideOffset={sideOffset}
        side={side}
        className="z-[var(--z-tooltip)]"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            'rounded-sm bg-surface-overlay px-2 py-1 text-caption text-white transition-opacity duration-150 ease-standard data-ending-style:opacity-0 data-starting-style:opacity-0 [box-shadow:var(--shadow-toast)]',
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}
