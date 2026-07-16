/**
 * shadcn-compatible Button on plain <button> (Base UI has no button primitive worth
 * wrapping). No `asChild`: style non-buttons with the exported `buttonVariants`.
 * FROZEN by Task A — later tasks import, never edit.
 */
import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { cn } from '@/lib/utils'

export const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-sm font-medium text-copy transition-colors duration-300 ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)] disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-accent text-on-accent hover:bg-accent-hover disabled:bg-accent-disabled',
        destructive: 'bg-danger text-on-accent hover:bg-danger-hover disabled:opacity-60',
        outline:
          'border border-input-border bg-surface-raised text-text-primary hover:bg-hover disabled:opacity-60',
        secondary:
          'bg-[var(--od-btn-secondary-bg)] text-text-primary hover:bg-[var(--od-btn-secondary-bg-hover)] disabled:opacity-60',
        ghost: 'text-text-secondary hover:bg-hover hover:text-text-primary disabled:opacity-60',
        link: 'text-accent underline-offset-4 hover:underline disabled:opacity-60',
      },
      size: {
        default: 'h-8 px-3',
        sm: 'h-7 px-2 text-caption',
        lg: 'h-9 px-4 text-body',
        icon: 'size-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ComponentProps<'button'>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      data-slot="button"
      type={type}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}
