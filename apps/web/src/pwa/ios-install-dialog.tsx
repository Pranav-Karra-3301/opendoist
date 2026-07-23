/**
 * iOS "Add to Home Screen" dialog (phase 10, Task C) — the general install affordance for
 * iPhone/iPad, where there is no `beforeinstallprompt` and installing is a manual Safari
 * Share-sheet flow. Distinct from the phase-6 push-permission `IosInstallScreen` (that one
 * is triggered by setting a reminder); this one is the app's "Install OpenTask" button.
 *
 * Uses the frozen `Dialog` primitive (Base UI) — it provides the focus trap + restore, Esc,
 * `role="dialog"` and `aria-labelledby` wiring, so no manual a11y plumbing is needed here.
 *
 * Rendered by `PwaProvider`, which sits ABOVE the router, so this component intentionally
 * uses no router-context APIs (e.g. `Link`) — the Settings pointer is plain emphasis text.
 */
import { Download, type LucideIcon, Plus, Share, SquarePlus } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

function Step({
  index,
  icon: Icon,
  children,
}: {
  index: number
  icon: LucideIcon
  children: ReactNode
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft font-medium text-accent text-caption">
        {index}
      </span>
      <span className="flex min-w-0 flex-1 items-start gap-2 text-copy text-text-primary">
        <Icon size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-text-secondary" />
        <span>{children}</span>
      </span>
    </li>
  )
}

export function IosInstallDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      {open ? (
        <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-[420px] overflow-y-auto">
          <DialogHeader>
            <div className="mb-1 flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Download size={20} aria-hidden="true" />
            </div>
            <DialogTitle>Install OpenTask on iPhone or iPad</DialogTitle>
            <DialogDescription>
              Add OpenTask to your Home Screen to launch it like a native app:
            </DialogDescription>
          </DialogHeader>

          <ol className="grid gap-3">
            <Step index={1} icon={Share}>
              Tap the <span className="font-medium text-text-primary">Share</span> button in
              Safari's toolbar.
            </Step>
            <Step index={2} icon={SquarePlus}>
              Scroll and tap{' '}
              <span className="font-medium text-text-primary">Add to Home Screen</span>.
            </Step>
            <Step index={3} icon={Plus}>
              Tap <span className="font-medium text-text-primary">Add</span>.
            </Step>
          </ol>

          <p className="rounded-lg border border-border bg-surface p-3 text-copy text-text-secondary">
            Push notifications on iOS (16.4+) only work after installing to the Home Screen. If you
            can't install, the ntfy channel in{' '}
            <span className="font-medium text-text-primary">Settings → Notifications</span> is a
            reliable alternative.
          </p>

          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
