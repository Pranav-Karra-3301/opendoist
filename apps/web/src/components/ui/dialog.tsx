/**
 * shadcn-compatible Dialog on @base-ui/react (the Radix registry output was replaced per
 * plan Task A Step 8 fallback — same export surface, OpenDoist tokens).
 * FROZEN by Task A — later tasks import, never edit.
 */
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import type * as React from 'react'
import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root

export const DialogTrigger = DialogPrimitive.Trigger

export const DialogPortal = DialogPrimitive.Portal

export const DialogClose = DialogPrimitive.Close

export function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Backdrop>) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-[var(--z-overlay)] bg-black/30 transition-opacity duration-150 ease-standard data-ending-style:opacity-0 data-starting-style:opacity-0',
        className,
      )}
      {...props}
    />
  )
}

export function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Popup> & { showCloseButton?: boolean }) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          '-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-[var(--z-modal)] grid w-full max-w-[512px] gap-4 rounded-lg bg-surface-raised p-6 text-text-primary outline-none transition-[opacity,transform] duration-150 ease-standard data-ending-style:opacity-0 data-starting-style:opacity-0 dark:border dark:border-border [box-shadow:var(--shadow-dialog)]',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            aria-label="Close"
            className="absolute top-3 right-3 flex size-7 cursor-pointer items-center justify-center rounded-sm text-text-secondary transition-colors duration-150 hover:bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]"
          >
            <X size={16} aria-hidden="true" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

export function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-1.5 text-left', className)}
      {...props}
    />
  )
}

export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-row items-center justify-end gap-2', className)}
      {...props}
    />
  )
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('font-medium text-subtitle text-text-primary', className)}
      {...props}
    />
  )
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-copy text-text-secondary', className)}
      {...props}
    />
  )
}
