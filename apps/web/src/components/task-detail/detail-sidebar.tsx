/**
 * Task-detail metadata panel (Task H). Stacked fields — Project, Date, Deadline, Priority,
 * Labels, Duration — each showing the current value or a "+ Add …" ghost and opening an
 * inline editor. Built self-contained on the frozen ui primitives + mutation hooks + core
 * parsing rather than importing Task F's row popovers: SchedulerPanel / PriorityMenu prop
 * shapes are not frozen in the plan, so a self-contained panel keeps this task decoupled and
 * independently correct. (Deviation recorded for Gate R — same UX; Task F pieces may be
 * swapped in later.)
 */
import {
  addDaysIso,
  type Due,
  dateInTz,
  nextWeekdayOnOrAfter,
  type Priority,
  parseQuickAdd,
  resolveNaturalDate,
} from '@opendoist/core'
import { Calendar, Check, Clock, Flag, Hash, Plus, Repeat, Tag, Target } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useLabelMutations, useLabels } from '@/api/hooks/labels'
import { useProjects } from '@/api/hooks/projects'
import { useSections } from '@/api/hooks/sections'
import { useTaskMutations } from '@/api/hooks/tasks'
import type { Task } from '@/api/schemas'
import { priorityOptionLabel } from '@/components/task/priority-menu'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { DUE_TONE_VAR, formatDueChip } from '@/lib/format-date'
import { useParseCtx } from '@/lib/parse-context'
import { cn } from '@/lib/utils'

const PRIORITIES: Priority[] = [1, 2, 3, 4]
const PRIORITY_VAR: Record<Priority, string> = {
  1: '--od-p1',
  2: '--od-p2',
  3: '--od-p3',
  4: '--od-p4',
}
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

const fieldTriggerCls =
  'flex w-full items-center gap-1.5 rounded-sm px-1 py-1 text-left text-copy text-text-primary outline-none transition-colors duration-150 hover:bg-hover focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]'
const menuItemCls =
  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-copy text-text-primary outline-none transition-colors duration-150 hover:bg-hover focus-visible:bg-hover'

/** `berry_red` → `var(--od-palette-berry-red)`; falls back to the tertiary text colour. */
function paletteVar(color: string | undefined): string {
  return color ? `var(--od-palette-${color.replaceAll('_', '-')})` : 'var(--od-text-tertiary)'
}

function weekdayHint(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? '' : (DAY_SHORT[d.getUTCDay()] ?? '')
}

function ColorDot({ color }: { color: string | undefined }) {
  return (
    <span
      className="size-3 shrink-0 rounded-full"
      style={{ backgroundColor: paletteVar(color) }}
      aria-hidden="true"
    />
  )
}

function PriorityFlag({ priority, size = 16 }: { priority: Priority; size?: number }) {
  if (priority === 4) return <Flag size={size} className="text-text-tertiary" aria-hidden="true" />
  return (
    <Flag
      size={size}
      fill="currentColor"
      style={{ color: `var(${PRIORITY_VAR[priority]})` }}
      aria-hidden="true"
    />
  )
}

function Field({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-border-subtle border-b px-3 py-3 last:border-b-0">
      <span className="flex items-center gap-1.5 text-caption text-text-tertiary">
        {icon}
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function ProjectField({ task }: { task: Task }) {
  const { data: projects } = useProjects()
  const { data: sections } = useSections()
  const { move } = useTaskMutations()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const current = projects?.find((p) => p.id === task.project_id)
  const currentSection = sections?.find((s) => s.id === task.section_id)

  const q = query.trim().toLowerCase()
  const visibleProjects = (projects ?? [])
    .filter((p) => !p.is_archived && (q === '' || p.name.toLowerCase().includes(q)))
    .sort((a, b) => a.child_order - b.child_order || a.name.localeCompare(b.name))

  const pick = (projectId: string, sectionId: string | null) => {
    move.mutate({ id: task.id, to: { project_id: projectId, section_id: sectionId } })
    setOpen(false)
    setQuery('')
  }

  return (
    <Field icon={<Hash size={16} aria-hidden="true" />} label="Project">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className={fieldTriggerCls}>
          <ColorDot color={current?.color} />
          <span className="truncate">
            {current ? (current.is_inbox ? 'Inbox' : current.name) : 'Project'}
            {currentSection ? ` / ${currentSection.name}` : ''}
          </span>
        </PopoverTrigger>
        <PopoverContent align="end" aria-label="Move task to project" className="w-64 p-0">
          <div className="border-border-subtle border-b p-2">
            <Input
              value={query}
              autoFocus
              aria-label="Move to project"
              placeholder="Move to…"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <ScrollArea className="max-h-64">
            <div className="p-1">
              {visibleProjects.map((project) => {
                const projectSections = (sections ?? [])
                  .filter((s) => s.project_id === project.id && !s.is_archived)
                  .sort((a, b) => a.section_order - b.section_order)
                return (
                  <div key={project.id}>
                    <button
                      type="button"
                      className={menuItemCls}
                      onClick={() => pick(project.id, null)}
                    >
                      <ColorDot color={project.color} />
                      <span className="truncate">{project.is_inbox ? 'Inbox' : project.name}</span>
                      {task.project_id === project.id && task.section_id === null && (
                        <Check size={16} className="ml-auto shrink-0" aria-hidden="true" />
                      )}
                    </button>
                    {projectSections.map((section) => (
                      <button
                        key={section.id}
                        type="button"
                        className={cn(menuItemCls, 'pl-8')}
                        onClick={() => pick(project.id, section.id)}
                      >
                        <span className="truncate text-text-secondary">{section.name}</span>
                        {task.section_id === section.id && (
                          <Check size={16} className="ml-auto shrink-0" aria-hidden="true" />
                        )}
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </Field>
  )
}

function DateField({ task }: { task: Task }) {
  const { update } = useTaskMutations()
  const ctx = useParseCtx()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const today = dateInTz(ctx.now, ctx.timezone)

  const preview = ((): { date: string; time: string | null } | null => {
    const t = text.trim()
    if (t === '') return null
    if (/^every\b/i.test(t)) {
      const due = parseQuickAdd(t, ctx).due
      return due ? { date: due.date, time: due.time } : null
    }
    return resolveNaturalDate(t, ctx)
  })()

  const applyDue = (due: Due | null) => {
    update.mutate({ id: task.id, patch: { due } })
    setOpen(false)
    setText('')
  }
  const applyText = () => {
    const t = text.trim()
    if (t === '') return
    if (/^every\b/i.test(t)) {
      const due = parseQuickAdd(t, ctx).due
      if (due) applyDue(due)
      return
    }
    const resolved = resolveNaturalDate(t, ctx)
    if (resolved)
      applyDue({ date: resolved.date, time: resolved.time, string: t, recurrence: null })
  }
  const preset = (date: string, label: string) =>
    applyDue({ date, time: null, string: label, recurrence: null })

  const chip = task.due ? formatDueChip({ date: task.due.date, time: task.due.time }, today) : null
  const nextWeek = nextWeekdayOnOrAfter(addDaysIso(today, 1), ctx.nextWeekDay)
  const nextWeekend = nextWeekdayOnOrAfter(addDaysIso(today, 1), ctx.weekendDay)
  const tomorrow = addDaysIso(today, 1)

  return (
    <Field icon={<Calendar size={16} aria-hidden="true" />} label="Date">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className={fieldTriggerCls}>
          {chip ? (
            <span
              className="inline-flex items-center gap-1"
              style={{ color: `var(${DUE_TONE_VAR[chip.tone]})` }}
            >
              {task.due?.recurrence ? (
                <Repeat size={14} aria-hidden="true" />
              ) : (
                <Calendar size={14} aria-hidden="true" />
              )}
              {chip.label}
            </span>
          ) : (
            <span className="text-text-tertiary">+ Add date</span>
          )}
        </PopoverTrigger>
        <PopoverContent align="end" aria-label="Set due date" className="w-64 p-0">
          <div className="p-2">
            <Input
              value={text}
              autoFocus
              aria-label="Due date"
              placeholder="Type a date…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  applyText()
                }
              }}
            />
            {preview && (
              <div className="mt-2 px-1 text-caption text-text-secondary">
                {formatDueChip(preview, today).label}
              </div>
            )}
          </div>
          <Separator />
          <div className="p-1">
            <PresetRow
              label="Today"
              hint={weekdayHint(today)}
              onClick={() => preset(today, 'today')}
            />
            <PresetRow
              label="Tomorrow"
              hint={weekdayHint(tomorrow)}
              onClick={() => preset(tomorrow, 'tomorrow')}
            />
            <PresetRow
              label="Next week"
              hint={weekdayHint(nextWeek)}
              onClick={() => preset(nextWeek, 'next week')}
            />
            <PresetRow
              label="Next weekend"
              hint={weekdayHint(nextWeekend)}
              onClick={() => preset(nextWeekend, 'next weekend')}
            />
            {task.due && <PresetRow label="No date" danger onClick={() => applyDue(null)} />}
          </div>
        </PopoverContent>
      </Popover>
    </Field>
  )
}

function PresetRow({
  label,
  hint,
  onClick,
  danger,
}: {
  label: string
  hint?: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(menuItemCls, 'justify-between', danger && 'text-danger')}
    >
      <span>{label}</span>
      {hint && <span className="text-caption text-text-tertiary">{hint}</span>}
    </button>
  )
}

function DeadlineField({ task }: { task: Task }) {
  const { update } = useTaskMutations()
  const ctx = useParseCtx()
  const today = dateInTz(ctx.now, ctx.timezone)
  const [open, setOpen] = useState(false)
  const label = task.deadline_date
    ? formatDueChip({ date: task.deadline_date, time: task.deadline_time ?? null }, today).label
    : null

  return (
    <Field icon={<Target size={16} aria-hidden="true" />} label="Deadline">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className={fieldTriggerCls}>
          {label ? (
            <span
              className="inline-flex items-center gap-1"
              style={{ color: 'var(--od-date-overdue)' }}
            >
              <Target size={14} aria-hidden="true" />
              {label}
            </span>
          ) : (
            <span className="text-text-tertiary">+ Add deadline</span>
          )}
        </PopoverTrigger>
        <PopoverContent align="end" aria-label="Set deadline" className="w-56">
          <Input
            type="date"
            aria-label="Deadline date"
            value={task.deadline_date ?? ''}
            onChange={(e) =>
              update.mutate({
                id: task.id,
                patch: { deadline_date: e.target.value === '' ? null : e.target.value },
              })
            }
          />
          {task.deadline_date && (
            <button
              type="button"
              className={cn(menuItemCls, 'mt-2 text-danger')}
              onClick={() => {
                update.mutate({ id: task.id, patch: { deadline_date: null } })
                setOpen(false)
              }}
            >
              Remove deadline
            </button>
          )}
        </PopoverContent>
      </Popover>
    </Field>
  )
}

function PriorityField({ task }: { task: Task }) {
  const { update } = useTaskMutations()
  return (
    <Field icon={<Flag size={16} aria-hidden="true" />} label="Priority">
      <DropdownMenu>
        <DropdownMenuTrigger className={fieldTriggerCls}>
          <PriorityFlag priority={task.priority} />
          <span>{`Priority ${task.priority}`}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {PRIORITIES.map((p) => (
            <DropdownMenuItem
              key={p}
              aria-label={priorityOptionLabel(p)}
              onClick={() => update.mutate({ id: task.id, patch: { priority: p } })}
            >
              <PriorityFlag priority={p} />
              <span>{`Priority ${p}`}</span>
              {task.priority === p && (
                <Check size={16} className="ml-auto shrink-0" aria-hidden="true" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </Field>
  )
}

function LabelsField({ task }: { task: Task }) {
  const { data: labels } = useLabels()
  const { create } = useLabelMutations()
  const { update } = useTaskMutations()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const toggle = (name: string) => {
    const next = task.labels.includes(name)
      ? task.labels.filter((l) => l !== name)
      : [...task.labels, name]
    update.mutate({ id: task.id, patch: { labels: next } })
  }

  const q = query.trim()
  const filtered = (labels ?? []).filter((l) => l.name.toLowerCase().includes(q.toLowerCase()))
  const canCreate =
    q !== '' && !(labels ?? []).some((l) => l.name.toLowerCase() === q.toLowerCase())

  const createAndAdd = () => {
    create.mutate(
      { name: q },
      {
        onSuccess: (label) => {
          toggle(label.name)
          setQuery('')
        },
      },
    )
  }

  return (
    <Field icon={<Tag size={16} aria-hidden="true" />} label="Labels">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className={fieldTriggerCls}>
          {task.labels.length > 0 ? (
            <span className="flex flex-wrap gap-1">
              {task.labels.map((name) => (
                <LabelChip
                  key={name}
                  name={name}
                  color={labels?.find((l) => l.name === name)?.color}
                />
              ))}
            </span>
          ) : (
            <span className="text-text-tertiary">+ Add labels</span>
          )}
        </PopoverTrigger>
        <PopoverContent align="end" aria-label="Edit labels" className="w-64 p-0">
          <div className="border-border-subtle border-b p-2">
            <Input
              value={query}
              autoFocus
              aria-label="Add a label"
              placeholder="Type a label…"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <ScrollArea className="max-h-64">
            <div className="p-1">
              {filtered.map((label) => (
                <button
                  key={label.id}
                  type="button"
                  className={menuItemCls}
                  onClick={() => toggle(label.name)}
                >
                  <ColorDot color={label.color} />
                  <span className="truncate">{label.name}</span>
                  {task.labels.includes(label.name) && (
                    <Check size={16} className="ml-auto shrink-0" aria-hidden="true" />
                  )}
                </button>
              ))}
              {canCreate && (
                <button type="button" className={menuItemCls} onClick={createAndAdd}>
                  <Plus size={16} className="text-text-secondary" aria-hidden="true" />
                  <span className="truncate">{`Create "${q}"`}</span>
                </button>
              )}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </Field>
  )
}

function LabelChip({ name, color }: { name: string; color: string | undefined }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm border border-border px-1 text-caption"
      style={{ color: paletteVar(color) }}
    >
      <span className="size-2 rounded-full bg-current" aria-hidden="true" />
      {name}
    </span>
  )
}

function DurationField({ task }: { task: Task }) {
  const { update } = useTaskMutations()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')

  useEffect(() => {
    setValue(task.duration_min !== null ? String(task.duration_min) : '')
  }, [task.duration_min])

  const save = () => {
    const n = Number(value)
    const minutes =
      value.trim() === '' || Number.isNaN(n) || n <= 0 ? null : Math.min(1440, Math.round(n))
    update.mutate({ id: task.id, patch: { duration_min: minutes } })
    setOpen(false)
  }

  return (
    <Field icon={<Clock size={16} aria-hidden="true" />} label="Duration">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className={fieldTriggerCls}>
          {task.duration_min !== null ? (
            <span>{`${task.duration_min} min`}</span>
          ) : (
            <span className="text-text-tertiary">+ Add duration</span>
          )}
        </PopoverTrigger>
        <PopoverContent align="end" aria-label="Set duration" className="w-56">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={1440}
              value={value}
              autoFocus
              aria-label="Duration in minutes"
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  save()
                }
              }}
              className="w-20"
            />
            <span className="text-copy text-text-secondary">minutes</span>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            {task.duration_min !== null && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  update.mutate({ id: task.id, patch: { duration_min: null } })
                  setOpen(false)
                }}
              >
                Remove
              </Button>
            )}
            <Button size="sm" onClick={save}>
              Save
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </Field>
  )
}

export function DetailSidebar({ task }: { task: Task }) {
  return (
    <aside className="flex min-h-0 flex-col overflow-y-auto border-border border-l bg-surface">
      <ProjectField task={task} />
      <DateField task={task} />
      <DeadlineField task={task} />
      <PriorityField task={task} />
      <LabelsField task={task} />
      <DurationField task={task} />
    </aside>
  )
}
