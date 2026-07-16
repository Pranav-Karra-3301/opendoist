import { describe, expect, test } from 'vitest'
import {
  DEFAULT_PARSE_CONTEXT_SETTINGS,
  type ParseContext,
  type RecurrenceSpec,
  RecurrenceSpecSchema,
} from '../types'
import { nextOccurrence } from './index'

const ctx: ParseContext = {
  now: '2026-07-15T21:00:00Z',
  timezone: 'America/New_York',
  ...DEFAULT_PARSE_CONTEXT_SETTINGS,
}

/** build a full spec from a partial, via the schema's defaults */
function mk(partial: Partial<RecurrenceSpec> & Pick<RecurrenceSpec, 'freq'>): RecurrenceSpec {
  return RecurrenceSpecSchema.parse({ anchor: 'schedule', interval: 1, ...partial })
}

function sequence(spec: RecurrenceSpec, fromDate: string, n: number): string[] {
  const out: string[] = []
  let after: { date: string; time: string | null } = { date: fromDate, time: null }
  for (let i = 0; i < n; i++) {
    const next = nextOccurrence(spec, { after, ctx })
    if (next === null) break
    out.push(next.date)
    after = next
  }
  return out
}

describe('weekly sequences', () => {
  test('every mon, fri from 2026-07-17 (plan fixture)', () => {
    const spec = mk({ freq: 'weekly', weekdays: [1, 5] })
    expect(sequence(spec, '2026-07-17', 4)).toEqual([
      '2026-07-20',
      '2026-07-24',
      '2026-07-27',
      '2026-07-31',
    ])
  })

  test('every workday skips the weekend', () => {
    const spec = mk({ freq: 'weekly', weekdays: ['workday'] })
    expect(sequence(spec, '2026-07-16', 3)).toEqual(['2026-07-17', '2026-07-20', '2026-07-21'])
  })

  test('every other tue aligns to the previous occurrence week', () => {
    const spec = mk({ freq: 'weekly', interval: 2, weekdays: [2] })
    expect(sequence(spec, '2026-07-21', 3)).toEqual(['2026-08-04', '2026-08-18', '2026-09-01'])
  })

  test('interval alignment respects ctx.weekStart for sets straddling the week boundary', () => {
    const spec = mk({ freq: 'weekly', interval: 2, weekdays: [1, 7] })
    // weeks start Monday: Sun 2026-07-26 is in the same week as Mon 2026-07-20
    const mondayStart = nextOccurrence(spec, { after: { date: '2026-07-20', time: null }, ctx })
    expect(mondayStart?.date).toBe('2026-07-26')
    // weeks start Sunday: Sun 2026-07-26 opens the NEXT week, so it is skipped
    const sundayCtx: ParseContext = { ...ctx, weekStart: 7 }
    const sundayStart = nextOccurrence(spec, {
      after: { date: '2026-07-20', time: null },
      ctx: sundayCtx,
    })
    expect(sundayStart?.date).toBe('2026-08-02')
  })

  test('carries the wall-clock time on each occurrence', () => {
    const spec = mk({ freq: 'weekly', weekdays: [1], times: ['20:00'] })
    expect(nextOccurrence(spec, { after: { date: '2026-07-20', time: '20:00' }, ctx })).toEqual({
      date: '2026-07-27',
      time: '20:00',
    })
  })
})

describe('monthly patterns', () => {
  test('every 3rd friday after 2026-07-17 → 2026-08-21 (plan fixture)', () => {
    const spec = mk({ freq: 'monthly', ordinal: { nth: 3, unit: 'weekday', weekday: 5 } })
    expect(nextOccurrence(spec, { after: { date: '2026-07-17', time: null }, ctx })?.date).toBe(
      '2026-08-21',
    )
  })

  test('every last day after 2026-07-31 → 2026-08-31 (plan fixture)', () => {
    const spec = mk({ freq: 'monthly', ordinal: { nth: 'last', unit: 'day', weekday: null } })
    expect(nextOccurrence(spec, { after: { date: '2026-07-31', time: null }, ctx })?.date).toBe(
      '2026-08-31',
    )
  })

  test('last day handles February', () => {
    const spec = mk({ freq: 'monthly', ordinal: { nth: 'last', unit: 'day', weekday: null } })
    expect(sequence(spec, '2027-01-31', 2)).toEqual(['2027-02-28', '2027-03-31'])
  })

  test('last workday of the month', () => {
    const spec = mk({ freq: 'monthly', ordinal: { nth: 'last', unit: 'workday', weekday: null } })
    // 2026-08-31 is a Monday; 2026-10-31 is a Saturday so October's is the 30th
    expect(sequence(spec, '2026-07-31', 3)).toEqual(['2026-08-31', '2026-09-30', '2026-10-30'])
  })

  test('15th workday of the month', () => {
    const spec = mk({ freq: 'monthly', ordinal: { nth: 15, unit: 'workday', weekday: null } })
    expect(nextOccurrence(spec, { after: { date: '2026-07-15', time: null }, ctx })?.date).toBe(
      '2026-07-21',
    )
  })

  test('5th friday only lands in months that have one', () => {
    const spec = mk({ freq: 'monthly', ordinal: { nth: 5, unit: 'weekday', weekday: 5 } })
    // July 2026 has 5 Fridays (31st); August has 4; October's 5th Friday is the 30th
    expect(sequence(spec, '2026-07-15', 2)).toEqual(['2026-07-31', '2026-10-30'])
  })

  test('ordinal lists union their entries within each month', () => {
    // every 15th workday, first workday, last workday (dossier §1.3 positional row)
    const spec = mk({
      freq: 'monthly',
      ordinals: [
        { nth: 15, unit: 'workday', weekday: null, month: null },
        { nth: 1, unit: 'workday', weekday: null, month: null },
        { nth: 'last', unit: 'workday', weekday: null, month: null },
      ],
    })
    // Jul 2026: 15th workday = Tue Jul 21, last workday = Fri Jul 31; Aug: first = Mon Aug 3
    expect(sequence(spec, '2026-07-15', 3)).toEqual(['2026-07-21', '2026-07-31', '2026-08-03'])
  })

  test('monthDays wrap into the next month (plan fixture)', () => {
    const spec = mk({ freq: 'monthly', monthDays: [2, 15, 27] })
    expect(sequence(spec, '2026-07-27', 3)).toEqual(['2026-08-02', '2026-08-15', '2026-08-27'])
  })

  test("monthDays 'last' resolves per month", () => {
    const spec = mk({ freq: 'monthly', monthDays: ['last'] })
    expect(sequence(spec, '2026-07-31', 2)).toEqual(['2026-08-31', '2026-09-30'])
  })

  test('monthDays skip months without the day', () => {
    const spec = mk({ freq: 'monthly', monthDays: [31] })
    expect(sequence(spec, '2026-01-31', 2)).toEqual(['2026-03-31', '2026-05-31'])
  })

  test('monthDays with interval > 1 align to the previous occurrence month', () => {
    const spec = mk({ freq: 'monthly', interval: 2, monthDays: [15] })
    expect(sequence(spec, '2026-07-15', 2)).toEqual(['2026-09-15', '2026-11-15'])
  })

  test('plain monthly clamps to short months', () => {
    const spec = mk({ freq: 'monthly' })
    expect(nextOccurrence(spec, { after: { date: '2026-01-31', time: null }, ctx })?.date).toBe(
      '2026-02-28',
    )
  })
})

describe('yearly patterns', () => {
  test('yearly dates wrap to the next year (plan fixture)', () => {
    const spec = mk({
      freq: 'yearly',
      dates: [
        { month: 1, day: 14 },
        { month: 4, day: 14 },
      ],
    })
    expect(sequence(spec, '2027-04-14', 2)).toEqual(['2028-01-14', '2028-04-14'])
  })

  test('feb 29 only lands on leap years', () => {
    const spec = mk({ freq: 'yearly', dates: [{ month: 2, day: 29 }] })
    expect(nextOccurrence(spec, { after: { date: '2026-03-01', time: null }, ctx })?.date).toBe(
      '2028-02-29',
    )
  })

  test('plain yearly clamps feb 29 anchors', () => {
    const spec = mk({ freq: 'yearly' })
    expect(nextOccurrence(spec, { after: { date: '2024-02-29', time: null }, ctx })?.date).toBe(
      '2025-02-28',
    )
  })

  test('month-anchored positionals recur yearly on each anchored month', () => {
    // every 1st wed jan, 3rd thu jul (dossier §1.3 positional row)
    const spec = mk({
      freq: 'yearly',
      ordinals: [
        { nth: 1, unit: 'weekday', weekday: 3, month: 1 },
        { nth: 3, unit: 'weekday', weekday: 4, month: 7 },
      ],
    })
    // 3rd Thu Jul 2026 = Jul 16 → 1st Wed Jan 2027 = Jan 6 → 3rd Thu Jul 2027 = Jul 15
    expect(sequence(spec, '2026-07-15', 3)).toEqual(['2026-07-16', '2027-01-06', '2027-07-15'])
  })
})

describe('daily and counted-workday intervals', () => {
  test('every 3 days', () => {
    const spec = mk({ freq: 'daily', interval: 3 })
    expect(sequence(spec, '2026-07-15', 3)).toEqual(['2026-07-18', '2026-07-21', '2026-07-24'])
  })

  test('every 3 workday counts only workdays', () => {
    const spec = mk({ freq: 'daily', interval: 3, weekdays: ['workday'] })
    // after Fri Jul 17: Mon 20 (1), Tue 21 (2), Wed 22 (3)
    expect(nextOccurrence(spec, { after: { date: '2026-07-17', time: null }, ctx })?.date).toBe(
      '2026-07-22',
    )
  })
})

describe('hourly stepping', () => {
  test('every 12 hours crosses midnight on the wall clock', () => {
    const spec = mk({ freq: 'hourly', interval: 12, times: ['21:00'] })
    expect(nextOccurrence(spec, { after: { date: '2026-07-15', time: '21:00' }, ctx })).toEqual({
      date: '2026-07-16',
      time: '09:00',
    })
    expect(nextOccurrence(spec, { after: { date: '2026-07-16', time: '09:00' }, ctx })).toEqual({
      date: '2026-07-16',
      time: '21:00',
    })
  })
})

describe('bounds and anchors', () => {
  test('until is inclusive; occurrences past it end the series (plan fixture)', () => {
    const spec = mk({ freq: 'daily', until: '2026-07-20' })
    expect(nextOccurrence(spec, { after: { date: '2026-07-19', time: null }, ctx })?.date).toBe(
      '2026-07-20',
    )
    expect(nextOccurrence(spec, { after: { date: '2026-07-20', time: null }, ctx })).toBeNull()
  })

  test('completion anchor: advance from the completion date (plan fixture)', () => {
    const spec = mk({ anchor: 'completion', freq: 'daily', interval: 3 })
    // task completed 2026-07-22 → next due 3 days after completion
    expect(nextOccurrence(spec, { after: { date: '2026-07-22', time: null }, ctx })?.date).toBe(
      '2026-07-25',
    )
  })

  test('starting bound pulls the next occurrence forward to it', () => {
    const spec = mk({ freq: 'daily', starting: '2026-08-01' })
    expect(nextOccurrence(spec, { after: { date: '2026-07-16', time: null }, ctx })?.date).toBe(
      '2026-08-01',
    )
  })

  test('starting bound on a weekly pattern lands on the first listed day at/after it', () => {
    const spec = mk({ freq: 'weekly', weekdays: [1], starting: '2026-08-01' })
    // 2026-08-01 is a Saturday → first Monday at/after is Aug 3
    expect(nextOccurrence(spec, { after: { date: '2026-07-20', time: null }, ctx })?.date).toBe(
      '2026-08-03',
    )
  })

  test('a spec that can never occur returns null instead of looping', () => {
    const spec = mk({ freq: 'yearly', dates: [{ month: 2, day: 30 }] })
    expect(nextOccurrence(spec, { after: { date: '2026-07-15', time: null }, ctx })).toBeNull()
  })
})
