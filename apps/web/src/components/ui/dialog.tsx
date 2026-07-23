/**
 * shadcn-compatible Dialog on @base-ui/react (the Radix registry output was replaced per
 * plan Task A Step 8 fallback — same export surface, OpenTask tokens).
 * FROZEN by Task A — later tasks import, never edit.
 */
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import type * as React from 'react'
import { useState } from 'react'
import { playCue } from '@/lib/sound'
import { cn } from '@/lib/utils'

type DialogRootProps = React.ComponentProps<typeof DialogPrimitive.Root>

/** Root with audio cues: opening presses, closing releases (same export surface). */
export function Dialog({ onOpenChange, ...props }: DialogRootProps) {
  return (
    <DialogPrimitive.Root
      {...props}
      onOpenChange={(...args: Parameters<NonNullable<DialogRootProps['onOpenChange']>>) => {
        playCue(args[0] ? 'press' : 'release')
        onOpenChange?.(...args)
      }}
    />
  )
}

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

/**
 * Popup that restores focus to the element that was focused when the dialog opened.
 * App dialogs open from store state (hotkeys, row actions) rather than a Base UI
 * <DialogTrigger>, so Base UI has no trigger reference and would otherwise drop focus to
 * <body> on close (phase-10 a11y integration fix). The invoker is captured in a state
 * initializer: the popup mounts through the portal exactly when the dialog opens, before
 * Base UI moves focus inside. If the invoker is gone by close time (e.g. its row
 * unmounted), returning `true` falls back to Base UI's default restore chain.
 */
function RestoreFocusPopup(props: React.ComponentProps<typeof DialogPrimitive.Popup>) {
  const [invoker] = useState(() =>
    document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null,
  )
  return (
    <DialogPrimitive.Popup
      finalFocus={() => (invoker?.isConnected === true ? invoker : true)}
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
      <RestoreFocusPopup
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
            className="absolute top-3 right-3 flex size-7 cursor-pointer items-center justify-center rounded-sm text-text-secondary transition-colors duration-150 hover:bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-focus-ring)]"
          >
            <X size={16} aria-hidden="true" />
          </DialogPrimitive.Close>
        )}
      </RestoreFocusPopup>
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
