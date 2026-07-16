/**
 * shadcn-compatible Skeleton (plain div).
 * FROZEN by Task A — later tasks import, never edit.
 */
import type * as React from 'react'
import { cn } from '@/lib/utils'

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-sm bg-hover motion-reduce:animate-none', className)}
      {...props}
    />
  )
}
