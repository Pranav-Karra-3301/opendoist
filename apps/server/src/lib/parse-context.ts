import type { ParseContext, Weekday } from '@opentask/core'
import type { Settings } from '../api/schemas'
import { nowIso } from './ids'

export function parseContextFor(settings: Settings, now = nowIso()): ParseContext {
  return {
    now,
    timezone: settings.timezone,
    weekStart: settings.weekStart as Weekday,
    nextWeekDay: settings.nextWeekDay as Weekday,
    weekendDay: settings.weekendDay as Weekday,
    smartDate: settings.smartDate,
  }
}
