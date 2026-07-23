/**
 * shadcn-compatible Select on @base-ui/react.
 * FROZEN by Task A — later tasks import, never edit.
 *
 * Usage:
 *   <Select value={v} onValueChange={setV} items={items}>
 *     <SelectTrigger><SelectValue /></SelectTrigger>
 *     <SelectContent>
 *       <SelectItem value="a">A</SelectItem>
 *     </SelectContent>
 *   </Select>
 */
import { Select as SelectPrimitive } from '@base-ui/react/select'
import { Check, ChevronDown } from 'lucide-react'
import type * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Non-modal by default: our selects render inside popovers/dialogs (Display menu, Settings),
 * and Base UI's modal select stamps everything else — including its own host popover and
 * trigger — `data-base-ui-inert`, breaking pointer interaction checks. Callers may still pass
 * `modal` explicitly.
 */
export function Select<Value, Multiple extends boolean | undefined = false>(
  props: SelectPrimitive.Root.Props<Value, Multiple>,
) {
  return <SelectPrimitive.Root modal={false} {...props} />
}

export const SelectGroup = SelectPrimitive.Group

export const SelectValue = SelectPrimitive.Value

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        'flex h-8 cursor-pointer select-none items-center justify-between gap-2 rounded-sm border border-input-border bg-surface-raised px-3 text-copy text-text-primary outline-none transition-colors duration-150 ease-standard hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-focus-ring)] data-disabled:cursor-not-allowed data-disabled:opacity-60',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon>
        <ChevronDown size={16} className="text-text-secondary" aria-hidden="true" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

export function SelectContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Popup> & { sideOffset?: number }) {
  return (
    <SelectPrimitive.Portal>
      {/* alignItemWithTrigger=false: drop below the trigger like every other menu (the Base UI
          default overlays the trigger macOS-style, which also occludes it from pointer clicks
          mid-gesture — sideOffset only applies in this mode). z-popover, not z-dropdown: selects
          open from inside popovers (Display menu, z 100) and dialogs (Settings, z 90), and the
          popup must paint above its opener — equal z resolves by portal DOM order (opened last
          = on top). */}
      <SelectPrimitive.Positioner
        alignItemWithTrigger={false}
        sideOffset={sideOffset}
        className="z-[var(--z-popover)]"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            'max-h-[min(24rem,var(--available-height))] min-w-[var(--anchor-width)] overflow-y-auto rounded-lg border border-black/10 bg-surface-raised p-1 text-text-primary outline-none transition-opacity duration-150 ease-standard data-ending-style:opacity-0 data-starting-style:opacity-0 dark:border-border [box-shadow:var(--shadow-menu)]',
            className,
          )}
          {...props}
        />
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex h-8 cursor-pointer select-none items-center gap-2 rounded-sm pr-8 pl-2 text-copy outline-none transition-colors duration-150 data-highlighted:bg-hover data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="absolute right-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check size={16} aria-hidden="true" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  )
}

export function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.GroupLabel>) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn('px-2 py-1.5 font-medium text-caption text-text-secondary', className)}
      {...props}
    />
  )
}

export function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  )
}
