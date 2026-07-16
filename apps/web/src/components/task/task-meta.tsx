import { dateInTz } from '@opendoist/core'
import { CalendarDays, Clock, Flag, Repeat, Tag } from 'lucide-react'
import { useLabels } from '@/api/hooks/labels'
import { useProjects } from '@/api/hooks/projects'
import type { Task } from '@/api/schemas'
import { DUE_TONE_VAR, formatDueChip } from '@/lib/format-date'
import { useParseCtx } from '@/lib/parse-context'

export interface TaskMetaProps {
  task: Task
  showProject?: boolean
}

/** `berry_red` → `var(--od-palette-berry-red)`; unknown/blank falls back to grey. */
function paletteVar(color: string): string {
  return color === '' ? 'var(--od-palette-grey)' : `var(--od-palette-${color.replace(/_/g, '-')})`
}

function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h${rest}`
}

/**
 * The 12px meta line under a task's title: due chip (tone-colored, `Repeat` when
 * recurring), deadline, duration, label chips (palette-colored), and — when `showProject`
 * — a right-aligned project breadcrumb with its color dot. Renders nothing when the task
 * carries no metadata so rows stay one line.
 */
export function TaskMeta({ task, showProject }: TaskMetaProps) {
  const ctx = useParseCtx()
  const today = dateInTz(ctx.now, ctx.timezone)
  const projects = useProjects().data
  const labels = useLabels().data

  const due = task.due
  const project = showProject ? projects?.find((p) => p.id === task.project_id) : undefined
  const hasMeta =
    due !== null ||
    task.deadline_date !== null ||
    task.duration_min !== null ||
    task.labels.length > 0 ||
    project !== undefined
  if (!hasMeta) return null

  const dueChip = due === null ? null : formatDueChip(due, today)

  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-text-tertiary">
      {due !== null && dueChip !== null && (
        <span
          className="flex items-center gap-1"
          style={{ color: `var(${DUE_TONE_VAR[dueChip.tone]})` }}
        >
          <CalendarDays size={16} strokeWidth={2} />
          {dueChip.label}
          {due.recurrence !== null && <Repeat size={12} strokeWidth={2} />}
        </span>
      )}
      {task.deadline_date !== null && (
        <span className="flex items-center gap-1" style={{ color: 'var(--od-date-overdue)' }}>
          <Flag size={16} strokeWidth={2} />
          {formatDueChip({ date: task.deadline_date, time: null }, today).label}
        </span>
      )}
      {task.duration_min !== null && (
        <span className="flex items-center gap-1">
          <Clock size={16} strokeWidth={2} />
          {durationLabel(task.duration_min)}
        </span>
      )}
      {task.labels.map((name) => (
        <span
          key={name}
          className="flex items-center gap-1"
          style={{ color: paletteVar(labels?.find((l) => l.name === name)?.color ?? '') }}
        >
          <Tag size={12} strokeWidth={2} />
          {name}
        </span>
      ))}
      {project !== undefined && (
        <span className="ml-auto flex items-center gap-1.5">
          {project.name}
          <span
            aria-hidden="true"
            className="size-3 rounded-full"
            style={{ backgroundColor: paletteVar(project.color) }}
          />
        </span>
      )}
    </div>
  )
}
