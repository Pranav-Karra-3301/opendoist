/**
 * Destructive-action confirmations for projects and sections (Task F). Opened via
 * `useDialogStore` with `{ kind: 'project-archive' | 'project-delete' | 'section-delete' }`.
 * Each confirmed action fires its mutation, invalidates the affected caches, and pushes a
 * single-slot undo entry (`useUndoStore`) whose inverse restores prior state:
 *   - archive  → POST /projects/:id/unarchive
 *   - delete   → restoreEntity('projects', id)   (soft-delete + restore route, Task B)
 *   - section  → restoreEntity('sections', id)
 * Projects with more than {@link DELETE_CONFIRM_THRESHOLD} active tasks require the user to
 * type the exact project name before Delete enables.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { type ReactNode, useState } from 'react'
import { type ApiError, api, apiVoid, endpoints } from '@/api/client'
import { useProjects } from '@/api/hooks/projects'
import { useSections } from '@/api/hooks/sections'
import { useActiveTasks } from '@/api/hooks/tasks'
import { qk } from '@/api/keys'
import { ProjectSchema } from '@/api/schemas'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useUndoStore } from '@/features/undo/store'
import { restoreEntity } from '@/lib/api/phase5'
import { toast } from '@/stores/toasts'
import { type DialogRequest, useDialogStore } from './store'

/** Above this many active tasks, deleting a project requires type-to-confirm. */
export const DELETE_CONFIRM_THRESHOLD = 10

export function countActiveTasksInProject(
  tasks: ReadonlyArray<{ project_id: string }>,
  projectId: string,
): number {
  let n = 0
  for (const t of tasks) if (t.project_id === projectId) n++
  return n
}

export function requiresNameConfirm(taskCount: number): boolean {
  return taskCount > DELETE_CONFIRM_THRESHOLD
}

export function nameConfirmSatisfied(typed: string, actual: string): boolean {
  const target = actual.trim()
  return target !== '' && typed.trim() === target
}

type ConfirmReq = Extract<
  DialogRequest,
  { kind: 'project-archive' | 'project-delete' | 'section-delete' }
>

function isConfirmReq(r: DialogRequest | null): r is ConfirmReq {
  return (
    r !== null &&
    (r.kind === 'project-archive' || r.kind === 'project-delete' || r.kind === 'section-delete')
  )
}

const FIELD_LABEL = 'font-medium text-caption text-text-secondary'

function ConfirmBody({ req, onClose }: { req: ConfirmReq; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: projects } = useProjects()
  const { data: tasks } = useActiveTasks()
  const { data: sections } = useSections()
  const [confirmText, setConfirmText] = useState('')
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  /** Archiving/deleting the project you are looking at navigates home (Task X gate wiring —
   *  preserves the phase-4 behavior the direct delete in the project header used to have). */
  const leaveIfViewing = (projectId: string): void => {
    if (pathname === `/project/${projectId}`) void navigate({ to: '/today' })
  }

  const invalidateAll = (): Promise<unknown> =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.projects }),
      qc.invalidateQueries({ queryKey: qk.tasks }),
      qc.invalidateQueries({ queryKey: qk.sections }),
    ])
  const invalidateProjectViews = (): Promise<unknown> =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.projects }),
      qc.invalidateQueries({ queryKey: qk.tasks }),
    ])

  const archive = useMutation<unknown, ApiError, { id: string }>({
    mutationFn: ({ id }) =>
      api(`${endpoints.project(id)}/archive`, { method: 'POST', schema: ProjectSchema }),
    onSuccess: (_data, { id }) => {
      void invalidateProjectViews()
      useUndoStore.getState().push({
        message: 'Project archived',
        undo: async () => {
          await apiVoid(`${endpoints.project(id)}/unarchive`, { method: 'POST' })
          await invalidateProjectViews()
        },
      })
      leaveIfViewing(id)
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })

  const removeProject = useMutation<void, ApiError, { id: string }>({
    mutationFn: ({ id }) => apiVoid(endpoints.project(id), { method: 'DELETE' }),
    onSuccess: (_data, { id }) => {
      void invalidateAll()
      useUndoStore.getState().push({
        message: 'Project deleted',
        undo: async () => {
          await restoreEntity('projects', id)
          await invalidateAll()
        },
      })
      leaveIfViewing(id)
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })

  const removeSection = useMutation<void, ApiError, { id: string }>({
    mutationFn: ({ id }) => apiVoid(endpoints.section(id), { method: 'DELETE' }),
    onSuccess: (_data, { id }) => {
      void invalidateProjectViews()
      void qc.invalidateQueries({ queryKey: qk.sections })
      useUndoStore.getState().push({
        message: 'Section deleted',
        undo: async () => {
          await restoreEntity('sections', id)
          await qc.invalidateQueries({ queryKey: qk.sections })
          await qc.invalidateQueries({ queryKey: qk.tasks })
        },
      })
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })

  if (req.kind === 'project-archive') {
    const name = projects?.find((p) => p.id === req.projectId)?.name ?? 'this project'
    return (
      <ConfirmLayout
        title={`Archive ${name}?`}
        description="Its tasks stay but leave your active views. You can unarchive it anytime."
        confirmLabel="Archive"
        variant="default"
        isPending={archive.isPending}
        onConfirm={() => archive.mutate({ id: req.projectId })}
        onClose={onClose}
      />
    )
  }

  if (req.kind === 'project-delete') {
    const name = projects?.find((p) => p.id === req.projectId)?.name ?? 'this project'
    const taskCount = countActiveTasksInProject(tasks ?? [], req.projectId)
    const needsConfirm = requiresNameConfirm(taskCount)
    const blocked = needsConfirm && !nameConfirmSatisfied(confirmText, name)
    return (
      <ConfirmLayout
        title={`Delete ${name}?`}
        description="Its sections and tasks will be deleted too. You can undo right after."
        confirmLabel="Delete"
        variant="destructive"
        isPending={removeProject.isPending}
        disabled={blocked}
        onConfirm={() => removeProject.mutate({ id: req.projectId })}
        onClose={onClose}
      >
        {needsConfirm ? (
          <div className="grid gap-1.5">
            <label htmlFor="delete-confirm" className={FIELD_LABEL}>
              This project has {taskCount} tasks. Type{' '}
              <span className="font-semibold text-text-primary">{name}</span> to confirm.
            </label>
            <Input
              id="delete-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={name}
              autoFocus
            />
          </div>
        ) : null}
      </ConfirmLayout>
    )
  }

  const name = sections?.find((s) => s.id === req.sectionId)?.name ?? 'this section'
  return (
    <ConfirmLayout
      title={`Delete ${name}?`}
      description="Tasks in this section stay in the project; only the section is removed. You can undo right after."
      confirmLabel="Delete"
      variant="destructive"
      isPending={removeSection.isPending}
      onConfirm={() => removeSection.mutate({ id: req.sectionId })}
      onClose={onClose}
    />
  )
}

function ConfirmLayout({
  title,
  description,
  confirmLabel,
  variant,
  isPending,
  disabled,
  onConfirm,
  onClose,
  children,
}: {
  title: string
  description: string
  confirmLabel: string
  variant: 'default' | 'destructive'
  isPending: boolean
  disabled?: boolean
  onConfirm: () => void
  onClose: () => void
  children?: ReactNode
}) {
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {children}
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant={variant} onClick={onConfirm} disabled={disabled || isPending}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </div>
  )
}

export default function ProjectConfirms() {
  const req = useDialogStore((s) => s.open)
  const close = useDialogStore((s) => s.close)
  const confirmReq = isConfirmReq(req) ? req : null
  const open = confirmReq !== null
  const reqKey = confirmReq
    ? `${confirmReq.kind}:${confirmReq.kind === 'section-delete' ? confirmReq.sectionId : confirmReq.projectId}`
    : 'none'

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      {open && confirmReq ? (
        <DialogContent className="max-w-[440px]">
          <ConfirmBody key={reqKey} req={confirmReq} onClose={close} />
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
