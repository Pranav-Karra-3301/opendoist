/**
 * shadcn-compatible DropdownMenu on @base-ui/react Menu.
 * FROZEN by Task A — later tasks import, never edit.
 */
import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import { Check, ChevronRight, Circle } from 'lucide-react'
import type * as React from 'react'
import { cn } from '@/lib/utils'

export const DropdownMenu = MenuPrimitive.Root

export const DropdownMenuTrigger = MenuPrimitive.Trigger

export const DropdownMenuPortal = MenuPrimitive.Portal

export const DropdownMenuGroup = MenuPrimitive.Group

export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup

export const DropdownMenuSub = MenuPrimitive.SubmenuRoot

const popupClasses =
  'z-[var(--z-dropdown)] min-w-[180px] overflow-y-auto rounded-lg border border-black/10 bg-surface-raised p-1 text-text-primary outline-none transition-opacity duration-150 ease-standard data-ending-style:opacity-0 data-starting-style:opacity-0 dark:border-border [box-shadow:var(--shadow-menu)]'

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  side,
  align,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Popup> & {
  sideOffset?: number
  side?: React.ComponentProps<typeof MenuPrimitive.Positioner>['side']
  align?: React.ComponentProps<typeof MenuPrimitive.Positioner>['align']
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        sideOffset={sideOffset}
        side={side}
        align={align}
        className="z-[var(--z-dropdown)]"
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(popupClasses, className)}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

const itemClasses =
  'flex h-8 cursor-pointer select-none items-center gap-2 rounded-sm px-2 text-copy outline-none transition-colors duration-150 data-highlighted:bg-hover data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0'

export function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Item> & {
  inset?: boolean
  variant?: 'default' | 'destructive'
}) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        itemClasses,
        inset && 'pl-8',
        variant === 'destructive' && 'text-danger data-highlighted:text-danger',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(itemClasses, 'pl-8', className)}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <MenuPrimitive.CheckboxItemIndicator>
          <Check size={16} aria-hidden="true" />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(itemClasses, 'pl-8', className)}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <MenuPrimitive.RadioItemIndicator>
          <Circle size={8} fill="currentColor" aria-hidden="true" />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

export function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.GroupLabel> & { inset?: boolean }) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      className={cn(
        'px-2 py-1.5 font-medium text-caption text-text-secondary',
        inset && 'pl-8',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  )
}

export function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn('ml-auto text-caption text-text-tertiary tracking-widest', className)}
      {...props}
    />
  )
}

export function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.SubmenuTrigger> & { inset?: boolean }) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      className={cn(itemClasses, 'data-popup-open:bg-hover', inset && 'pl-8', className)}
      {...props}
    >
      {children}
      <ChevronRight size={16} className="ml-auto" aria-hidden="true" />
    </MenuPrimitive.SubmenuTrigger>
  )
}

export function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Popup>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner sideOffset={2} className="z-[var(--z-dropdown)]">
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-sub-content"
          className={cn(popupClasses, className)}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}
