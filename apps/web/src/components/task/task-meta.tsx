import { dateInTz } from '@opendoist/core'
import { CalendarDays, Clock, Flag, Repeat, Tag } from 'lucide-react'
import { useLabels } from '@/api/hooks/labels'
import { useProjects } from '@/api/hooks/projects'
import type { Task } from '@/api/schemas'
import { DUE_TONE_VAR, type DueTone, formatDueChip } from '@/lib/format-date'
import { useParseCtx } from '@/lib/parse-context'

export interface TaskMetaProps {
  task: Task
  showProject?: boolean
  /**
   * ISO date implied by the surrounding view (Today → today; an Upcoming day → that day).
   * A due chip whose date matches it is redundant with the view's own heading, so it is
   * suppressed — the time (if any) still shows; overdue/other-day dates always show.
   */
  hideDueChipWhen?: string
}

/**
 * The due chip to paint, with the view's implied date suppressed: when `due.date` equals
 * `hideDueChipWhen` the redundant date word is dropped — a timed due keeps just its time
 * (`Today 4pm` → `4pm`), an all-day due hides entirely (null). Every other due (overdue,
 * another day, or no implied date) renders the normal {@link formatDueChip} label. Pure so
 * it is unit-tested directly.
 */
export function contextualDueChip(
  due: { date: string; time: string | null },
  todayIso: string,
  hideDueChipWhen: string | undefined,
): { label: string; tone: DueTone } | null {
  const chip = formatDueChip(due, todayIso)
  if (hideDueChipWhen === undefined || due.date !== hideDueChipWhen) return chip
  if (due.time === null) return null
  // format-date's `timeLabel` isn't exported (and format-date.ts is out of this file set),
  // so recover the time-only suffix from the two canonical chips instead of duplicating the
  // formatter: the full label joins date + time with a single space (`Today 4pm`), so the
  // time starts one char past the date-only label (`Today`).
  const dateOnly = formatDueChip({ date: due.date, time: null }, todayIso).label
  const timeOnly = chip.label.startsWith(`${dateOnly} `)
    ? chip.label.slice(dateOnly.length + 1)
    : chip.label
  return { label: timeOnly, tone: chip.tone }
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
export function TaskMeta({ task, showProject, hideDueChipWhen }: TaskMetaProps) {
  const ctx = useParseCtx()
  const today = dateInTz(ctx.now, ctx.timezone)
  const projects = useProjects().data
  const labels = useLabels().data

  const due = task.due
  const project = showProject ? projects?.find((p) => p.id === task.project_id) : undefined
  const dueChip = due === null ? null : contextualDueChip(due, today, hideDueChipWhen)
  const hasMeta =
    dueChip !== null ||
    task.deadline_date !== null ||
    task.duration_min !== null ||
    task.labels.length > 0 ||
    project !== undefined
  if (!hasMeta) return null

  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-text-tertiary">
      {dueChip !== null && (
        <span
          className="flex items-center gap-1"
          style={{ color: `var(${DUE_TONE_VAR[dueChip.tone]})` }}
        >
          <CalendarDays size={16} strokeWidth={2} />
          {dueChip.label}
          {due?.recurrence != null && <Repeat size={12} strokeWidth={2} />}
        </span>
      )}
      {task.deadline_date !== null && (
        <span className="flex items-center gap-1" style={{ color: 'var(--od-date-overdue)' }}>
          <Flag size={16} strokeWidth={2} />
          {
            formatDueChip({ date: task.deadline_date, time: task.deadline_time ?? null }, today)
              .label
          }
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
          // Palette values are tuned as fills; painted as 12px TEXT the pale ones (teal,
          // mint, yellow, grey) fall under the WCAG AA 4.5:1 floor. Mixing in 35% of the
          // theme's primary text color deepens them in light and lifts them in dark, so
          // every palette clears AA on all scan surfaces (worst light case: grey 4.53:1
          // on --od-hover). Phase-10 a11y integration fix.
          style={{
            color: `color-mix(in srgb, ${paletteVar(labels?.find((l) => l.name === name)?.color ?? '')} 65%, var(--od-text-primary))`,
          }}
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
