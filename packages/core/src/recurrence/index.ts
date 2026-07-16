import type { ParseContext, RecurrenceSpec } from '../types'
import { addDaysUtc, addMonthsClamped, firstOccurrence } from './engine'
import { parsePhrase } from './grammar'

export { nextOccurrence } from './engine'
export { RECURRENCE_HEAD_WORDS } from './grammar'

/** Parse a recurrence phrase if `text` STARTS WITH one (after optional leading spaces).
 *  Returns the spec + the consumed span length, or null. Handles 'every', 'every!', 'ev', 'daily',
 *  'weekly', 'monthly', 'quarterly', 'yearly', 'after N <unit>' (→ completion anchor). */
export function parseRecurrenceText(
  text: string,
  ctx: ParseContext,
): { spec: RecurrenceSpec; consumed: number; firstDate: string; firstTime: string | null } | null {
  const parsed = parsePhrase(text, ctx)
  if (parsed === null) return null
  const first = firstOccurrence(parsed.spec, ctx)
  if (first === null) return null
  let spec = parsed.spec
  if (parsed.forBound !== null) {
    const { n, unit } = parsed.forBound
    const until =
      unit === 'day'
        ? addDaysUtc(first.date, n)
        : unit === 'week'
          ? addDaysUtc(first.date, 7 * n)
          : unit === 'month'
            ? addMonthsClamped(first.date, n)
            : addMonthsClamped(first.date, 12 * n)
    spec = { ...spec, until }
  }
  return { spec, consumed: parsed.consumed, firstDate: first.date, firstTime: first.time }
}
