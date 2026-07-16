/**
 * Chips mirroring the parsed Quick Add state, in Todoist's default order (date, priority,
 * reminders, labels, deadline, project, description). Value-bearing chips render their value;
 * empty chips are ghost affordances. Date/priority open a mini menu that rewrites the underlying
 * text through the pure model helpers; the rest insert the relevant sigil so typing continues.
 */
import {
  dateInTz,
  type ParseContext,
  type ParsedQuickAdd,
  type QuickAddToken,
} from '@opendoist/core'
import { AlignLeft, Bell, CalendarDays, Flag, Hash, Repeat, Tag, Target } from 'lucide-react'
import type { ReactNode } from 'react'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DUE_TONE_VAR, formatDueChip } from '@/lib/format-date'
import { cn } from '@/lib/utils'
import { setDueText, setPriorityText } from './quick-add-model'

export interface ChipRowProps {
  text: string
  parsed: ParsedQuickAdd
  activeTokens: QuickAddToken[]
  ctx: ParseContext
  /** replace the whole text and place the caret (defaults to end of text) */
  onEdit: (text: string, caret?: number) => void
}

const chipBase =
  'inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-sm border border-border px-2 text-caption transition-colors duration-150 hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]'

function Chip({
  icon,
  children,
  active,
  tone,
  onClick,
}: {
  icon: ReactNode
  children: ReactNode
  active: boolean
  tone?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(chipBase, active ? 'text-text-primary' : 'text-text-secondary')}
      style={active && tone ? { color: tone } : undefined}
    >
      {icon}
      {children}
    </button>
  )
}

function MenuItem({ children, onSelect }: { children: ReactNode; onSelect: () => void }) {
  return (
    <PopoverClose
      className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-copy text-text-primary hover:bg-hover"
      onClick={onSelect}
    >
      {children}
    </PopoverClose>
  )
}

export function ChipRow({ text, parsed, activeTokens, ctx, onEdit }: ChipRowProps) {
  const today = dateInTz(ctx.now, ctx.timezone)
  const withSpace = (t: string): string => (t === '' || t.endsWith(' ') ? t : `${t} `)
  const insert = (snippet: string, caretBack = 0): void => {
    const next = withSpace(text) + snippet
    onEdit(next, next.length - caretBack)
  }
  const rewrite = (next: string): void => onEdit(next, next.length)

  const dueChip = parsed.due
    ? formatDueChip({ date: parsed.due.date, time: parsed.due.time }, today)
    : null
  const recurring = parsed.due?.recurrence != null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* date */}
      <Popover>
        <PopoverTrigger
          className={cn(chipBase, dueChip ? 'text-text-primary' : 'text-text-secondary')}
          style={dueChip ? { color: `var(${DUE_TONE_VAR[dueChip.tone]})` } : undefined}
        >
          {recurring ? <Repeat size={12} aria-hidden /> : <CalendarDays size={12} aria-hidden />}
          {dueChip ? dueChip.label : 'Date'}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-44 p-1">
          <MenuItem onSelect={() => rewrite(setDueText(text, activeTokens, 'today'))}>
            Today
          </MenuItem>
          <MenuItem onSelect={() => rewrite(setDueText(text, activeTokens, 'tomorrow'))}>
            Tomorrow
          </MenuItem>
          <MenuItem onSelect={() => rewrite(setDueText(text, activeTokens, 'next week'))}>
            Next week
          </MenuItem>
          {parsed.due && (
            <MenuItem onSelect={() => rewrite(setDueText(text, activeTokens, ''))}>
              <span className="text-danger">No date</span>
            </MenuItem>
          )}
        </PopoverContent>
      </Popover>

      {/* priority */}
      <Popover>
        <PopoverTrigger
          className={cn(
            chipBase,
            parsed.priority < 4 ? 'text-text-primary' : 'text-text-secondary',
          )}
        >
          <Flag
            size={12}
            aria-hidden
            style={parsed.priority < 4 ? { color: `var(--od-p${parsed.priority})` } : undefined}
          />
          {parsed.priority < 4 ? `P${parsed.priority}` : 'Priority'}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-40 p-1">
          {([1, 2, 3, 4] as const).map((p) => (
            <MenuItem key={p} onSelect={() => rewrite(setPriorityText(text, activeTokens, p))}>
              <Flag
                size={16}
                aria-hidden
                style={p < 4 ? { color: `var(--od-p${p})` } : { color: 'var(--od-p4)' }}
              />
              Priority {p}
            </MenuItem>
          ))}
        </PopoverContent>
      </Popover>

      {/* reminders (parsed only — not persisted this phase) */}
      <Chip
        icon={<Bell size={12} aria-hidden />}
        active={parsed.reminders.length > 0}
        onClick={() => insert('!')}
      >
        {parsed.reminders.length > 0 ? `Reminder ×${parsed.reminders.length}` : 'Reminder'}
      </Chip>

      {/* labels */}
      <Chip
        icon={<Tag size={12} aria-hidden />}
        active={parsed.labels.length > 0}
        onClick={() => insert('@')}
      >
        {parsed.labels.length > 0 ? parsed.labels.map((l) => `@${l}`).join(' ') : 'Labels'}
      </Chip>

      {/* deadline */}
      <Chip
        icon={<Target size={12} aria-hidden />}
        active={parsed.deadline !== null}
        tone="var(--od-date-overdue)"
        onClick={() => insert('{}', 1)}
      >
        {parsed.deadline ?? 'Deadline'}
      </Chip>

      {/* project */}
      <Chip
        icon={<Hash size={12} aria-hidden />}
        active={parsed.project !== null}
        onClick={() => insert('#')}
      >
        {parsed.project ?? 'Project'}
      </Chip>

      {/* description */}
      <Chip
        icon={<AlignLeft size={12} aria-hidden />}
        active={parsed.description !== null}
        onClick={() => insert('// ')}
      >
        Description
      </Chip>
    </div>
  )
}
