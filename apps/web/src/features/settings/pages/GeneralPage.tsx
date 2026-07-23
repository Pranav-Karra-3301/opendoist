/**
 * General settings — Home view, timezone, date/time formats, week configuration, and
 * smart-date recognition. Every control writes immediately through the optimistic
 * `useUserSettings` PATCH (features/settings/useSettings.ts). Because that mutation shares
 * the ['user-settings'] cache with phase-4's read-only `useUserSettings`, changes retune
 * Quick Add parsing live (lib/parse-context.ts) and the app's Home redirect (router.tsx /
 * lib/home-view.ts) picks up a new Home view on the next launch. Implements plan Task N.
 */
import type { UserSettings, Weekday } from '@opentask/core'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronsUpDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import { apiAllPages } from '@/api/client'
import { useLabels } from '@/api/hooks/labels'
import { useProjects } from '@/api/hooks/projects'
import { buttonVariants } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { DesktopSettings } from '@/desktop/AutostartToggle'
import { cn } from '@/lib/utils'
import { SettingRow, SettingsSection } from '../ui'
import { useUserSettings } from '../useSettings'

/** Static (non-entity) Home view options. */
const STATIC_HOME_VIEWS = [
  { value: 'inbox', label: 'Inbox' },
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'filters-labels', label: 'Filters & Labels' },
] as const

/** ISO weekday numbers (1 = Monday … 7 = Sunday) — matches core `WeekdaySchema`. */
const WEEKDAYS: readonly { value: Weekday; label: string }[] = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
]

const DATE_FORMATS: readonly { value: UserSettings['dateFormat']; label: string }[] = [
  { value: 'MDY', label: 'Jan 3, 2026' },
  { value: 'DMY', label: '3 Jan 2026' },
]

const TIME_FORMATS: readonly { value: UserSettings['timeFormat']; label: string }[] = [
  { value: '12h', label: '1:00 PM' },
  { value: '24h', label: '13:00' },
]

/** Minimal filter shape for the Home-view picker; a namespaced key avoids colliding with the
 *  Filters & Labels feature's own ['filters'] cache (built in parallel by another task). */
const MiniFilterSchema = z.object({ id: z.string(), name: z.string() })

function useHomeViewFilters() {
  return useQuery({
    queryKey: ['home-view', 'filters'],
    queryFn: () => apiAllPages('/filters', MiniFilterSchema),
    staleTime: 30_000,
    retry: false,
  })
}

/** Full IANA timezone list, or a minimal fallback on ancient engines. */
function getTimeZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return ['UTC']
  }
}

// `value` is `number` because core's `WeekdaySchema` (z.number) infers `number`, not the
// hand-written `Weekday` union; we narrow back to `Weekday` on change.
function WeekdaySelect({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (day: Weekday) => void
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v != null) onChange(v as Weekday)
      }}
      items={WEEKDAYS}
    >
      <SelectTrigger className="w-40" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {WEEKDAYS.map((d) => (
          <SelectItem key={d.value} value={d.value}>
            {d.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function TimezonePicker({
  value,
  detected,
  onChange,
}: {
  value: string
  detected: string
  onChange: (tz: string) => void
}) {
  const [open, setOpen] = useState(false)
  const zones = useMemo(getTimeZones, [])
  const select = (tz: string) => {
    onChange(tz)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          buttonVariants({ variant: 'outline' }),
          'w-56 justify-between font-normal text-text-primary',
        )}
        aria-label="Timezone"
      >
        <span className="truncate">{value}</span>
        <ChevronsUpDown size={16} className="shrink-0 text-text-tertiary" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 overflow-hidden p-0">
        <Command>
          <CommandInput placeholder="Search timezone…" />
          <CommandList>
            <CommandEmpty>No timezone found.</CommandEmpty>
            {detected !== '' && (
              <CommandGroup heading="Detected">
                <CommandItem value={`detected ${detected}`} onSelect={() => select(detected)}>
                  <span className="truncate">{detected}</span>
                  {value === detected && (
                    <Check size={16} className="ml-auto shrink-0" aria-hidden="true" />
                  )}
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup heading="All timezones">
              {zones.map((tz) => (
                <CommandItem key={tz} value={tz} onSelect={() => select(tz)}>
                  <span className="truncate">{tz}</span>
                  {value === tz && (
                    <Check size={16} className="ml-auto shrink-0" aria-hidden="true" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export default function GeneralPage() {
  const { settings, update } = useUserSettings()
  const projects = useProjects().data ?? []
  const labels = useLabels().data ?? []
  const filters = useHomeViewFilters().data ?? []

  const detectedTz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])
  const projectOptions = useMemo(
    () => projects.filter((p) => !p.is_archived && !p.is_inbox),
    [projects],
  )

  /** Flat value→label map so <SelectValue> renders the chosen Home view's name in the trigger. */
  const homeItems = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const o of STATIC_HOME_VIEWS) map[o.value] = o.label
    for (const p of projectOptions) map[`project:${p.id}`] = p.name
    for (const l of labels) map[`label:${l.id}`] = l.name
    for (const f of filters) map[`filter:${f.id}`] = f.name
    return map
  }, [projectOptions, labels, filters])

  return (
    <div className="max-w-2xl">
      <SettingsSection
        title="Startup"
        description="Choose where OpenTask opens each time you launch it."
      >
        <SettingRow
          label="Home view"
          description="Reachable from search and keyboard shortcuts even when it opens elsewhere."
          control={
            <Select
              value={settings.homeView}
              onValueChange={(v) => {
                if (v) update({ homeView: v })
              }}
              items={homeItems}
            >
              <SelectTrigger className="w-56" aria-label="Home view">
                <SelectValue placeholder="Select a view" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {STATIC_HOME_VIEWS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
                {projectOptions.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Projects</SelectLabel>
                    {projectOptions.map((p) => (
                      <SelectItem key={p.id} value={`project:${p.id}`}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {labels.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Labels</SelectLabel>
                    {labels.map((l) => (
                      <SelectItem key={l.id} value={`label:${l.id}`}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {filters.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Filters</SelectLabel>
                    {filters.map((f) => (
                      <SelectItem key={f.id} value={`filter:${f.id}`}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          }
        />
      </SettingsSection>

      <SettingsSection title="Date & time" description="How dates and times are shown and parsed.">
        <SettingRow
          label="Timezone"
          description={`Detected: ${detectedTz}`}
          control={
            <TimezonePicker
              value={settings.timezone}
              detected={detectedTz}
              onChange={(timezone) => update({ timezone })}
            />
          }
        />
        <SettingRow
          label="Date format"
          control={
            <Select
              value={settings.dateFormat}
              onValueChange={(v) => {
                if (v) update({ dateFormat: v })
              }}
              items={DATE_FORMATS}
            >
              <SelectTrigger className="w-40" aria-label="Date format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_FORMATS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          label="Time format"
          control={
            <Select
              value={settings.timeFormat}
              onValueChange={(v) => {
                if (v) update({ timeFormat: v })
              }}
              items={TIME_FORMATS}
            >
              <SelectTrigger className="w-40" aria-label="Time format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_FORMATS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </SettingsSection>

      <SettingsSection title="Calendar" description="Which days anchor your week.">
        <SettingRow
          label="Week start"
          description="The first day of the week in calendar views."
          control={
            <WeekdaySelect
              label="Week start"
              value={settings.weekStart}
              onChange={(weekStart) => update({ weekStart })}
            />
          }
        />
        <SettingRow
          label="Next week"
          description={'The day "next week" points to in Quick Add and scheduling.'}
          control={
            <WeekdaySelect
              label="Next week"
              value={settings.nextWeekDay}
              onChange={(nextWeekDay) => update({ nextWeekDay })}
            />
          }
        />
        <SettingRow
          label="Weekend"
          description="The day your weekend begins."
          control={
            <WeekdaySelect
              label="Weekend"
              value={settings.weekendDay}
              onChange={(weekendDay) => update({ weekendDay })}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="Quick Add">
        <SettingRow
          label="Smart date recognition"
          description="Turn off to stop Quick Add from converting typed dates."
          control={
            <Switch
              checked={settings.smartDate}
              onCheckedChange={(smartDate) => update({ smartDate })}
              aria-label="Smart date recognition"
            />
          }
        />
        <SettingRow
          label="Audio cues"
          description="Tiny interaction sounds — task complete, quick add, toggles, drag and drop."
          control={
            <Switch
              checked={settings.soundCues}
              onCheckedChange={(soundCues) => update({ soundCues })}
              aria-label="Audio cues"
            />
          }
        />
      </SettingsSection>

      {/* Desktop-only (Tauri) section: launch-at-login + notification permission.
          Renders null in the browser, so the web page is unchanged. */}
      <DesktopSettings />
    </div>
  )
}
