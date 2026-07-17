/**
 * Chips mirroring the parsed Quick Add state. Which chips appear, in what order, and whether they
 * carry text labels is driven by `settings.quickAdd` (Settings → Quick Add, plan Task Q): the row
 * reads the prefs directly through `useUserSettings`, renders the visible chips in stored order,
 * and tucks the hidden ones behind a "…" overflow. Value-bearing chips render their value; empty
 * chips are ghost affordances. Date/priority open a mini menu that rewrites the underlying text
 * through the pure model helpers; the rest insert the relevant sigil so typing continues.
 *
 * The `project` chip is always shown: it is NOT one of the seven customizable `QUICK_ADD_CHIP_IDS`
 * (project selection is a persistent affordance, mirrored by the dialog's footer picker), so it is
 * exempt from the visibility/order prefs. All phase-4 chip insert/menu behaviors are unchanged.
 */
import {
  dateInTz,
  type ParseContext,
  type ParsedQuickAdd,
  type QuickAddChipId,
  type QuickAddPrefs,
  type QuickAddToken,
} from '@opendoist/core'
import {
  AlignLeft,
  Bell,
  CalendarDays,
  Ellipsis,
  Flag,
  Hash,
  type LucideIcon,
  Repeat,
  Tag,
  Target,
  Timer,
} from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { priorityOptionLabel } from '@/components/task/priority-menu'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useUserSettings } from '@/features/settings/useSettings'
import { DUE_TONE_VAR, formatDueChip } from '@/lib/format-date'
import { cn } from '@/lib/utils'
import { normalizeChips, partitionChips } from './chip-prefs'
import { setDueText, setPriorityText } from './quick-add-model'

export interface ChipRowProps {
  text: string
  parsed: ParsedQuickAdd
  activeTokens: QuickAddToken[]
  ctx: ParseContext
  /** replace the whole text and place the caret (defaults to end of text) */
  onEdit: (text: string, caret?: number) => void
}

/** Icon + display name for each customizable chip; shared with the Settings preview + row list. */
export const QUICK_ADD_CHIP_META: Record<QuickAddChipId, { name: string; Icon: LucideIcon }> = {
  date: { name: 'Date', Icon: CalendarDays },
  deadline: { name: 'Deadline', Icon: Target },
  priority: { name: 'Priority', Icon: Flag },
  reminders: { name: 'Reminders', Icon: Bell },
  labels: { name: 'Labels', Icon: Tag },
  duration: { name: 'Duration', Icon: Timer },
  description: { name: 'Description', Icon: AlignLeft },
}

/** Chip pill styling, shared with the Settings preview so it renders exactly like the composer. */
export const chipBase =
  'inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-sm border border-border px-2 text-caption transition-colors duration-150 hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]'

/** Visible chip text: the value when set, otherwise the name (hidden entirely when icons-only). */
function chipText(labeled: boolean, value: string | null, name: string): string | null {
  if (value !== null) return value
  return labeled ? name : null
}

/** Accessible name: always present (value when set, else the name) so icon-only chips stay named. */
function chipAria(value: string | null, name: string): string {
  return value ?? name
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/** A simple button chip: icon + optional label; value-bearing chips paint their tone. */
function Chip({
  icon,
  value,
  name,
  labeled,
  active,
  tone,
  onClick,
}: {
  icon: ReactNode
  value: string | null
  name: string
  labeled: boolean
  active: boolean
  tone?: string
  onClick: () => void
}) {
  const label = chipText(labeled, value, name)
  return (
    <button
      type="button"
      aria-label={chipAria(value, name)}
      onClick={onClick}
      className={cn(chipBase, active ? 'text-text-primary' : 'text-text-secondary')}
      style={active && tone ? { color: tone } : undefined}
    >
      {icon}
      {label ? <span>{label}</span> : null}
    </button>
  )
}

function MenuItem({
  children,
  onSelect,
  ariaLabel,
}: {
  children: ReactNode
  onSelect: () => void
  ariaLabel?: string
}) {
  return (
    <PopoverClose
      aria-label={ariaLabel}
      className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-copy text-text-primary hover:bg-hover"
      onClick={onSelect}
    >
      {children}
    </PopoverClose>
  )
}

/** Everything a chip renderer needs; rebuilt each render (cheap, and Popover state is keyed). */
interface RenderCtx {
  text: string
  parsed: ParsedQuickAdd
  activeTokens: QuickAddToken[]
  today: string
  labeled: boolean
  insert: (snippet: string, caretBack?: number) => void
  rewrite: (next: string) => void
}

function DateChip({ rc }: { rc: RenderCtx }) {
  const dueChip = rc.parsed.due
    ? formatDueChip({ date: rc.parsed.due.date, time: rc.parsed.due.time }, rc.today)
    : null
  const recurring = rc.parsed.due?.recurrence != null
  const value = dueChip?.label ?? null
  const label = chipText(rc.labeled, value, 'Date')
  return (
    <Popover>
      <PopoverTrigger
        aria-label={chipAria(value, 'Date')}
        className={cn(chipBase, dueChip ? 'text-text-primary' : 'text-text-secondary')}
        style={dueChip ? { color: `var(${DUE_TONE_VAR[dueChip.tone]})` } : undefined}
      >
        {recurring ? <Repeat size={12} aria-hidden /> : <CalendarDays size={12} aria-hidden />}
        {label ? <span>{label}</span> : null}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-1">
        <MenuItem onSelect={() => rc.rewrite(setDueText(rc.text, rc.activeTokens, 'today'))}>
          Today
        </MenuItem>
        <MenuItem onSelect={() => rc.rewrite(setDueText(rc.text, rc.activeTokens, 'tomorrow'))}>
          Tomorrow
        </MenuItem>
        <MenuItem onSelect={() => rc.rewrite(setDueText(rc.text, rc.activeTokens, 'next week'))}>
          Next week
        </MenuItem>
        {rc.parsed.due && (
          <MenuItem onSelect={() => rc.rewrite(setDueText(rc.text, rc.activeTokens, ''))}>
            <span className="text-danger">No date</span>
          </MenuItem>
        )}
      </PopoverContent>
    </Popover>
  )
}

function PriorityChip({ rc }: { rc: RenderCtx }) {
  const set = rc.parsed.priority < 4
  const value = set ? `P${rc.parsed.priority}` : null
  const label = chipText(rc.labeled, value, 'Priority')
  return (
    <Popover>
      <PopoverTrigger
        aria-label={chipAria(value, 'Priority')}
        className={cn(chipBase, set ? 'text-text-primary' : 'text-text-secondary')}
      >
        <Flag
          size={12}
          aria-hidden
          style={set ? { color: `var(--od-p${rc.parsed.priority})` } : undefined}
        />
        {label ? <span>{label}</span> : null}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-40 p-1">
        {([1, 2, 3, 4] as const).map((p) => (
          <MenuItem
            key={p}
            ariaLabel={priorityOptionLabel(p)}
            onSelect={() => rc.rewrite(setPriorityText(rc.text, rc.activeTokens, p))}
          >
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
  )
}

/** Renderers for the seven customizable chips, keyed by id (exhaustive by construction). */
const CHIP_RENDERERS: Record<QuickAddChipId, (rc: RenderCtx) => ReactNode> = {
  date: (rc) => <DateChip rc={rc} />,
  priority: (rc) => <PriorityChip rc={rc} />,
  reminders: (rc) => (
    <Chip
      icon={<Bell size={12} aria-hidden />}
      name="Reminders"
      value={rc.parsed.reminders.length > 0 ? `Reminder ×${rc.parsed.reminders.length}` : null}
      labeled={rc.labeled}
      active={rc.parsed.reminders.length > 0}
      onClick={() => rc.insert('!')}
    />
  ),
  labels: (rc) => (
    <Chip
      icon={<Tag size={12} aria-hidden />}
      name="Labels"
      value={rc.parsed.labels.length > 0 ? rc.parsed.labels.map((l) => `@${l}`).join(' ') : null}
      labeled={rc.labeled}
      active={rc.parsed.labels.length > 0}
      onClick={() => rc.insert('@')}
    />
  ),
  deadline: (rc) => (
    <Chip
      icon={<Target size={12} aria-hidden />}
      name="Deadline"
      value={rc.parsed.deadline}
      labeled={rc.labeled}
      active={rc.parsed.deadline !== null}
      tone="var(--od-date-overdue)"
      onClick={() => rc.insert('{}', 1)}
    />
  ),
  duration: (rc) => (
    <Chip
      icon={<Timer size={12} aria-hidden />}
      name="Duration"
      value={rc.parsed.durationMin !== null ? formatDuration(rc.parsed.durationMin) : null}
      labeled={rc.labeled}
      active={rc.parsed.durationMin !== null}
      tone="var(--od-date-today)"
      onClick={() => rc.insert('for ')}
    />
  ),
  description: (rc) => (
    <Chip
      icon={<AlignLeft size={12} aria-hidden />}
      name="Description"
      value={null}
      labeled={rc.labeled}
      active={rc.parsed.description !== null}
      onClick={() => rc.insert('// ')}
    />
  ),
}

/** Project chip — always shown, exempt from the visibility/order prefs (see file header). */
function ProjectChip({ rc }: { rc: RenderCtx }) {
  return (
    <Chip
      icon={<Hash size={12} aria-hidden />}
      name="Project"
      value={rc.parsed.project}
      labeled={rc.labeled}
      active={rc.parsed.project !== null}
      onClick={() => rc.insert('#')}
    />
  )
}

export function ChipRow({ text, parsed, activeTokens, ctx, onEdit }: ChipRowProps) {
  const { settings } = useUserSettings()
  const { visible, hidden } = partitionChips(normalizeChips(settings.quickAdd.chips))

  const today = dateInTz(ctx.now, ctx.timezone)
  const withSpace = (t: string): string => (t === '' || t.endsWith(' ') ? t : `${t} `)
  const insert = (snippet: string, caretBack = 0): void => {
    const next = withSpace(text) + snippet
    onEdit(next, next.length - caretBack)
  }
  const rewrite = (next: string): void => onEdit(next, next.length)
  const rc: RenderCtx = {
    text,
    parsed,
    activeTokens,
    today,
    labeled: settings.quickAdd.labeled,
    insert,
    rewrite,
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {visible.map((chip) => (
        <Fragment key={chip.id}>{CHIP_RENDERERS[chip.id](rc)}</Fragment>
      ))}
      <ProjectChip rc={rc} />
      {hidden.length > 0 && (
        <Popover>
          <PopoverTrigger
            aria-label="More Quick Add options"
            className={cn(chipBase, 'text-text-secondary')}
          >
            <Ellipsis size={12} aria-hidden />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto max-w-xs p-2">
            <div className="flex flex-wrap items-center gap-2">
              {hidden.map((chip) => (
                <Fragment key={chip.id}>
                  {CHIP_RENDERERS[chip.id]({ ...rc, labeled: true })}
                </Fragment>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

/**
 * A static, non-interactive replica of the visible chip row for the Settings → Quick Add preview.
 * Reuses the same icons + pill styling so "how the buttons appear" matches the live composer.
 */
export function QuickAddChipsPreview({ prefs }: { prefs: QuickAddPrefs }) {
  const { visible, hidden } = partitionChips(normalizeChips(prefs.chips))
  return (
    <div className="flex flex-wrap items-center gap-2">
      {visible.map((chip) => {
        const { name, Icon } = QUICK_ADD_CHIP_META[chip.id]
        return <PreviewChip key={chip.id} Icon={Icon} label={prefs.labeled ? name : null} />
      })}
      <PreviewChip Icon={Hash} label={prefs.labeled ? 'Project' : null} />
      {hidden.length > 0 && <PreviewChip Icon={Ellipsis} label={null} />}
    </div>
  )
}

function PreviewChip({ Icon, label }: { Icon: LucideIcon; label: string | null }) {
  return (
    <span className={cn(chipBase, 'cursor-default text-text-secondary')}>
      <Icon size={12} aria-hidden />
      {label ? <span>{label}</span> : null}
    </span>
  )
}
