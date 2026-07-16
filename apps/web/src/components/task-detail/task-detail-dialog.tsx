/**
 * Task detail dialog (Task H). Opens whenever the app route's `?task=<id>` search param is
 * set (the canonical deep link redirects `/task/$taskId` → `/today?task=<id>`), and clears
 * the param on close. Split layout: primary pane (1fr) + metadata sidebar (--detail-panel).
 * A task absent from the active-tasks cache (e.g. completed / deep-linked stale id) renders a
 * slim "Task not found" body.
 */
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useActiveTasks } from '@/api/hooks/tasks'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DetailMain } from './detail-main'
import { DetailSidebar } from './detail-sidebar'

export function TaskDetailDialog() {
  const search = useSearch({ strict: false })
  const taskId = search.task
  const navigate = useNavigate()
  const { data: tasks } = useActiveTasks()

  const open = taskId !== undefined
  const task = taskId !== undefined ? tasks?.find((t) => t.id === taskId) : undefined

  const close = () => {
    void navigate({ to: '.', search: (prev) => ({ ...prev, task: undefined }) })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      {open && (
        <DialogContent className="grid h-[min(640px,85vh)] w-[min(880px,90vw)] max-w-[min(880px,90vw)] grid-cols-[1fr_var(--detail-panel)] gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">Task details</DialogTitle>
          {task ? (
            <>
              <DetailMain task={task} onClose={close} />
              <DetailSidebar task={task} />
            </>
          ) : (
            <div className="col-span-2 flex items-center justify-center p-8 text-copy text-text-tertiary">
              {tasks === undefined ? 'Loading…' : 'Task not found'}
            </div>
          )}
        </DialogContent>
      )}
    </Dialog>
  )
}
