/**
 * shadcn-compatible Separator on @base-ui/react.
 * FROZEN by Task A — later tasks import, never edit.
 */
import { Separator as SeparatorPrimitive } from '@base-ui/react/separator'
import type * as React from 'react'
import { cn } from '@/lib/utils'

export function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive>) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  )
}
