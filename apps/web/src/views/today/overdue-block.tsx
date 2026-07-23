/**
 * Overdue block — a section listing every active task whose due date is before today,
 * with a "Reschedule" action that bulk-moves all of them to a chosen date.
 *
 * FROZEN export (plan Task J): `OverdueBlock({ tasks }: { tasks: Task[] })`. Task K
 * (Upcoming) imports this same component. `tasks` is a view's active-task slice; the
 * block re-derives `overdue()` itself and renders nothing when empty.
 *
 * The reschedule picker is self-contained (Base UI Popover + core natural-language date
 * resolution) instead of importing Task F's shared `SchedulerPanel`, so this file
 * typechecks on its own before Task F lands; Gate R may swap in the shared panel.
 * Applying a date replaces each task's `due.date` while preserving its time / recurrence
 * / string, and pushes ONE "Rescheduled {n} tasks" undo entry — every write is `silent`
 * so Task B's per-write undo wiring stays quiet and only the single bulk entry appears.
 */

import type { Due, ParseContext } from '@opentask/core'
import {
  addDaysIso,
  dateInTz,
  isoWeekday,
  nextWeekdayOnOrAfter,
  resolveNaturalDate,
} from '@opentask/core'
import { Armchair, Ban, CalendarArrowUp, CalendarClock, CalendarDays, Sun } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { useTaskMutations } from '@/api/hooks/tasks'
import type { Task } from '@/api/schemas'
import { TaskList } from '@/components/task/task-list'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useUndoStore } from '@/features/undo/store'
import { activeTasks, overdue } from '@/lib/derive'
import { useParseCtx } from '@/lib/parse-context'
import { cn } from '@/lib/utils'

const MONTH_ABBREV = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]
/** indexed by `isoWeekday(iso) - 1` (1 = Monday … 7 = Sunday) */
const WEEKDAY_ABBREV = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function weekdayAbbrev(iso: string): string {
  return WEEKDAY_ABBREV[isoWeekday(iso) - 1] ?? ''
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return `${MONTH_ABBREV[d.getUTCMonth()] ?? ''} ${d.getUTCDate()}`
}

/** Overdue first by due date, then by time (all-day before timed), then stable by id. */
function sortByDue(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const ad = a.due?.date ?? ''
    const bd = b.due?.date ?? ''
    if (ad !== bd) return ad < bd ? -1 : 1
    const at = a.due?.time ?? ''
    const bt = b.due?.time ?? ''
    if (at !== bt) return at < bt ? -1 : 1
    return a.id.localeCompare(b.id)
  })
}

export function OverdueBlock({ tasks }: { tasks: Task[] }) {
  const ctx = useParseCtx()
  const today = dateInTz(ctx.now, ctx.timezone)
  const overdueTasks = sortByDue(overdue(activeTasks(tasks), today))
  const { update } = useTaskMutations()
  const pushUndo = useUndoStore((s) => s.push)
  const [open, setOpen] = useState(false)
  const headingId = useId()

  if (overdueTasks.length === 0) return null

  const rescheduleAll = (target: string | null): void => {
    const restores: Array<{ id: string; due: Due | null }> = []
    for (const t of overdueTasks) {
      if (t.due === null) continue
      restores.push({ id: t.id, due: t.due })
      const nextDue: Due | null = target === null ? null : { ...t.due, date: target }
      update.mutate({ id: t.id, patch: { due: nextDue }, silent: true })
    }
    if (restores.length > 0) {
      const n = restores.length
      pushUndo({
        message: `Rescheduled ${n} ${n === 1 ? 'task' : 'tasks'}`,
        undo: async () => {
          await Promise.all(
            restores.map((r) =>
              update.mutateAsync({ id: r.id, patch: { due: r.due }, silent: true }),
            ),
          )
        },
      })
    }
    setOpen(false)
  }

  return (
    <section aria-labelledby={headingId} className="mb-5">
      <div className="flex items-center justify-between border-border-subtle border-b py-2">
        <h2 id={headingId} className="font-medium text-body text-text-primary">
          Overdue
        </h2>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            aria-label="Reschedule all overdue tasks"
            className={cn(buttonVariants({ variant: 'link', size: 'sm' }))}
          >
            Reschedule
          </PopoverTrigger>
          <PopoverContent align="end" className="p-2">
            <ReschedulePanel today={today} ctx={ctx} onPick={rescheduleAll} />
          </PopoverContent>
        </Popover>
      </div>
      <TaskList tasks={overdueTasks} groupId="overdue" showProject />
    </section>
  )
}

const PRESET_ROW =
  'flex h-8 w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 text-copy text-text-primary outline-none transition-colors duration-150 ease-standard hover:bg-hover focus-visible:bg-hover [&_svg]:shrink-0'

interface PresetDef {
  key: string
  label: string
  icon: ReactNode
  date: string | null
}

/**
 * Scheduler content reused for the bulk reschedule: a natural-language input (live
 * preview via core `resolveNaturalDate`) plus the standard preset rows. `onPick(null)`
 * clears the due; every other pick supplies a target calendar date.
 */
function ReschedulePanel({
  today,
  ctx,
  onPick,
}: {
  today: string
  ctx: ParseContext
  onPick: (target: string | null) => void
}) {
  const [text, setText] = useState('')
  const trimmed = text.trim()
  const resolved = trimmed.length > 0 ? resolveNaturalDate(trimmed, ctx) : null

  const presets: PresetDef[] = [
    { key: 'today', label: 'Today', icon: <CalendarDays size={16} />, date: today },
    { key: 'tomorrow', label: 'Tomorrow', icon: <Sun size={16} />, date: addDaysIso(today, 1) },
    {
      key: 'next-week',
      label: 'Next week',
      icon: <CalendarArrowUp size={16} />,
      date: nextWeekdayOnOrAfter(today, ctx.nextWeekDay, false),
    },
    {
      key: 'next-weekend',
      label: 'Next weekend',
      icon: <Armchair size={16} />,
      date: nextWeekdayOnOrAfter(today, ctx.weekendDay, false),
    },
    { key: 'no-date', label: 'No date', icon: <Ban size={16} />, date: null },
  ]

  return (
    <div className="flex flex-col gap-0.5">
      <Input
        autoFocus
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && resolved !== null) {
            e.preventDefault()
            onPick(resolved.date)
          }
        }}
        placeholder="Type a date…"
        aria-label="Reschedule overdue tasks to"
      />
      {resolved !== null && (
        <button
          type="button"
          className={cn(PRESET_ROW, 'mt-0.5 text-accent')}
          onClick={() => onPick(resolved.date)}
        >
          <CalendarClock size={16} />
          <span className="flex-1 text-left">
            {weekdayAbbrev(resolved.date)}, {shortDate(resolved.date)}
          </span>
        </button>
      )}
      <div className="my-1 h-px bg-border" />
      {presets.map((p) => (
        <button key={p.key} type="button" className={PRESET_ROW} onClick={() => onPick(p.date)}>
          <span className="text-text-secondary">{p.icon}</span>
          <span className="flex-1 text-left">{p.label}</span>
          {p.date !== null && (
            <span className="text-caption text-text-tertiary">{weekdayAbbrev(p.date)}</span>
          )}
        </button>
      ))}
    </div>
  )
}
