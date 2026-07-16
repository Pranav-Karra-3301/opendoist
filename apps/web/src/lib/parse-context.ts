/**
 * ParseContext assembly for client-side Quick Add parsing/highlighting. Server-side
 * settings (timezone, weekStart, nextWeekDay, weekendDay, smartDate) are the source of
 * truth; browser values are fallbacks only (settings still loading / first paint).
 */
import { DEFAULT_PARSE_CONTEXT_SETTINGS, type ParseContext, type Weekday } from '@opendoist/core'
import { useUserSettings } from '@/api/hooks/user'
import type { UserSettings } from '@/api/schemas'

function asWeekday(value: number | undefined, fallback: Weekday): Weekday {
  return value !== undefined && Number.isInteger(value) && value >= 1 && value <= 7
    ? (value as Weekday)
    : fallback
}

export function buildParseContext(
  settings: UserSettings | undefined,
  now: Date = new Date(),
): ParseContext {
  return {
    now: now.toISOString(),
    timezone: settings?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    weekStart: asWeekday(settings?.weekStart, DEFAULT_PARSE_CONTEXT_SETTINGS.weekStart),
    nextWeekDay: asWeekday(settings?.nextWeekDay, DEFAULT_PARSE_CONTEXT_SETTINGS.nextWeekDay),
    weekendDay: asWeekday(settings?.weekendDay, DEFAULT_PARSE_CONTEXT_SETTINGS.weekendDay),
    smartDate: settings?.smartDate ?? DEFAULT_PARSE_CONTEXT_SETTINGS.smartDate,
  }
}

/** Live ParseContext from the user's server-side settings. */
export function useParseCtx(): ParseContext {
  const { data } = useUserSettings()
  return buildParseContext(data)
}
