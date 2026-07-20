/**
 * Task "more" actions (Task F). Bare item list rendered inside the row popover. Owns its
 * own actions (navigate / duplicate / copy-link / delete) and closes the surface after
 * each. `taskToCreate` is shared with the multi-select toolbar's delete-undo path.
 */
import { useNavigate } from '@tanstack/react-router'
import { Copy, Link, ListTree, Pen, Trash2 } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTaskMutations } from '@/api/hooks/tasks'
import type { Task, TaskCreate } from '@/api/schemas'
import { toast } from '@/stores/toasts'

/** Project the durable fields of a task onto a create payload (Duplicate / restore-after-delete). */
export function taskToCreate(task: Task): TaskCreate {
  return {
    content: task.content,
    description: task.description,
    project_id: task.project_id,
    section_id: task.section_id,
    parent_id: task.parent_id,
    priority: task.priority,
    due: task.due,
    deadline_date: task.deadline_date,
    deadline_time: task.deadline_time ?? null,
    duration_min: task.duration_min,
    labels: task.labels,
    uncompletable: task.uncompletable,
  }
}

export interface MoreMenuItemsProps {
  task: Task
  /** Dismiss the containing popover after an action runs. */
  onClose: () => void
}

const ITEM_CLASS =
  'flex h-8 w-full items-center gap-2.5 rounded-sm px-2 text-left text-copy text-text-primary transition-colors duration-150 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none'

export function MoreMenuItems({ task, onClose }: MoreMenuItemsProps): ReactElement {
  const navigate = useNavigate()
  const { create, remove } = useTaskMutations()

  const openDetail = (): void => {
    void navigate({ to: '/task/$taskId', params: { taskId: task.id } })
    onClose()
  }

  const duplicate = (): void => {
    create.mutate(taskToCreate(task))
    onClose()
  }

  const copyLink = (): void => {
    void navigator.clipboard?.writeText(`${window.location.origin}/task/${task.id}`)
    toast.info('Link copied')
    onClose()
  }

  const deleteTask = (): void => {
    remove.mutate({ id: task.id })
    onClose()
  }

  return (
    <div role="menu" className="flex flex-col">
      <button type="button" role="menuitem" onClick={openDetail} className={ITEM_CLASS}>
        <Pen size={16} className="shrink-0 text-text-secondary" aria-hidden />
        <span>Edit</span>
      </button>
      <button type="button" role="menuitem" onClick={openDetail} className={ITEM_CLASS}>
        <ListTree size={16} className="shrink-0 text-text-secondary" aria-hidden />
        <span>Add subtask</span>
      </button>
      <button type="button" role="menuitem" onClick={duplicate} className={ITEM_CLASS}>
        <Copy size={16} className="shrink-0 text-text-secondary" aria-hidden />
        <span>Duplicate</span>
      </button>
      <button type="button" role="menuitem" onClick={copyLink} className={ITEM_CLASS}>
        <Link size={16} className="shrink-0 text-text-secondary" aria-hidden />
        <span>Copy link</span>
      </button>
      <div className="-mx-1 my-1 h-px bg-border" aria-hidden="true" />
      <button
        type="button"
        role="menuitem"
        onClick={deleteTask}
        className="flex h-8 w-full items-center gap-2.5 rounded-sm px-2 text-left text-copy text-danger transition-colors duration-150 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
      >
        <Trash2 size={16} className="shrink-0" aria-hidden />
        <span>Delete</span>
      </button>
    </div>
  )
}
