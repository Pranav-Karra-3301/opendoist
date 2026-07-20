/**
 * ReminderPicker (quick-add UX pass, plan Task F). Composes `!…` reminder tokens in the Quick Add
 * input (the text is the single source of truth). It shows the current reminders with a remove
 * control, relative presets (disabled with a hint until the task has a due TIME — a relative
 * reminder fires off the due), and an absolute date+time reminder built from a month calendar. The
 * footer teaches the raw syntax so the picker is a discoverability aid, never a parallel model.
 *
 * Reminders are repeatable, so a preset/absolute pick APPENDS a token (never replaces an existing
 * one) and closes; a remove strips that reminder's token span. All edits route through `commit`.
 */
import type { Due, QuickAddToken, ReminderDraft, Weekday } from '@opendoist/core'
import { Bell, Plus, X } from 'lucide-react'
import { type ReactElement, useState } from 'react'
import { MonthCalendar } from '@/components/ui/month-calendar'
import { formatDueChip } from '@/lib/format-date'
import { stripRange } from '../quick-add-model'

export interface ReminderPickerProps {
  text: string
  activeTokens: QuickAddToken[]
  /** the parsed reminders, in token order (aligns 1:1 with the active reminder tokens) */
  reminders: ReminderDraft[]
  /** the parsed due — the relative presets need its TIME (a reminder fires relative to it) */
  due: Due | null
  /** today in the user's timezone (ISO) — labels + `min` for the absolute-reminder calendar */
  today: string
  weekStart: Weekday
  commit: (next: string) => void
  close: () => void
}

/** minutes-before → the `!N min before` token the parser reads back (`0` = at due time). */
function relativeToken(minutes: number): string {
  return `!${minutes} min before`
}

/** ISO date + HH:mm → the `!YYYY-MM-DD HH:mm` absolute-reminder token. */
function absoluteToken(date: string, time: string): string {
  return `!${date} ${time}`
}

/** Append a reminder token (reminders are repeatable — never replace an existing one). */
function appendReminder(text: string, token: string): string {
  const head = text.replace(/\s+$/, '')
  return head === '' ? token : `${head} ${token}`
}

/** Human label for a reminder draft, shown in the current-reminders list. */
function reminderLabel(draft: ReminderDraft, today: string): string {
  if (draft.kind === 'relative') {
    if (draft.minutesBefore === 0) return 'At due time'
    if (draft.minutesBefore % 60 === 0) return `${draft.minutesBefore / 60}h before`
    return `${draft.minutesBefore} min before`
  }
  if (draft.kind === 'absolute') {
    return formatDueChip({ date: draft.date, time: draft.time }, today).label
  }
  return draft.due.string
}

const RELATIVE_PRESETS: { label: string; minutes: number }[] = [
  { label: 'At due time', minutes: 0 },
  { label: '10 minutes before', minutes: 10 },
  { label: '30 minutes before', minutes: 30 },
  { label: '1 hour before', minutes: 60 },
]

export function ReminderPicker({
  text,
  activeTokens,
  reminders,
  due,
  today,
  weekStart,
  commit,
  close,
}: ReminderPickerProps): ReactElement {
  // Draft absolute reminder (date + time), held locally until "Add" writes the token.
  const [absDate, setAbsDate] = useState<string | null>(null)
  const [absTime, setAbsTime] = useState('')

  const reminderTokens = activeTokens.filter((token) => token.kind === 'reminder')
  const hasDueTime = due?.time != null

  const addRelative = (minutes: number): void => {
    commit(appendReminder(text, relativeToken(minutes)))
    close()
  }
  const removeAt = (index: number): void => {
    const token = reminderTokens[index]
    if (token === undefined) return
    commit(stripRange(text, token.start, token.end))
    close()
  }
  const addAbsolute = (): void => {
    if (absDate === null || absTime === '') return
    commit(appendReminder(text, absoluteToken(absDate, absTime)))
    close()
  }

  return (
    <div data-slot="reminder-picker" className="flex flex-col gap-2">
      <span className="px-1 font-medium text-caption text-text-secondary">Reminders</span>

      {reminders.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {reminders.map((draft, index) => (
            <li
              // Keyed by the reminder token's start offset (drafts align 1:1 with tokens in order).
              key={reminderTokens[index]?.start ?? index}
              className="flex items-center gap-2 rounded-sm px-1 py-0.5"
            >
              <Bell size={12} className="shrink-0 text-warning" aria-hidden />
              <span className="flex-1 truncate text-copy text-text-primary">
                {reminderLabel(draft, today)}
              </span>
              <button
                type="button"
                onClick={() => removeAt(index)}
                aria-label={`Remove reminder ${reminderLabel(draft, today)}`}
                className="flex size-5 shrink-0 items-center justify-center rounded-sm text-text-tertiary transition-colors duration-150 hover:bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--od-focus-ring)]"
              >
                <X size={12} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col">
        {RELATIVE_PRESETS.map(({ label, minutes }) => (
          <button
            key={minutes}
            type="button"
            disabled={!hasDueTime}
            onClick={() => addRelative(minutes)}
            className="flex h-8 items-center gap-2 rounded-sm px-2 text-left text-copy text-text-primary transition-colors duration-150 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none disabled:cursor-not-allowed disabled:text-text-tertiary disabled:hover:bg-transparent"
          >
            <Bell size={14} className="shrink-0 text-text-secondary" aria-hidden />
            {label}
          </button>
        ))}
        {!hasDueTime && (
          <p className="px-2 pt-0.5 text-caption text-text-tertiary">
            Needs a due time (e.g. <span className="text-text-secondary">3pm</span>)
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 border-border-subtle border-t pt-2">
        <span className="px-1 text-caption text-text-tertiary">Or remind at a specific time</span>
        <MonthCalendar value={absDate} onPick={setAbsDate} weekStart={weekStart} min={today} />
        <div className="flex items-center gap-2 px-1">
          <input
            type="time"
            value={absTime}
            onChange={(event) => setAbsTime(event.target.value)}
            aria-label="Reminder time"
            className="h-7 flex-1 rounded-sm border border-input-border bg-surface-raised px-2 text-copy text-text-primary outline-none transition-colors duration-150 focus:border-input-border-focus"
          />
          <button
            type="button"
            disabled={absDate === null || absTime === ''}
            onClick={addAbsolute}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-sm bg-accent px-2 font-medium text-caption text-on-accent transition-colors duration-150 hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-accent-disabled"
          >
            <Plus size={12} aria-hidden />
            Add
          </button>
        </div>
      </div>

      <p className="px-1 text-caption text-text-tertiary">
        or type <code className="text-text-secondary">!30 min before</code> ·{' '}
        <code className="text-text-secondary">!tomorrow 9am</code>
      </p>
    </div>
  )
}
