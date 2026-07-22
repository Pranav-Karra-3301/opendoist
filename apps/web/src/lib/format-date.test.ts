import { describe, expect, it } from 'vitest'
import { DUE_TONE_VAR, formatDueChip } from './format-date'

// 2026-07-15 is a Wednesday.
const TODAY = '2026-07-15'

describe('formatDueChip', () => {
  it.each([
    // past → overdue
    [{ date: '2026-07-10', time: null }, 'Jul 10', 'overdue'],
    [{ date: '2026-07-14', time: null }, 'Jul 14', 'overdue'],
    [{ date: '2025-12-31', time: null }, 'Dec 31, 2025', 'overdue'],
    // today / tomorrow
    [{ date: '2026-07-15', time: null }, 'Today', 'today'],
    [{ date: '2026-07-16', time: null }, 'Tomorrow', 'tomorrow'],
    // within the next 7 days → weekday name, weekend tone on Sat/Sun
    [{ date: '2026-07-17', time: null }, 'Friday', 'week'],
    [{ date: '2026-07-18', time: null }, 'Saturday', 'weekend'],
    [{ date: '2026-07-19', time: null }, 'Sunday', 'weekend'],
    [{ date: '2026-07-20', time: null }, 'Monday', 'week'],
    [{ date: '2026-07-22', time: null }, 'Wednesday', 'week'],
    // 8–14 days → `Mon, Jul 27`
    [{ date: '2026-07-23', time: null }, 'Thu, Jul 23', 'nextweek'],
    [{ date: '2026-07-27', time: null }, 'Mon, Jul 27', 'nextweek'],
    [{ date: '2026-07-29', time: null }, 'Wed, Jul 29', 'nextweek'],
    // beyond → future
    [{ date: '2026-07-30', time: null }, 'Jul 30', 'future'],
    [{ date: '2027-01-05', time: null }, 'Jan 5, 2027', 'future'],
  ] as const)('formats %o as "%s" (%s)', (due, label, tone) => {
    expect(formatDueChip(due, TODAY)).toEqual({ label, tone })
  })

  it.each([
    [{ date: '2026-07-15', time: '16:00' }, 'Today 4pm'],
    [{ date: '2026-07-15', time: '09:30' }, 'Today 9:30am'],
    [{ date: '2026-07-15', time: '00:00' }, 'Today 12am'],
    [{ date: '2026-07-15', time: '12:00' }, 'Today 12pm'],
    [{ date: '2026-07-16', time: '23:45' }, 'Tomorrow 11:45pm'],
    [{ date: '2026-07-10', time: '08:00' }, 'Jul 10 8am'],
  ] as const)('appends 12h time: %o → "%s"', (due, label) => {
    expect(formatDueChip(due, TODAY).label).toBe(label)
  })

  it('maps every tone to a CSS var', () => {
    expect(DUE_TONE_VAR).toEqual({
      overdue: '--od-date-overdue',
      missed: '--od-warning',
      today: '--od-date-today',
      tomorrow: '--od-date-tomorrow',
      weekend: '--od-date-weekend',
      nextweek: '--od-date-next-week',
      week: '--od-text-secondary',
      future: '--od-text-secondary',
    })
  })
})

describe('missed tone (same-day timed due whose time passed)', () => {
  it('a today+timed due earlier than nowTime paints missed', () => {
    const chip = formatDueChip({ date: '2026-07-22', time: '16:18' }, '2026-07-22', '17:00')
    expect(chip.tone).toBe('missed')
    expect(chip.label).toBe('Today 4:18pm')
  })

  it('a today+timed due later than nowTime stays today-green', () => {
    expect(formatDueChip({ date: '2026-07-22', time: '17:30' }, '2026-07-22', '17:00').tone).toBe(
      'today',
    )
  })

  it('the exact current minute is not yet missed', () => {
    expect(formatDueChip({ date: '2026-07-22', time: '17:00' }, '2026-07-22', '17:00').tone).toBe(
      'today',
    )
  })

  it('an all-day today due never misses', () => {
    expect(formatDueChip({ date: '2026-07-22', time: null }, '2026-07-22', '23:59').tone).toBe(
      'today',
    )
  })

  it('a past DATE stays hard-overdue red, time or not', () => {
    expect(formatDueChip({ date: '2026-07-21', time: '23:00' }, '2026-07-22', '00:01').tone).toBe(
      'overdue',
    )
  })

  it('without nowTime the tone stays date-only (pickers/composers)', () => {
    expect(formatDueChip({ date: '2026-07-22', time: '01:00' }, '2026-07-22').tone).toBe('today')
  })
})
