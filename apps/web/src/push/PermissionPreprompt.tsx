/**
 * Double-opt-in pre-prompt (phase 6, Task K). Presentational: the host `PushPrompts`
 * (push/index.tsx) owns open/close state and wires `onEnable` to `subscribeToPush()`, so
 * the Enable click stays synchronous with the native permission request. Shown at the
 * first-reminder moment and from the Notifications settings page.
 */
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function PermissionPreprompt({
  open,
  busy,
  onEnable,
  onDismiss,
}: {
  open: boolean
  busy: boolean
  onEnable: () => void
  onDismiss: () => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss()
      }}
    >
      {open ? (
        <DialogContent showCloseButton={false} className="max-w-[400px]">
          <DialogHeader>
            <div className="mb-1 flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Bell size={20} aria-hidden="true" />
            </div>
            <DialogTitle>Get notified when reminders fire</DialogTitle>
            <DialogDescription>
              OpenDoist can push a notification the moment a task reminder is due — even while this
              tab sits in the background. You can turn it off anytime in Settings.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={onDismiss} disabled={busy}>
              Not now
            </Button>
            <Button onClick={onEnable} disabled={busy}>
              <Bell size={15} aria-hidden="true" />
              Enable notifications
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
