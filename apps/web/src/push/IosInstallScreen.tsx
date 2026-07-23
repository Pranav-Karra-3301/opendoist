/**
 * iOS "install to Home Screen" guide (phase 6, Task K). Presentational sheet shown when a
 * reminder is set on iPhone/iPad Safari, where the Push API only exists once the app is
 * installed to the Home Screen (dossier §5.2). Offers ntfy as a no-install fallback.
 */
import { Link } from '@tanstack/react-router'
import { Bell, type LucideIcon, Share, SquarePlus } from 'lucide-react'
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

export function IosInstallScreen({ open, onClose }: { open: boolean; onClose: () => void }) {
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
              <Bell size={20} aria-hidden="true" />
            </div>
            <DialogTitle>Install OpenTask to get reminders</DialogTitle>
            <DialogDescription>
              On iPhone and iPad, push notifications work only when OpenTask is added to your Home
              Screen. It takes a few seconds:
            </DialogDescription>
          </DialogHeader>

          <ol className="grid gap-3">
            <Step index={1} icon={Share}>
              Tap the <span className="font-medium text-text-primary">Share</span> button in the
              Safari toolbar.
            </Step>
            <Step index={2} icon={SquarePlus}>
              Scroll down and choose{' '}
              <span className="font-medium text-text-primary">Add to Home Screen</span>.
            </Step>
            <Step index={3} icon={Bell}>
              Open OpenTask from its new Home Screen icon, then turn on notifications here in
              Settings.
            </Step>
          </ol>

          <p className="rounded-lg border border-border bg-surface p-3 text-copy text-text-secondary">
            Prefer not to install? You can still get reminders on this device through an{' '}
            <Link
              to="/settings/$page"
              params={{ page: 'notifications' }}
              onClick={onClose}
              className="font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-focus-ring)]"
            >
              ntfy notification channel
            </Link>{' '}
            instead.
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
