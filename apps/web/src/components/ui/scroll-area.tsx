/**
 * shadcn-compatible ScrollArea on @base-ui/react.
 * FROZEN by Task A — later tasks import, never edit.
 */
import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area'
import type * as React from 'react'
import { cn } from '@/lib/utils'

export function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('relative overflow-hidden', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport className="size-full overscroll-contain rounded-[inherit] outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

export function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Scrollbar>) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        'flex touch-none select-none p-px opacity-0 transition-opacity duration-150 data-hovering:opacity-100 data-scrolling:opacity-100',
        orientation === 'vertical' && 'w-2',
        orientation === 'horizontal' && 'h-2 flex-col',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-[var(--od-scrollbar-thumb)]" />
    </ScrollAreaPrimitive.Scrollbar>
  )
}
