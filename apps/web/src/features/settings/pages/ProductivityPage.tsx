/**
 * Productivity settings — daily/weekly goals, days off, vacation mode, and the karma
 * toggle. Every control writes immediately through the optimistic `useUserSettings`
 * PATCH (features/settings/useSettings.ts); goal charts and karma history land in phase 9,
 * so this page only captures the preferences those features will read. Implements plan
 * Task R. Pure logic (day-off toggling, goal clamping) lives in `./productivity-logic`
 * so its Vitest suite runs under the repo's node environment without a DOM.
 */
import { Info } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { SettingRow, SettingsSection } from '../ui'
import { useUserSettings } from '../useSettings'
import { clampGoal, type IsoWeekday, isDayOff, toggleDayOff } from './productivity-logic'

/** ISO weekday order (1 = Monday … 7 = Sunday), matching core `WeekdaySchema`. */
const WEEKDAY_CHIPS: readonly { value: IsoWeekday; short: string; full: string }[] = [
  { value: 1, short: 'Mon', full: 'Monday' },
  { value: 2, short: 'Tue', full: 'Tuesday' },
  { value: 3, short: 'Wed', full: 'Wednesday' },
  { value: 4, short: 'Thu', full: 'Thursday' },
  { value: 5, short: 'Fri', full: 'Friday' },
  { value: 6, short: 'Sat', full: 'Saturday' },
  { value: 7, short: 'Sun', full: 'Sunday' },
]

/**
 * Whole-number goal field. Holds a local text draft so typing never PATCHes mid-edit;
 * commits a clamped integer on blur / Enter, and only when it actually changed. The draft
 * re-syncs whenever the stored value moves (optimistic cache updates, cross-tab SSE).
 */
function GoalInput({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string
  value: number
  min: number
  max: number
  onCommit: (next: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commit = () => {
    const next = clampGoal(draft, min, max)
    setDraft(String(next))
    if (next !== value) onCommit(next)
  }

  return (
    <Input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={draft}
      aria-label={label}
      className="w-24 text-right tabular-nums"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

export default function ProductivityPage() {
  const { settings, update } = useUserSettings()

  return (
    <div className="max-w-2xl">
      <div className="mb-6 flex items-start gap-2.5 rounded-lg border border-border bg-surface px-3.5 py-3">
        <Info size={16} className="mt-0.5 shrink-0 text-info" aria-hidden="true" />
        <p className="text-copy text-text-secondary">
          Goal charts and karma history arrive with the productivity release (phase 9) — your goals
          are tracked from now.
        </p>
      </div>

      <SettingsSection
        title="Goals"
        description="Set how many tasks you aim to complete. Goals feed your streaks and karma."
      >
        <SettingRow
          label="Daily goal"
          description="Tasks per day; 0 disables"
          control={
            <GoalInput
              label="Daily goal"
              value={settings.dailyGoal}
              min={0}
              max={100}
              onCommit={(dailyGoal) => update({ dailyGoal })}
            />
          }
        />
        <SettingRow
          label="Weekly goal"
          description="Tasks per week; 0 disables"
          control={
            <GoalInput
              label="Weekly goal"
              value={settings.weeklyGoal}
              min={0}
              max={700}
              onCommit={(weeklyGoal) => update({ weeklyGoal })}
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Streaks"
        description="Days off keep your streak intact, and vacation mode pauses goals entirely."
      >
        <fieldset className="m-0 min-w-0 border-0 px-4 py-3">
          <legend className="text-body text-text-primary">Days off</legend>
          <div className="text-caption text-text-tertiary">
            Selected days are excluded from your streak.
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {WEEKDAY_CHIPS.map((d) => {
              const selected = isDayOff(settings.daysOff, d.value)
              return (
                <button
                  key={d.value}
                  type="button"
                  aria-pressed={selected}
                  aria-label={d.full}
                  title={d.full}
                  onClick={() => update({ daysOff: toggleDayOff(settings.daysOff, d.value) })}
                  className={cn(
                    'h-8 min-w-11 cursor-pointer rounded-sm border px-2.5 text-copy transition-colors duration-150 ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-focus-ring)]',
                    selected
                      ? 'border-transparent bg-selected font-semibold text-selected-text'
                      : 'border-input-border bg-surface-raised font-medium text-text-secondary hover:bg-hover hover:text-text-primary',
                  )}
                >
                  {d.short}
                </button>
              )
            })}
          </div>
        </fieldset>
        <SettingRow
          label="Vacation mode"
          description="Pauses goals; streaks are preserved"
          control={
            <Switch
              checked={settings.vacationMode}
              onCheckedChange={(vacationMode) => update({ vacationMode })}
              aria-label="Vacation mode"
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="Karma" description="Karma rewards consistent progress over time.">
        <SettingRow
          label="Enable karma"
          description="+5 per completion, +3 on-time bonus, +10 daily goal, +25 weekly goal, −10 per task ≥4 days overdue"
          control={
            <Switch
              checked={settings.karmaEnabled}
              onCheckedChange={(karmaEnabled) => update({ karmaEnabled })}
              aria-label="Enable karma"
            />
          }
        />
      </SettingsSection>
    </div>
  )
}
