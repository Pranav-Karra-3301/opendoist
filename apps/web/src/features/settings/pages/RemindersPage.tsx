/**
 * Reminders settings (phase 6 Task L) — every task with a due *time* always gets an automatic
 * reminder at that time (built-in, server-side); this page configures the optional extra
 * heads-up offset before it, plus a Send-test button that fires a real reminder to every push
 * device and notification channel and reports the per-sink outcome.
 *
 * The offset writes immediately through the optimistic `useUserSettings` PATCH
 * (features/settings/useSettings.ts). It maps to core's `autoReminderMinutes` (null = no extra
 * heads-up, otherwise minutes-before; a legacy stored 0 renders as "none" since the at-time
 * reminder is built in). Because the Select control cannot carry a `null` value natively, the
 * offset round-trips through the string-keyed `REMINDER_OPTIONS` below (pure helpers,
 * unit-tested in RemindersPage.test.ts). The server PATCH boundary still accepts 0 for
 * back-compat, but the menu no longer offers it.
 */
import { BellRing } from 'lucide-react'
import { useState } from 'react'
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

/** One heads-up offset choice. `value` is the Select's string key (the control cannot
 *  hold a `null` value); `minutes` is the stored `autoReminderMinutes`. */
export interface ReminderOption {
  value: string
  label: string
  /** null = no extra heads-up, otherwise minutes before the due time. */
  minutes: number | null
}

/** Heads-up menu. The at-time reminder is built in, so the redundant 0 option is gone;
 *  the server PATCH boundary still accepts it for back-compat. Default = 30 min before. */
export const REMINDER_OPTIONS: readonly ReminderOption[] = [
  { value: 'none', label: 'No extra reminder', minutes: null },
  { value: '5', label: '5 minutes before', minutes: 5 },
  { value: '10', label: '10 minutes before', minutes: 10 },
  { value: '15', label: '15 minutes before', minutes: 15 },
  { value: '30', label: '30 minutes before', minutes: 30 },
  { value: '45', label: '45 minutes before', minutes: 45 },
  { value: '60', label: '1 hour before', minutes: 60 },
  { value: '120', label: '2 hours before', minutes: 120 },
]

/** Stored `autoReminderMinutes` → the Select's string value. A legacy stored 0 (and any other
 *  off-menu value) falls back to "none": the at-time reminder is built in either way. */
export function reminderSelectValue(minutes: number | null): string {
  return REMINDER_OPTIONS.find((o) => o.minutes === minutes)?.value ?? 'none'
}

/** Select's string value → `autoReminderMinutes` (null = no extra heads-up). */
export function reminderMinutesFromValue(value: string): number | null {
  return REMINDER_OPTIONS.find((o) => o.value === value)?.minutes ?? null
}

export default function RemindersPage() {
  const { settings, update } = useUserSettings()
  const test = useReminderTest()
  const [testResult, setTestResult] = useState<string | null>(null)

  const sendTest = () => {
    // `aria-disabled` keeps the button focusable while inflight, so guard re-entry here.
    if (test.isPending) return
    setTestResult(null)
    test.mutate(undefined, {
      onSuccess: (result) => {
        const message = summarizeTestFire(result)
        setTestResult(message)
        toast.info(message)
      },
      onError: () => {
        const message = 'Could not send a test notification.'
        setTestResult(message)
        toast.error(message)
      },
    })
  }

  return (
    <div className="max-w-2xl">
      <SettingsSection
        title="Reminders"
        description="Every task with a due time gets a reminder at that time automatically."
      >
        <SettingRow
          label="Extra reminder"
          description="Add a second heads-up before the task's time."
          control={
            <Select
              value={reminderSelectValue(settings.autoReminderMinutes)}
              onValueChange={(v) => {
                if (v != null) update({ autoReminderMinutes: reminderMinutesFromValue(v) })
              }}
              items={REMINDER_OPTIONS}
            >
              <SelectTrigger className="w-56" aria-label="Automatic reminders">
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
            <Button
              variant="outline"
              onClick={sendTest}
              aria-disabled={test.isPending}
              aria-busy={test.isPending}
              className={test.isPending ? 'opacity-60' : undefined}
            >
              <BellRing size={16} aria-hidden={true} />
              {test.isPending ? 'Sending…' : 'Send test'}
            </Button>
          }
        />
      </SettingsSection>
      {/* Polite live region: announces the test outcome to assistive tech without stealing focus. */}
      <p role="status" className="mt-3 min-h-[1.25rem] text-copy text-text-secondary">
        {testResult}
      </p>
    </div>
  )
}
