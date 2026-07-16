/**
 * Multi-select action bar (Task F). A fixed bottom-center pill shown while the selection
 * store holds ≥1 id. Bulk actions loop the (silent) mutations and push a SINGLE undo entry
 * that loops the inverse ops (spec §2.4 undo, v1 simplification). Schedule/Priority/Move
 * keep the selection; Complete/Delete clear it (their tasks leave the list).
 * FROZEN export (Task A): `MultiSelectToolbar`.
 */
import type { Due, Priority } from '@opendoist/core'
import { CalendarDays, CircleCheck, Flag, FolderInput, Trash2, X } from 'lucide-react'
import { type ReactElement, useMemo, useState } from 'react'
import { useActiveTasks, useTaskMutations } from '@/api/hooks/tasks'
import type { TaskMove } from '@/api/schemas'
import { buttonVariants } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useSelectionStore } from '@/stores/selection'
import { useUndoStore } from '@/stores/undo'
import { taskToCreate } from './more-menu'
import { MovePanel } from './move-popover'
import { PriorityMenu } from './priority-menu'
import { SchedulerPanel } from './scheduler-popover'

type OpenPopover = 'schedule' | 'priority' | 'move' | null

const countLabel = (n: number, verb: string): string => `${n} ${n === 1 ? 'task' : 'tasks'} ${verb}`

const triggerClass = cn(buttonVariants({ variant: 'ghost', size: 'sm' }))

export function MultiSelectToolbar(): ReactElement | null {
  const selectedIds = useSelectionStore((state) => state.selectedIds)
  const clearSelection = useSelectionStore((state) => state.clearSelection)
  const { data: tasks } = useActiveTasks()
  const { close, reopen, remove, update, move, create } = useTaskMutations()
  const pushUndo = useUndoStore((state) => state.push)
  const [openPopover, setOpenPopover] = useState<OpenPopover>(null)

  const selectedTasks = useMemo(
    () => (tasks ?? []).filter((task) => selectedIds.has(task.id)),
    [tasks, selectedIds],
  )

  const commonPriority = useMemo<Priority>(() => {
    const first = selectedTasks[0]
    return first && selectedTasks.every((task) => task.priority === first.priority)
      ? first.priority
      : 4
  }, [selectedTasks])

  const count = selectedIds.size
  if (count === 0) return null

  const applyComplete = (): void => {
    const snapshot = selectedTasks
    for (const task of snapshot) close.mutate({ id: task.id, silent: true })
    pushUndo(countLabel(snapshot.length, 'completed'), async () => {
      for (const task of snapshot) await reopen.mutateAsync({ id: task.id })
    })
    clearSelection()
  }

  const applyDelete = (): void => {
    const snapshot = selectedTasks
    for (const task of snapshot) remove.mutate({ id: task.id, silent: true })
    pushUndo(countLabel(snapshot.length, 'deleted'), async () => {
      for (const task of snapshot) await create.mutateAsync(taskToCreate(task))
    })
    clearSelection()
  }

  const applyPriority = (priority: Priority): void => {
    const snapshot = selectedTasks
    for (const task of snapshot) update.mutate({ id: task.id, patch: { priority }, silent: true })
    pushUndo(countLabel(snapshot.length, 'updated'), async () => {
      for (const task of snapshot)
        await update.mutateAsync({ id: task.id, patch: { priority: task.priority }, silent: true })
    })
    setOpenPopover(null)
  }

  const applySchedule = (due: Due | null): void => {
    const snapshot = selectedTasks
    for (const task of snapshot) update.mutate({ id: task.id, patch: { due }, silent: true })
    pushUndo(countLabel(snapshot.length, 'rescheduled'), async () => {
      for (const task of snapshot)
        await update.mutateAsync({ id: task.id, patch: { due: task.due }, silent: true })
    })
    setOpenPopover(null)
  }

  const applyMove = (to: TaskMove): void => {
    const snapshot = selectedTasks
    for (const task of snapshot) move.mutate({ id: task.id, to, silent: true })
    pushUndo(countLabel(snapshot.length, 'moved'), async () => {
      for (const task of snapshot)
        await move.mutateAsync({
          id: task.id,
          to: {
            project_id: task.project_id,
            section_id: task.section_id,
            parent_id: task.parent_id,
          },
          silent: true,
        })
    })
    setOpenPopover(null)
  }

  const setPopover = (kind: Exclude<OpenPopover, null>) => (open: boolean) =>
    setOpenPopover(open ? kind : null)

  return (
    <div
      role="toolbar"
      aria-label="Selected tasks"
      className="fixed bottom-6 left-1/2 z-[var(--z-toast)] flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-surface-raised px-2 py-1.5 [box-shadow:var(--shadow-toast)]"
    >
      <span className="px-2 font-medium text-copy text-text-primary">{count} selected</span>
      <div className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />

      <Popover open={openPopover === 'schedule'} onOpenChange={setPopover('schedule')}>
        <PopoverTrigger className={triggerClass}>
          <CalendarDays size={16} aria-hidden="true" />
          Schedule
        </PopoverTrigger>
        <PopoverContent side="top" align="center" className="w-[280px] p-2">
          <SchedulerPanel onPick={applySchedule} />
        </PopoverContent>
      </Popover>

      <Popover open={openPopover === 'priority'} onOpenChange={setPopover('priority')}>
        <PopoverTrigger className={triggerClass}>
          <Flag size={16} aria-hidden="true" />
          Priority
        </PopoverTrigger>
        <PopoverContent side="top" align="center" className="w-56 p-1">
          <PriorityMenu value={commonPriority} onPick={applyPriority} />
        </PopoverContent>
      </Popover>

      <Popover open={openPopover === 'move'} onOpenChange={setPopover('move')}>
        <PopoverTrigger className={triggerClass}>
          <FolderInput size={16} aria-hidden="true" />
          Move
        </PopoverTrigger>
        <PopoverContent side="top" align="center" className="w-72 p-1">
          <MovePanel onPick={applyMove} />
        </PopoverContent>
      </Popover>

      <button type="button" onClick={applyComplete} className={triggerClass}>
        <CircleCheck size={16} aria-hidden="true" />
        Complete
      </button>
      <button
        type="button"
        onClick={applyDelete}
        className={cn(triggerClass, 'text-danger hover:text-danger')}
      >
        <Trash2 size={16} aria-hidden="true" />
        Delete
      </button>

      <div className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
      <button
        type="button"
        aria-label="Clear selection"
        onClick={clearSelection}
        className={cn(triggerClass, 'px-1.5')}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
