import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
// diffDays (date-fns differenceInCalendarDays) is an implementation independent from the
// engine's own UTC day math — using it for the DST assertion keeps the check non-circular
import { dateInTz, diffDays, instantFor, isoWeekday } from '../dates'
import {
  DEFAULT_PARSE_CONTEXT_SETTINGS,
  type ParseContext,
  type RecurrenceSpec,
  RecurrenceSpecSchema,
} from '../types'
import { addDaysUtc } from './engine'
import { nextOccurrence } from './index'

// default 100 runs; bump locally with FC_NUM_RUNS=5000 for a deeper sweep
fc.configureGlobal({ numRuns: Number(process.env.FC_NUM_RUNS ?? 100) })

const ctx: ParseContext = {
  now: '2026-07-15T21:00:00Z',
  timezone: 'America/New_York',
  ...DEFAULT_PARSE_CONTEXT_SETTINGS,
}

const pad2 = (n: number) => String(n).padStart(2, '0')

function mk(partial: Partial<RecurrenceSpec> & Pick<RecurrenceSpec, 'freq'>): RecurrenceSpec {
  return RecurrenceSpecSchema.parse({ anchor: 'schedule', interval: 1, ...partial })
}

/* ---------- arbitraries ---------- */

const timeArb = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(([h, m]) => `${pad2(h)}:${pad2(m)}`)
const timesArb = fc.array(timeArb, { maxLength: 2 }).map((ts) => [...new Set(ts)].sort())
const dateArb = fc.integer({ min: 0, max: 1825 }).map((d) => addDaysUtc('2024-01-01', d))
const anchorArb = fc.constantFrom<RecurrenceSpec['anchor']>('schedule', 'completion')
const weekdayListArb = fc.oneof(
  fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 4 }),
  fc.constant<(number | 'workday')[]>(['workday']),
)

const dailyPlainArb = fc
  .record({ anchor: anchorArb, interval: fc.integer({ min: 1, max: 14 }), times: timesArb })
  .map((r) => mk({ freq: 'daily', ...r }))
const dailyCountedArb = fc
  .record({
    anchor: anchorArb,
    interval: fc.integer({ min: 1, max: 5 }),
    weekdays: weekdayListArb,
    times: timesArb,
  })
  .map((r) => mk({ freq: 'daily', ...r }))
const weeklyPlainArb = fc
  .record({ anchor: anchorArb, interval: fc.integer({ min: 1, max: 8 }), times: timesArb })
  .map((r) => mk({ freq: 'weekly', ...r }))
const weeklyDaysArb = fc
  .record({
    anchor: anchorArb,
    interval: fc.integer({ min: 1, max: 4 }),
    weekdays: weekdayListArb,
    times: timesArb,
  })
  .map((r) => mk({ freq: 'weekly', ...r }))
const monthlyPlainArb = fc
  .record({ anchor: anchorArb, interval: fc.integer({ min: 1, max: 12 }), times: timesArb })
  .map((r) => mk({ freq: 'monthly', ...r }))
const monthlyDaysArb = fc
  .record({
    anchor: anchorArb,
    interval: fc.integer({ min: 1, max: 3 }),
    monthDays: fc.uniqueArray(
      fc.oneof(fc.integer({ min: 1, max: 28 }), fc.constant<'last'>('last')),
      { minLength: 1, maxLength: 3 },
    ),
    times: timesArb,
  })
  .map((r) => mk({ freq: 'monthly', ...r }))
const ordinalArb: fc.Arbitrary<NonNullable<RecurrenceSpec['ordinal']>> = fc.oneof(
  fc.record({
    nth: fc.oneof(fc.integer({ min: 1, max: 4 }), fc.constant<'last'>('last')),
    unit: fc.constant<'weekday'>('weekday'),
    weekday: fc.integer({ min: 1, max: 7 }),
  }),
  fc.record({
    nth: fc.oneof(fc.integer({ min: 1, max: 20 }), fc.constant<'last'>('last')),
    unit: fc.constant<'workday'>('workday'),
    weekday: fc.constant(null),
  }),
  fc.record({
    nth: fc.oneof(fc.integer({ min: 1, max: 28 }), fc.constant<'last'>('last')),
    unit: fc.constant<'day'>('day'),
    weekday: fc.constant(null),
  }),
)
const monthlyOrdinalArb = fc
  .record({
    anchor: anchorArb,
    interval: fc.integer({ min: 1, max: 3 }),
    ordinal: ordinalArb,
    times: timesArb,
  })
  .map((r) => mk({ freq: 'monthly', ...r }))
// positional lists ('every 15th workday, first workday') — entries kept existence-safe
// (nth bounds as ordinalArb) so every month has a candidate
const monthlyOrdinalListArb = fc
  .record({
    anchor: anchorArb,
    interval: fc.integer({ min: 1, max: 3 }),
    ordinals: fc.array(
      ordinalArb.map((o) => ({ ...o, month: null })),
      { minLength: 2, maxLength: 3 },
    ),
    times: timesArb,
  })
  .map((r) => mk({ freq: 'monthly', ...r }))
// month-anchored positionals ('every 1st wed jan, 3rd thu jul')
const yearlyOrdinalArb = fc
  .record({
    anchor: anchorArb,
    interval: fc.integer({ min: 1, max: 2 }),
    ordinals: fc.array(
      fc.tuple(ordinalArb, fc.integer({ min: 1, max: 12 })).map(([o, month]) => ({ ...o, month })),
      { minLength: 1, maxLength: 3 },
    ),
    times: timesArb,
  })
  .map((r) => mk({ freq: 'yearly', ...r }))
const yearlyPlainArb = fc
  .record({ anchor: anchorArb, interval: fc.integer({ min: 1, max: 3 }), times: timesArb })
  .map((r) => mk({ freq: 'yearly', ...r }))
const yearlyDatesArb = fc
  .record({
    anchor: anchorArb,
    interval: fc.integer({ min: 1, max: 2 }),
    dates: fc.uniqueArray(
      fc.record({
        month: fc.integer({ min: 1, max: 12 }),
        day: fc.integer({ min: 1, max: 28 }),
      }),
      { minLength: 1, maxLength: 3, selector: (e) => `${e.month}-${e.day}` },
    ),
    times: timesArb,
  })
  .map((r) => mk({ freq: 'yearly', ...r }))
const hourlyArb = fc
  .record({
    anchor: anchorArb,
    interval: fc.integer({ min: 1, max: 48 }),
    times: fc.oneof(
      fc.constant<string[]>([]),
      timeArb.map((t) => [t]),
    ),
  })
  .map((r) => mk({ freq: 'hourly', ...r }))

const specArb: fc.Arbitrary<RecurrenceSpec> = fc.oneof(
  dailyPlainArb,
  dailyCountedArb,
  weeklyPlainArb,
  weeklyDaysArb,
  monthlyPlainArb,
  monthlyDaysArb,
  monthlyOrdinalArb,
  monthlyOrdinalListArb,
  yearlyPlainArb,
  yearlyDatesArb,
  yearlyOrdinalArb,
  hourlyArb,
)

type Occ = { date: string; time: string | null }
const afterFor = (spec: RecurrenceSpec, date: string, time: string | null): Occ => ({
  date,
  // hourly advancement is time-based; always give it a time
  time: spec.freq === 'hourly' ? (time ?? '12:00') : time,
})
const occLater = (a: Occ, b: Occ): boolean =>
  a.date > b.date || (a.date === b.date && (a.time ?? '') > (b.time ?? ''))

/* ---------- properties ---------- */

describe('nextOccurrence properties', () => {
  test('(1) strictly advances: later date, or same date with later time for hourly', () => {
    fc.assert(
      fc.property(specArb, dateArb, fc.option(timeArb, { nil: null }), (spec, date, time) => {
        const after = afterFor(spec, date, time)
        const next = nextOccurrence(spec, { after, ctx })
        expect(next).not.toBeNull()
        if (next === null) return
        if (spec.freq === 'hourly') {
          expect(occLater(next, after)).toBe(true)
        } else {
          expect(next.date > after.date).toBe(true)
        }
      }),
    )
  })

  test('(2) applying next twice is monotonic', () => {
    fc.assert(
      fc.property(specArb, dateArb, fc.option(timeArb, { nil: null }), (spec, date, time) => {
        const after = afterFor(spec, date, time)
        const o1 = nextOccurrence(spec, { after, ctx })
        expect(o1).not.toBeNull()
        if (o1 === null) return
        const o2 = nextOccurrence(spec, { after: o1, ctx })
        expect(o2).not.toBeNull()
        if (o2 === null) return
        expect(occLater(o2, o1)).toBe(true)
      }),
    )
  })

  test('(3) weekday-constrained specs always land on a listed weekday', () => {
    fc.assert(
      fc.property(fc.oneof(weeklyDaysArb, dailyCountedArb), dateArb, (spec, date) => {
        const allowed = new Set<number>()
        for (const w of spec.weekdays) {
          if (w === 'workday') for (let d = 1; d <= 5; d++) allowed.add(d)
          else allowed.add(w)
        }
        let after: Occ = { date, time: null }
        for (let i = 0; i < 3; i++) {
          const next = nextOccurrence(spec, { after, ctx })
          expect(next).not.toBeNull()
          if (next === null) return
          expect(allowed.has(isoWeekday(next.date))).toBe(true)
          after = next
        }
      }),
    )
  })

  test('(4) daily specs advance exactly one calendar day across DST transitions', () => {
    // America/New_York 2026: spring forward Mar 8 (02:00 skipped), fall back Nov 1 (01:00 repeated)
    const dstWindowArb = fc.oneof(
      fc.integer({ min: -3, max: 3 }).map((o) => addDaysUtc('2026-03-08', o)),
      fc.integer({ min: -3, max: 3 }).map((o) => addDaysUtc('2026-11-01', o)),
    )
    fc.assert(
      fc.property(dstWindowArb, timesArb, (date, times) => {
        const spec = mk({ freq: 'daily', interval: 1, times })
        const next = nextOccurrence(spec, { after: { date, time: times[0] ?? null }, ctx })
        expect(next).not.toBeNull()
        if (next === null) return
        expect(diffDays(date, next.date)).toBe(1)
        // materializing the wall-clock occurrence must stay on the same calendar date,
        // including the skipped hour (02:xx on Mar 8) and the repeated hour (01:xx on Nov 1)
        const instant = instantFor(next.date, next.time ?? '09:00', 'America/New_York')
        expect(instant.endsWith('Z')).toBe(true)
        expect(dateInTz(instant, 'America/New_York')).toBe(next.date)
      }),
    )
  })
})
