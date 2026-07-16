/**
 * shadcn-compatible Input on @base-ui/react. Per the component cheatsheet, input focus
 * swaps the border to `input-border-focus` (no accent border, no outer ring).
 * FROZEN by Task A — later tasks import, never edit.
 */
import { Input as InputPrimitive } from '@base-ui/react/input'
import type * as React from 'react'
import { cn } from '@/lib/utils'

export function Input({ className, ...props }: React.ComponentProps<typeof InputPrimitive>) {
  return (
    <InputPrimitive
      data-slot="input"
      className={cn(
        'h-8 w-full min-w-0 rounded-sm border border-input-border bg-surface-raised px-2 text-body text-text-primary outline-none transition-colors duration-150 ease-standard selection:bg-accent-soft placeholder:text-text-tertiary focus:border-input-border-focus disabled:pointer-events-none disabled:opacity-60 aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  )
}
