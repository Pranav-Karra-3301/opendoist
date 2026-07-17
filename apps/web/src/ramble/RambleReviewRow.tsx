/**
 * One editable task row in the Ramble review dialog (plan Task K). Fully controlled by the
 * parent dialog's local state — nothing here persists until the whole batch is confirmed.
 *
 * The `due` field holds the SPOKEN PHRASE (a plain string), never a resolved `Due`: the server
 * re-parses it with core `parseQuickAdd`/`resolveNaturalDate` at confirm time (Task G's
 * `buildTaskDrafts`), so unparseable phrases must survive editing and are later appended to the
 * task description. The live preview mirrors that exact resolution order so what the user sees
 * matches what the server will create. Priority and label editors reuse the app's frozen chip
 * panels (`PriorityMenu` / `LabelPanel`) for visual parity with task rows and the detail panel.
 */
import { dateInTz, type ParseContext, parseQuickAdd, resolveNaturalDate } from '@opendoist/core'
import { CalendarPlus, Flag, Repeat, Trash2 } from 'lucide-react'
import { type ReactElement, useLayoutEffect, useRef, useState } from 'react'
import type { ExtractedTask } from '@/api/rambles'
import { LabelPanel } from '@/components/task/label-popover'
import { PriorityMenu } from '@/components/task/priority-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DUE_TONE_VAR, formatDueChip } from '@/lib/format-date'
import { cn } from '@/lib/utils'

export interface RambleReviewRowProps {
  task: ExtractedTask
  index: number
  ctx: ParseContext
  onChange: (next: ExtractedTask) => void
  onRemove: () => void
}

type Prio = 1 | 2 | 3 | 4

/** Menu-semantics popover chrome (§2.9), matching the app's row/detail chip popovers. */
const MENU_CHROME = 'border border-black/10 dark:border-border [box-shadow:var(--shadow-menu)]'
const chipCls =
  'inline-flex h-7 max-w-full items-center gap-1.5 rounded-sm border border-border px-2 text-copy text-text-secondary outline-none transition-colors duration-150 hover:bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]'

const PRIORITY_FLAG: Record<Prio, { className: string; filled: boolean }> = {
  1: { className: 'text-p1', filled: true },
  2: { className: 'text-p2', filled: true },
  3: { className: 'text-p3', filled: true },
  4: { className: 'text-text-tertiary', filled: false },
}

/** Resolve a spoken due phrase the same way `buildTaskDrafts` will: quick-add first (captures
 *  times AND recurrences), then a bare natural-date phrase; null when nothing parses. */
function previewDue(
  phrase: string,
  ctx: ParseContext,
): { date: string; time: string | null; recurring: boolean } | null {
  const trimmed = phrase.trim()
  if (trimmed === '') return null
  const qa = parseQuickAdd(trimmed, ctx).due
  if (qa !== null) return { date: qa.date, time: qa.time, recurring: qa.recurrence !== null }
  const nd = resolveNaturalDate(trimmed, ctx)
  return nd === null ? null : { date: nd.date, time: nd.time, recurring: false }
}

/** Textarea that grows with its content (notes can be multi-line). */
function AutoTextarea({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  ariaLabel: string
}): ReactElement {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      className="w-full resize-none bg-transparent text-copy text-text-secondary leading-[17px] outline-none placeholder:text-text-tertiary"
    />
  )
}

function DueChip({
  task,
  ctx,
  onChange,
}: {
  task: ExtractedTask
  ctx: ParseContext
  onChange: (next: ExtractedTask) => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const phrase = task.due ?? ''
  const today = dateInTz(ctx.now, ctx.timezone)
  const preview = previewDue(phrase, ctx)
  const previewChip =
    preview === null ? null : formatDueChip({ date: preview.date, time: preview.time }, today)

  const setPhrase = (value: string): void =>
    onChange({ ...task, due: value.trim() === '' ? null : value })

  const preset = (value: string | null): void => {
    onChange({ ...task, due: value })
    setOpen(false)
  }

  let trigger: ReactElement
  if (phrase.trim() === '') {
    trigger = (
      <span className="inline-flex items-center gap-1.5 text-text-tertiary">
        <CalendarPlus size={14} aria-hidden />
        Add date
      </span>
    )
  } else if (preview !== null && previewChip !== null) {
    trigger = (
      <span
        className="inline-flex items-center gap-1.5"
        style={{ color: `var(${DUE_TONE_VAR[previewChip.tone]})` }}
      >
        {preview.recurring ? (
          <Repeat size={14} aria-hidden />
        ) : (
          <CalendarPlus size={14} aria-hidden />
        )}
        <span className="truncate">{previewChip.label}</span>
      </span>
    )
  } else {
    trigger = (
      <span className="inline-flex items-center gap-1.5 text-text-tertiary italic">
        <CalendarPlus size={14} aria-hidden />
        <span className="truncate">{phrase}</span>
      </span>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={chipCls} aria-label="Edit due date">
        {trigger}
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-72 p-2">
        <Input
          autoFocus
          value={phrase}
          placeholder="e.g. tomorrow 5pm, every friday"
          aria-label="Due date phrase"
          onChange={(event) => setPhrase(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              setOpen(false)
            }
          }}
        />
        <div className="mt-2 min-h-[17px] px-0.5 text-caption">
          {phrase.trim() === '' ? null : preview !== null && previewChip !== null ? (
            <span style={{ color: `var(${DUE_TONE_VAR[previewChip.tone]})` }}>
              {previewChip.label}
              {preview.recurring ? ' · repeats' : ''}
            </span>
          ) : (
            <span className="text-text-tertiary">
              Won&rsquo;t parse — will be added to the description
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-col">
          {(
            [
              ['Today', 'today'],
              ['Tomorrow', 'tomorrow'],
              ['Next week', 'next week'],
            ] as const
          ).map(([label, value]) => (
            <button
              key={value}
              type="button"
              onClick={() => preset(value)}
              className="flex h-8 items-center rounded-sm px-2 text-copy text-text-primary transition-colors duration-150 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
            >
              {label}
            </button>
          ))}
          {task.due !== null && (
            <button
              type="button"
              onClick={() => preset(null)}
              className="flex h-8 items-center rounded-sm px-2 text-copy text-danger transition-colors duration-150 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
            >
              No date
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function PriorityChip({
  task,
  onChange,
}: {
  task: ExtractedTask
  onChange: (next: ExtractedTask) => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const effective: Prio = task.priority ?? 4
  const flag = PRIORITY_FLAG[effective]
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={chipCls} aria-label="Edit priority">
        <Flag
          size={14}
          className={flag.className}
          fill={flag.filled ? 'currentColor' : 'none'}
          aria-hidden
        />
        <span className={task.priority === null ? 'text-text-tertiary' : undefined}>
          {task.priority === null ? 'Priority' : `P${task.priority}`}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className={cn('w-56 p-1', MENU_CHROME)}>
        <PriorityMenu
          value={effective}
          onPick={(priority) => {
            onChange({ ...task, priority })
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

function LabelsChip({
  task,
  onChange,
}: {
  task: ExtractedTask
  onChange: (next: ExtractedTask) => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={chipCls} aria-label="Edit labels">
        {task.labels.length === 0 ? (
          <span className="text-text-tertiary">Add labels</span>
        ) : (
          <span className="truncate">{task.labels.map((name) => `@${name}`).join(' ')}</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className={cn('w-64 p-1', MENU_CHROME)}>
        <LabelPanel value={task.labels} onChange={(labels) => onChange({ ...task, labels })} />
      </PopoverContent>
    </Popover>
  )
}

export function RambleReviewRow({
  task,
  index,
  ctx,
  onChange,
  onRemove,
}: RambleReviewRowProps): ReactElement {
  const empty = task.title.trim() === ''
  return (
    <div className="flex gap-2 rounded-sm border border-border-subtle bg-surface p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Input
          value={task.title}
          placeholder="Task name"
          aria-label={`Task ${index + 1} name`}
          aria-invalid={empty}
          onChange={(event) => onChange({ ...task, title: event.target.value })}
          className="h-auto border-0 bg-transparent px-0 font-medium text-body"
        />
        <AutoTextarea
          value={task.notes ?? ''}
          placeholder="Description"
          ariaLabel={`Task ${index + 1} description`}
          onChange={(value) => onChange({ ...task, notes: value === '' ? null : value })}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <DueChip task={task} ctx={ctx} onChange={onChange} />
          <PriorityChip task={task} onChange={onChange} />
          <LabelsChip task={task} onChange={onChange} />
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove task ${index + 1}`}
        className="flex size-7 shrink-0 items-center justify-center rounded-sm text-text-tertiary transition-colors duration-150 hover:bg-hover hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]"
      >
        <Trash2 size={16} aria-hidden />
      </button>
    </div>
  )
}
