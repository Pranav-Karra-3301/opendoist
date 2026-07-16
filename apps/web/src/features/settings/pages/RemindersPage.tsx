/**
 * Reminders settings — the automatic-reminder offset applied to every task that gets a due
 * *time*, plus a Test-notification button that is the phase-6 delivery hook point.
 *
 * The offset writes immediately through the optimistic `useUserSettings` PATCH
 * (features/settings/useSettings.ts). It maps to core's `autoReminderMinutes`
 * (null = no automatic reminder, 0 = at due time, otherwise minutes-before). Because the
 * Select cannot carry a `null` value natively, the offset is round-tripped through the
 * string-keyed `REMINDER_OPTIONS` below (pure helpers, unit-tested). Implements plan Task S.
 */
import { useState } from 'react'
import { ApiError, apiVoid } from '@/api/client'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/stores/toasts'
import { SettingRow, SettingsSection } from '../ui'
import { useUserSettings } from '../useSettings'

/** One automatic-reminder offset choice. `value` is the Select's string key (the control
 *  cannot hold a `null` value); `minutes` is the stored `autoReminderMinutes`. */
export interface ReminderOption {
  value: string
  label: string
  /** null = no automatic reminder, 0 = at due time, otherwise minutes before the due time. */
  minutes: number | null
}

/** Offset menu, matching Todoist's "Automatic reminders" options (default = 30 min before). */
export const REMINDER_OPTIONS: readonly ReminderOption[] = [
  { value: 'none', label: 'No automatic reminder', minutes: null },
  { value: '0', label: 'At due time', minutes: 0 },
  { value: '10', label: '10 minutes before', minutes: 10 },
  { value: '30', label: '30 minutes before', minutes: 30 },
  { value: '45', label: '45 minutes before', minutes: 45 },
  { value: '60', label: '1 hour before', minutes: 60 },
  { value: '120', label: '2 hours before', minutes: 120 },
]

/** Stored `autoReminderMinutes` → the Select's string value (falls back to "no reminder"). */
export function reminderSelectValue(minutes: number | null): string {
  return REMINDER_OPTIONS.find((o) => o.minutes === minutes)?.value ?? 'none'
}

/** Select's string value → `autoReminderMinutes` (null = off, 0 = at due time). */
export function reminderMinutesFromValue(value: string): number | null {
  return REMINDER_OPTIONS.find((o) => o.value === value)?.minutes ?? null
}

export default function RemindersPage() {
  const { settings, update } = useUserSettings()
  const [sending, setSending] = useState(false)

  const sendTest = async () => {
    setSending(true)
    try {
      await apiVoid('/channels/test', { method: 'POST' })
      toast.info('Test notification sent')
    } catch (err) {
      // The channels route ships in phase 6; until then the endpoint 404s (or a stub 501s).
      if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
        toast.info('Notification channels arrive in phase 6')
      } else {
        toast.error('Could not send a test notification')
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <SettingsSection
        title="Reminders"
        description="Reminders notify you before a task with a due time is due."
      >
        <SettingRow
          label="Automatic reminders"
          description="Added automatically to tasks that have a due time."
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
          description="Send a sample notification to confirm your channels are set up."
          control={
            <Button variant="outline" onClick={sendTest} disabled={sending}>
              {sending ? 'Sending…' : 'Send test'}
            </Button>
          }
        />
      </SettingsSection>
    </div>
  )
}
