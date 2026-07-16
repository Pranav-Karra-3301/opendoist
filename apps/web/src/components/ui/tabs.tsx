/**
 * shadcn-compatible Tabs on @base-ui/react.
 * FROZEN by Task A — later tasks import, never edit.
 */
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import type * as React from 'react'
import { cn } from '@/lib/utils'

export const Tabs = TabsPrimitive.Root

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'relative inline-flex h-9 items-center gap-1 rounded-sm bg-surface p-1 text-text-secondary',
        className,
      )}
      {...props}
    >
      {props.children}
      <TabsPrimitive.Indicator className="-z-10 absolute top-1 left-0 h-7 w-[var(--active-tab-width)] translate-x-[var(--active-tab-left)] rounded-sm bg-surface-raised transition-[translate,width] duration-150 ease-standard [box-shadow:var(--shadow-menu)]" />
    </TabsPrimitive.List>
  )
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Tab>) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex h-7 cursor-pointer select-none items-center justify-center rounded-sm px-3 font-medium text-copy outline-none transition-colors duration-150 ease-standard hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)] data-selected:text-text-primary',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Panel>) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn('outline-none', className)}
      {...props}
    />
  )
}
