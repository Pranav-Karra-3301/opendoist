/**
 * shadcn-compatible Switch on @base-ui/react.
 * FROZEN by Task A — later tasks import, never edit.
 */
import { Switch as SwitchPrimitive } from '@base-ui/react/switch'
import type * as React from 'react'
import { cn } from '@/lib/utils'

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-input-border p-0.5 transition-colors duration-150 ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-focus-ring)] disabled:cursor-not-allowed disabled:opacity-60 data-checked:bg-accent',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 rounded-full bg-surface-raised transition-transform duration-150 ease-standard data-checked:translate-x-4 [box-shadow:var(--shadow-menu)]" />
    </SwitchPrimitive.Root>
  )
}
