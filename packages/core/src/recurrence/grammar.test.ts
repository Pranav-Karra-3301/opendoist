import { describe, expect, test } from 'vitest'
import { DEFAULT_PARSE_CONTEXT_SETTINGS, type ParseContext, RecurrenceSpecSchema } from '../types'
import { parseRecurrenceText } from './index'

/** Wed 2026-07-15, 17:00 in New York */
const ctx: ParseContext = {
  now: '2026-07-15T21:00:00Z',
  timezone: 'America/New_York',
  ...DEFAULT_PARSE_CONTEXT_SETTINGS,
}

interface Row {
  input: string
  spec: Record<string, unknown>
  firstDate: string
  firstTime?: string | null
  consumed?: number
}

describe('plan fixture rows', () => {
  const rows: Row[] = [
    {
      input: 'every day',
      spec: { anchor: 'schedule', freq: 'daily', interval: 1 },
      firstDate: '2026-07-16',
      consumed: 9,
    },
    { input: 'daily', spec: { freq: 'daily', interval: 1 }, firstDate: '2026-07-16', consumed: 5 },
    {
      input: 'every workday',
      spec: { freq: 'weekly', interval: 1, weekdays: ['workday'] },
      firstDate: '2026-07-16',
    },
    {
      input: 'every! 3 days',
      spec: { anchor: 'completion', freq: 'daily', interval: 3 },
      firstDate: '2026-07-18',
    },
    {
      input: 'after 10 days',
      spec: { anchor: 'completion', freq: 'daily', interval: 10 },
      firstDate: '2026-07-25',
    },
    {
      input: 'every other tue',
      spec: { freq: 'weekly', interval: 2, weekdays: [2] },
      firstDate: '2026-07-21',
    },
    {
      input: 'every 3rd friday',
      spec: { freq: 'monthly', interval: 1, ordinal: { nth: 3, unit: 'weekday', weekday: 5 } },
      firstDate: '2026-07-17',
    },
    {
      input: 'every last day',
      spec: { freq: 'monthly', ordinal: { nth: 'last', unit: 'day', weekday: null } },
      firstDate: '2026-07-31',
    },
    {
      input: 'every mon, fri at 20:00',
      spec: { freq: 'weekly', interval: 1, weekdays: [1, 5], times: ['20:00'] },
      firstDate: '2026-07-17',
      firstTime: '20:00',
      consumed: 23,
    },
    {
      input: 'every 2, 15, 27',
      spec: { freq: 'monthly', interval: 1, monthDays: [2, 15, 27] },
      firstDate: '2026-07-27',
    },
    {
      input: 'every 14 jan, 14 apr',
      spec: {
        freq: 'yearly',
        interval: 1,
        dates: [
          { month: 1, day: 14 },
          { month: 4, day: 14 },
        ],
      },
      firstDate: '2027-01-14',
    },
    { input: 'every quarter', spec: { freq: 'monthly', interval: 3 }, firstDate: '2026-10-15' },
    {
      input: 'ev monday',
      spec: { freq: 'weekly', interval: 1, weekdays: [1] },
      firstDate: '2026-07-20',
    },
    {
      input: 'every day starting aug 1',
      spec: { freq: 'daily', interval: 1, starting: '2026-08-01' },
      firstDate: '2026-08-01',
      consumed: 24,
    },
    {
      input: 'everyday from 10 May until 20 May',
      spec: { freq: 'daily', interval: 1, starting: '2027-05-10', until: '2027-05-20' },
      firstDate: '2027-05-10',
    },
    {
      input: 'every day for 3 weeks',
      spec: { freq: 'daily', interval: 1, until: '2026-08-06' },
      firstDate: '2026-07-16',
    },
    {
      input: 'every 12 hours starting at 9pm',
      spec: { freq: 'hourly', interval: 12, times: ['21:00'], starting: null },
      firstDate: '2026-07-15',
      firstTime: '21:00',
    },
  ]

  test.each(rows)('$input', ({ input, spec, firstDate, firstTime, consumed }) => {
    const r = parseRecurrenceText(input, ctx)
    expect(r).not.toBeNull()
    if (r === null) return
    expect(RecurrenceSpecSchema.parse(r.spec)).toEqual(r.spec)
    expect(r.spec).toMatchObject(spec)
    expect(r.firstDate).toBe(firstDate)
    if (firstTime !== undefined) expect(r.firstTime).toBe(firstTime)
    if (consumed !== undefined) expect(r.consumed).toBe(consumed)
  })
})

describe('remaining dossier §1.3 grammar rows', () => {
  const rows: Row[] = [
    // basic frequencies + shorthands
    { input: 'every week', spec: { freq: 'weekly', interval: 1 }, firstDate: '2026-07-22' },
    { input: 'weekly', spec: { freq: 'weekly', interval: 1 }, firstDate: '2026-07-22' },
    { input: 'every month', spec: { freq: 'monthly', interval: 1 }, firstDate: '2026-08-15' },
    { input: 'monthly', spec: { freq: 'monthly', interval: 1 }, firstDate: '2026-08-15' },
    { input: 'quarterly', spec: { freq: 'monthly', interval: 3 }, firstDate: '2026-10-15' },
    { input: 'every year', spec: { freq: 'yearly', interval: 1 }, firstDate: '2027-07-15' },
    { input: 'yearly', spec: { freq: 'yearly', interval: 1 }, firstDate: '2027-07-15' },
    { input: 'annually', spec: { freq: 'yearly', interval: 1 }, firstDate: '2027-07-15' },
    {
      input: 'hourly',
      spec: { freq: 'hourly', interval: 1 },
      firstDate: '2026-07-15',
      firstTime: '18:00',
    },
    {
      input: 'every hour',
      spec: { freq: 'hourly', interval: 1 },
      firstDate: '2026-07-15',
      firstTime: '18:00',
    },
    {
      input: 'every weekday',
      spec: { freq: 'weekly', interval: 1, weekdays: ['workday'] },
      firstDate: '2026-07-16',
    },
    {
      input: 'ev monday, friday',
      spec: { freq: 'weekly', interval: 1, weekdays: [1, 5] },
      firstDate: '2026-07-17',
    },
    // intervals
    { input: 'every 3 days', spec: { freq: 'daily', interval: 3 }, firstDate: '2026-07-18' },
    {
      input: 'every 3 workday',
      spec: { freq: 'daily', interval: 3, weekdays: ['workday'] },
      firstDate: '2026-07-20',
    },
    { input: 'every other day', spec: { freq: 'daily', interval: 2 }, firstDate: '2026-07-17' },
    { input: 'every other week', spec: { freq: 'weekly', interval: 2 }, firstDate: '2026-07-29' },
    { input: 'every other month', spec: { freq: 'monthly', interval: 2 }, firstDate: '2026-09-15' },
    { input: 'every other year', spec: { freq: 'yearly', interval: 2 }, firstDate: '2028-07-15' },
    {
      input: 'every other fri',
      spec: { freq: 'weekly', interval: 2, weekdays: [5] },
      firstDate: '2026-07-17',
    },
    {
      input: 'every! 3 hours',
      spec: { anchor: 'completion', freq: 'hourly', interval: 3 },
      firstDate: '2026-07-15',
      firstTime: '20:00',
    },
    // positional
    {
      input: 'every 15th workday',
      spec: { freq: 'monthly', ordinal: { nth: 15, unit: 'workday', weekday: null } },
      firstDate: '2026-07-21',
    },
    {
      // dossier §1.3 positional list — regression: was wrongly rejected as 'outside the model'
      input: 'every 15th workday, first workday, last workday',
      spec: {
        freq: 'monthly',
        ordinal: null,
        ordinals: [
          { nth: 15, unit: 'workday', weekday: null, month: null },
          { nth: 1, unit: 'workday', weekday: null, month: null },
          { nth: 'last', unit: 'workday', weekday: null, month: null },
        ],
      },
      firstDate: '2026-07-21',
    },
    {
      // dossier §1.3 month-anchored positional — regression: was wrongly rejected
      input: 'every 1st wed jan, 3rd thu jul',
      spec: {
        freq: 'yearly',
        ordinal: null,
        ordinals: [
          { nth: 1, unit: 'weekday', weekday: 3, month: 1 },
          { nth: 3, unit: 'weekday', weekday: 4, month: 7 },
        ],
      },
      firstDate: '2026-07-16', // 3rd Thursday of July 2026
    },
    {
      input: 'every 1st wed of january',
      spec: {
        freq: 'yearly',
        ordinals: [{ nth: 1, unit: 'weekday', weekday: 3, month: 1 }],
      },
      firstDate: '2027-01-06',
    },
    {
      input: 'every first workday',
      spec: { freq: 'monthly', ordinal: { nth: 1, unit: 'workday', weekday: null } },
      firstDate: '2026-08-03',
    },
    {
      input: 'every last workday',
      spec: { freq: 'monthly', ordinal: { nth: 'last', unit: 'workday', weekday: null } },
      firstDate: '2026-07-31',
    },
    {
      input: 'every 15th day',
      spec: { freq: 'monthly', ordinal: { nth: 15, unit: 'day', weekday: null } },
      firstDate: '2026-08-15',
    },
    {
      input: 'every 27th',
      spec: { freq: 'monthly', monthDays: [27] },
      firstDate: '2026-07-27',
    },
    // multiple fixed dates (full dossier example)
    {
      input: 'every 14 jan, 14 apr, 15 jun, 15 sep',
      spec: {
        freq: 'yearly',
        dates: [
          { month: 1, day: 14 },
          { month: 4, day: 14 },
          { month: 6, day: 15 },
          { month: 9, day: 15 },
        ],
      },
      firstDate: '2026-09-15',
    },
    // 'after N unit' variants
    {
      input: 'after 2 weeks',
      spec: { anchor: 'completion', freq: 'weekly', interval: 2 },
      firstDate: '2026-07-29',
    },
    {
      input: 'after 6 hours',
      spec: { anchor: 'completion', freq: 'hourly', interval: 6 },
      firstDate: '2026-07-15',
      firstTime: '23:00',
    },
    {
      input: 'after 3 months',
      spec: { anchor: 'completion', freq: 'monthly', interval: 3 },
      firstDate: '2026-10-15',
    },
    // holiday words
    {
      input: 'every new year day',
      spec: { freq: 'yearly', dates: [{ month: 1, day: 1 }] },
      firstDate: '2027-01-01',
    },
    {
      input: 'every valentine',
      spec: { freq: 'yearly', dates: [{ month: 2, day: 14 }] },
      firstDate: '2027-02-14',
    },
    {
      input: 'every halloween',
      spec: { freq: 'yearly', dates: [{ month: 10, day: 31 }] },
      firstDate: '2026-10-31',
    },
    {
      input: "every new year's eve",
      spec: { freq: 'yearly', dates: [{ month: 12, day: 31 }] },
      firstDate: '2026-12-31',
    },
    // compound bounds (dossier §1.2 example built from §1.3 bounds)
    {
      input: 'every 3rd tuesday starting aug 29 ending in 6 months',
      spec: {
        freq: 'monthly',
        ordinal: { nth: 3, unit: 'weekday', weekday: 2 },
        starting: '2026-08-29',
        until: '2027-01-15',
      },
      firstDate: '2026-09-15',
    },
    // implicit daily ('!every 5pm' reminders) and time forms
    {
      input: 'every 5pm',
      spec: { freq: 'daily', interval: 1, times: ['17:00'] },
      firstDate: '2026-07-16',
      firstTime: '17:00',
    },
    {
      input: 'every 6pm',
      spec: { freq: 'daily', interval: 1, times: ['18:00'] },
      firstDate: '2026-07-15',
      firstTime: '18:00',
    },
    {
      input: 'ev Tuesday 7:00',
      spec: { freq: 'weekly', weekdays: [2], times: ['07:00'] },
      firstDate: '2026-07-21',
      firstTime: '07:00',
    },
    {
      input: 'every day at 9am and 9pm',
      spec: { freq: 'daily', interval: 1, times: ['09:00', '21:00'] },
      firstDate: '2026-07-16',
      firstTime: '09:00',
    },
    {
      input: 'every fri at 1900',
      spec: { freq: 'weekly', weekdays: [5], times: ['19:00'] },
      firstDate: '2026-07-17',
      firstTime: '19:00',
    },
    // case-insensitive
    { input: 'Every Day', spec: { freq: 'daily', interval: 1 }, firstDate: '2026-07-16' },
    {
      input: 'EVERY OTHER TUE',
      spec: { freq: 'weekly', interval: 2, weekdays: [2] },
      firstDate: '2026-07-21',
    },
    // month-first fixed date
    {
      input: 'every jan 14',
      spec: { freq: 'yearly', dates: [{ month: 1, day: 14 }] },
      firstDate: '2027-01-14',
    },
    // weekday list variants
    {
      input: 'every sat, sun',
      spec: { freq: 'weekly', weekdays: [6, 7] },
      firstDate: '2026-07-18',
    },
    {
      input: 'every mon and wed',
      spec: { freq: 'weekly', weekdays: [1, 3] },
      firstDate: '2026-07-20',
    },
    // bare 24h time implies daily
    {
      input: 'every 20:00',
      spec: { freq: 'daily', interval: 1, times: ['20:00'] },
      firstDate: '2026-07-15',
      firstTime: '20:00',
    },
  ]

  test.each(rows)('$input', ({ input, spec, firstDate, firstTime, consumed }) => {
    const r = parseRecurrenceText(input, ctx)
    expect(r).not.toBeNull()
    if (r === null) return
    expect(RecurrenceSpecSchema.parse(r.spec)).toEqual(r.spec)
    expect(r.spec).toMatchObject(spec)
    expect(r.firstDate).toBe(firstDate)
    if (firstTime !== undefined) expect(r.firstTime).toBe(firstTime)
    if (consumed !== undefined) expect(r.consumed).toBe(consumed)
  })
})

describe('non-recurrence and unsupported inputs return null', () => {
  test.each([
    ['not at start', 'buy milk every day'],
    ['everything is not every thing', 'everything is fine'],
    ['evening is not ev', 'evening at 5'],
    ['plain date phrase', 'tomorrow'],
    ['bare every', 'every'],
    ['bare ev', 'ev'],
    ['bare every!', 'every!'],
    ['every + non-unit', 'every now and then'],
    ['per-day different times (dossier: not supported)', 'every mon at 8pm, tue at 9pm'],
    ['mixed month-anchored and plain positional terms', 'every 1st wed, 3rd thu jul'],
    ['zero interval', 'every 0 days'],
    ['after without count', 'after lunch'],
  ])('%s: %j', (_name, input) => {
    expect(parseRecurrenceText(input, ctx)).toBeNull()
  })
})

describe('consumed span accounting', () => {
  test('includes leading whitespace offset', () => {
    const r = parseRecurrenceText('  every day', ctx)
    expect(r?.consumed).toBe(11)
  })

  test('stops before unrelated trailing text', () => {
    const r = parseRecurrenceText('every day, then rest', ctx)
    expect(r?.consumed).toBe(9)
  })

  test('stops before quick-add tokens after a bound', () => {
    const r = parseRecurrenceText('every day starting aug 1 #Work', ctx)
    expect(r?.consumed).toBe(24)
    expect(r?.spec.starting).toBe('2026-08-01')
  })

  test('covers a full weekday+time phrase', () => {
    const r = parseRecurrenceText('every mon, fri at 20:00 team sync', ctx)
    expect(r?.consumed).toBe(23)
  })
})

describe('bound edge cases', () => {
  test('for N days converts to inclusive until from firstDate', () => {
    const r = parseRecurrenceText('every day for 10 days', ctx)
    expect(r?.firstDate).toBe('2026-07-16')
    expect(r?.spec.until).toBe('2026-07-26')
  })

  test('starting with a date and a time seeds both', () => {
    const r = parseRecurrenceText('every day starting aug 1 at 9am', ctx)
    expect(r?.spec.starting).toBe('2026-08-01')
    expect(r?.spec.times).toEqual(['09:00'])
    expect(r?.firstDate).toBe('2026-08-01')
    expect(r?.firstTime).toBe('09:00')
  })

  test('until keyword alias "ending" resolves dates', () => {
    const r = parseRecurrenceText('every day ending aug 1', ctx)
    expect(r?.spec.until).toBe('2026-08-01')
  })

  test('smartDate=false does not disable explicit recurrence parsing', () => {
    // the smart-date toggle gates bare-text date recognition in Quick Add, not this API
    const r = parseRecurrenceText('every day', { ...ctx, smartDate: false })
    expect(r?.firstDate).toBe('2026-07-16')
  })

  test('a years-old starting bound catches up to today, not a step-cap artifact', () => {
    // regression: the 5000-iteration guard used to return 2010-01-01 + 5001 days (2023-09-10)
    const daily = parseRecurrenceText('every day starting jan 1 2010', ctx)
    expect(daily?.firstDate).toBe('2026-07-16')
    // phase is preserved: 2010-01-01 + 216 × 14 days = 2026-07-24
    const biweekly = parseRecurrenceText('every 2 weeks starting jan 1 2010', ctx)
    expect(biweekly?.firstDate).toBe('2026-07-24')
    // a time later than "now" allows today itself
    const timed = parseRecurrenceText('every day 11pm starting jan 1 2010', ctx)
    expect(timed?.firstDate).toBe('2026-07-15')
    expect(timed?.firstTime).toBe('23:00')
  })
})
