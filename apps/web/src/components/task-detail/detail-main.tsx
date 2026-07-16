/**
 * Task-detail primary pane (Task H). Breadcrumb (project › section links), a big TaskCheckbox
 * + inline-editable content title, inline-editable description, the subtask list, and the
 * comments thread. Content/description edit in place: Cmd/Ctrl+Enter or blur saves via the
 * task update mutation, Esc reverts.
 */
import { Link } from '@tanstack/react-router'
import { ChevronRight, Inbox } from 'lucide-react'
import { type ComponentProps, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useProjects } from '@/api/hooks/projects'
import { useSections } from '@/api/hooks/sections'
import { useTaskMutations } from '@/api/hooks/tasks'
import type { Task } from '@/api/schemas'
import { TaskCheckbox } from '@/components/task/task-checkbox'
import { cn } from '@/lib/utils'
import { Comments } from './comments'
import { SubtaskList } from './subtask-list'

type GrowTextareaProps = {
  value: string
  onValueChange: (value: string) => void
} & Omit<ComponentProps<'textarea'>, 'value' | 'onChange' | 'ref'>

function GrowTextarea({ value, onValueChange, className, ...props }: GrowTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
  }, [value])
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      className={cn('w-full resize-none overflow-hidden bg-transparent outline-none', className)}
      {...props}
    />
  )
}

function Breadcrumb({ task }: { task: Task }) {
  const { data: projects } = useProjects()
  const { data: sections } = useSections()
  const project = projects?.find((p) => p.id === task.project_id)
  const section = sections?.find((s) => s.id === task.section_id)
  const linkCls =
    'inline-flex items-center gap-1 rounded-sm px-1 py-0.5 outline-none transition-colors duration-150 hover:bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]'

  return (
    <nav
      aria-label="Location"
      className="flex items-center gap-0.5 text-caption text-text-secondary"
    >
      {project?.is_inbox ? (
        <Link to="/inbox" className={linkCls}>
          <Inbox size={14} aria-hidden="true" />
          Inbox
        </Link>
      ) : (
        <Link to="/project/$projectId" params={{ projectId: task.project_id }} className={linkCls}>
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{
              backgroundColor: project
                ? `var(--od-palette-${project.color.replaceAll('_', '-')})`
                : 'var(--od-text-tertiary)',
            }}
            aria-hidden="true"
          />
          <span className="max-w-[220px] truncate">{project?.name ?? 'Project'}</span>
        </Link>
      )}
      {section && (
        <>
          <ChevronRight size={14} className="shrink-0 text-text-tertiary" aria-hidden="true" />
          <span className="max-w-[160px] truncate px-1">{section.name}</span>
        </>
      )}
    </nav>
  )
}

function EditableContent({ task }: { task: Task }) {
  const { update } = useTaskMutations()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.content)
  const completed = task.completed_at !== null

  useEffect(() => {
    if (!editing) setDraft(task.content)
  }, [task.content, editing])

  const commit = () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed !== '' && trimmed !== task.content) {
      update.mutate({ id: task.id, patch: { content: trimmed } })
    } else {
      setDraft(task.content)
    }
  }
  const cancel = () => {
    setDraft(task.content)
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cn(
          'w-full rounded-sm px-1 py-0.5 text-left font-medium text-subtitle text-text-primary outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]',
          completed && 'text-text-tertiary line-through',
        )}
      >
        {task.content === '' ? <span className="text-text-tertiary">Task name</span> : task.content}
      </button>
    )
  }
  return (
    <GrowTextarea
      value={draft}
      onValueChange={setDraft}
      autoFocus
      rows={1}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancel()
        }
      }}
      onBlur={commit}
      className="px-1 py-0.5 font-medium text-subtitle text-text-primary"
    />
  )
}

function EditableDescription({ task }: { task: Task }) {
  const { update } = useTaskMutations()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.description)

  useEffect(() => {
    if (!editing) setDraft(task.description)
  }, [task.description, editing])

  const commit = () => {
    setEditing(false)
    if (draft !== task.description) {
      update.mutate({ id: task.id, patch: { description: draft } })
    }
  }
  const cancel = () => {
    setDraft(task.description)
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-1 w-full rounded-sm px-1 py-0.5 text-left text-copy outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]"
      >
        {task.description === '' ? (
          <span className="text-text-tertiary">Description</span>
        ) : (
          <span className="whitespace-pre-wrap break-words text-text-secondary">
            {task.description}
          </span>
        )}
      </button>
    )
  }
  return (
    <GrowTextarea
      value={draft}
      onValueChange={setDraft}
      autoFocus
      rows={2}
      placeholder="Description"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancel()
        }
      }}
      onBlur={commit}
      className="mt-1 px-1 py-0.5 text-copy text-text-secondary placeholder:text-text-tertiary"
    />
  )
}

export function DetailMain({ task, onClose }: { task: Task; onClose: () => void }) {
  const { close, reopen } = useTaskMutations()
  const completed = task.completed_at !== null

  const onToggle = () => {
    if (completed) {
      reopen.mutate({ id: task.id })
    } else {
      close.mutate({ id: task.id })
      onClose()
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-col overflow-y-auto p-6">
      <Breadcrumb task={task} />
      <div className="mt-3 flex items-start gap-2">
        <div className="pt-1">
          <TaskCheckbox
            priority={task.priority}
            checked={completed}
            uncompletable={task.uncompletable}
            onToggle={onToggle}
          />
        </div>
        <div className="min-w-0 flex-1">
          <EditableContent task={task} />
          <EditableDescription task={task} />
        </div>
      </div>
      <div className="mt-6">
        <SubtaskList task={task} />
      </div>
      <div className="mt-8 border-border-subtle border-t pt-5">
        <Comments taskId={task.id} />
      </div>
    </div>
  )
}
