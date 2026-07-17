/**
 * Reminders settings (phase 6 Task L) — the automatic-reminder offset applied to every task that
 * gets a due *time*, plus a Send-test button that fires a real reminder to every push device and
 * notification channel and reports the per-sink outcome.
 *
 * The offset writes immediately through the optimistic `useUserSettings` PATCH
 * (features/settings/useSettings.ts). It maps to core's `autoReminderMinutes` (null = no automatic
 * reminder, 0 = at task time, otherwise minutes-before). Because the Select control cannot carry a
 * `null` value natively, the offset round-trips through the string-keyed `REMINDER_OPTIONS` below
 * (pure helpers, unit-tested in RemindersPage.test.ts). The menu mirrors the exact set the server
 * PATCH boundary accepts: null, 0, 5, 10, 15, 30, 45, 60, 120.
 */
import { BellRing } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/stores/toasts'
import { summarizeTestFire, useReminderTest } from '../notifications-api'
import { SettingRow, SettingsSection } from '../ui'
import { useUserSettings } from '../useSettings'

/** One automatic-reminder offset choice. `value` is the Select's string key (the control cannot
 *  hold a `null` value); `minutes` is the stored `autoReminderMinutes`. */
export interface ReminderOption {
  value: string
  label: string
  /** null = no automatic reminder, 0 = at task time, otherwise minutes before the due time. */
  minutes: number | null
}

/** Offset menu — the exact value set the server accepts (Task A constrained the PATCH boundary to
 *  null, 0, 5, 10, 15, 30, 45, 60, 120). Default = 30 min before. */
export const REMINDER_OPTIONS: readonly ReminderOption[] = [
  { value: 'none', label: 'No automatic reminder', minutes: null },
  { value: '0', label: 'At time of task', minutes: 0 },
  { value: '5', label: '5 minutes before', minutes: 5 },
  { value: '10', label: '10 minutes before', minutes: 10 },
  { value: '15', label: '15 minutes before', minutes: 15 },
  { value: '30', label: '30 minutes before', minutes: 30 },
  { value: '45', label: '45 minutes before', minutes: 45 },
  { value: '60', label: '1 hour before', minutes: 60 },
  { value: '120', label: '2 hours before', minutes: 120 },
]

/** Stored `autoReminderMinutes` → the Select's string value (falls back to "no reminder"). */
export function reminderSelectValue(minutes: number | null): string {
  return REMINDER_OPTIONS.find((o) => o.minutes === minutes)?.value ?? 'none'
}

/** Select's string value → `autoReminderMinutes` (null = off, 0 = at task time). */
export function reminderMinutesFromValue(value: string): number | null {
  return REMINDER_OPTIONS.find((o) => o.value === value)?.minutes ?? null
}

export default function RemindersPage() {
  const { settings, update } = useUserSettings()
  const test = useReminderTest()

  const sendTest = () => {
    test.mutate(undefined, {
      onSuccess: (result) => toast.info(summarizeTestFire(result)),
      onError: () => toast.error('Could not send a test notification'),
    })
  }

  return (
    <div className="max-w-2xl">
      <SettingsSection
        title="Reminders"
        description="Reminders notify you before a task with a due time is due."
      >
        <SettingRow
          label="Automatic reminders"
          description="Applied to tasks that have a due time."
          control={
            <Select
              value={reminderSelectValue(settings.autoReminderMinutes)}
              onValueChange={(v) => {
                if (v != null) update({ autoReminderMinutes: reminderMinutesFromValue(v) })
              }}
              items={REMINDER_OPTIONS}
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REMINDER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          label="Test notification"
          description="Send a sample reminder to every push device and channel you've set up."
          control={
            <Button variant="outline" onClick={sendTest} disabled={test.isPending}>
              <BellRing size={16} aria-hidden={true} />
              {test.isPending ? 'Sending…' : 'Send test'}
            </Button>
          }
        />
      </SettingsSection>
    </div>
  )
}
