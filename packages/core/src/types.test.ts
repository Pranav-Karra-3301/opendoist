import { describe, expect, test } from 'vitest'
import {
  DeadlineSchema,
  DueSchema,
  HmTimeSchema,
  IsoDateSchema,
  ParsedQuickAddSchema,
  PrioritySchema,
  RecurrenceSpecSchema,
  WeekdaySchema,
} from './types'

describe('PrioritySchema', () => {
  test.each([1, 2, 3, 4] as const)('accepts %d', (p) => {
    expect(PrioritySchema.parse(p)).toBe(p)
  })
  test.each([0, 5, -1, 1.5, '1'])('rejects %j', (p) => {
    expect(PrioritySchema.safeParse(p).success).toBe(false)
  })
})

describe('IsoDateSchema / HmTimeSchema / WeekdaySchema', () => {
  test('date format', () => {
    expect(IsoDateSchema.parse('2026-07-15')).toBe('2026-07-15')
    expect(IsoDateSchema.safeParse('2026-7-15').success).toBe(false)
    expect(IsoDateSchema.safeParse('20260715').success).toBe(false)
  })
  test('time format', () => {
    expect(HmTimeSchema.parse('09:30')).toBe('09:30')
    expect(HmTimeSchema.parse('23:59')).toBe('23:59')
    expect(HmTimeSchema.safeParse('24:00').success).toBe(false)
    expect(HmTimeSchema.safeParse('9:30').success).toBe(false)
  })
  test('weekday bounds', () => {
    expect(WeekdaySchema.parse(1)).toBe(1)
    expect(WeekdaySchema.parse(7)).toBe(7)
    expect(WeekdaySchema.safeParse(0).success).toBe(false)
    expect(WeekdaySchema.safeParse(8).success).toBe(false)
  })
})

describe('RecurrenceSpecSchema', () => {
  test('applies defaults for optional collections', () => {
    const spec = RecurrenceSpecSchema.parse({ anchor: 'schedule', freq: 'daily', interval: 1 })
    expect(spec).toEqual({
      anchor: 'schedule',
      freq: 'daily',
      interval: 1,
      weekdays: [],
      monthDays: [],
      ordinal: null,
      ordinals: [],
      dates: [],
      times: [],
      starting: null,
      until: null,
    })
  })

  test('parses a fully specified object and round-trips it', () => {
    const full = {
      anchor: 'completion' as const,
      freq: 'monthly' as const,
      interval: 2,
      weekdays: [1, 5, 'workday'] as const,
      monthDays: [2, 15, 'last'] as const,
      ordinal: { nth: 3 as const, unit: 'weekday' as const, weekday: 5 },
      ordinals: [
        { nth: 1 as const, unit: 'weekday' as const, weekday: 3, month: 1 },
        { nth: 'last' as const, unit: 'workday' as const, weekday: null, month: null },
      ],
      dates: [
        { month: 1, day: 14 },
        { month: 4, day: 14 },
      ],
      times: ['20:00'],
      starting: '2026-08-01',
      until: '2026-12-31',
    }
    expect(RecurrenceSpecSchema.parse(full)).toEqual(full)
  })

  test('rejects invalid values', () => {
    expect(
      RecurrenceSpecSchema.safeParse({ anchor: 'schedule', freq: 'daily', interval: 0 }).success,
    ).toBe(false)
    expect(
      RecurrenceSpecSchema.safeParse({ anchor: 'sometimes', freq: 'daily', interval: 1 }).success,
    ).toBe(false)
    expect(
      RecurrenceSpecSchema.safeParse({
        anchor: 'schedule',
        freq: 'monthly',
        interval: 1,
        monthDays: [32],
      }).success,
    ).toBe(false)
    expect(
      RecurrenceSpecSchema.safeParse({
        anchor: 'schedule',
        freq: 'yearly',
        interval: 1,
        ordinals: [{ nth: 1, unit: 'weekday', weekday: 3, month: 13 }],
      }).success,
    ).toBe(false)
  })
})

describe('DueSchema', () => {
  test('accepts all-day and timed dues', () => {
    expect(
      DueSchema.parse({ date: '2026-07-16', time: null, string: 'tomorrow', recurrence: null }),
    ).toMatchObject({ date: '2026-07-16', time: null })
    expect(
      DueSchema.parse({ date: '2026-07-16', time: '16:00', string: 'tom 4pm', recurrence: null }),
    ).toMatchObject({ time: '16:00' })
  })
})

describe('DeadlineSchema', () => {
  test('accepts date-only and timed deadlines', () => {
    expect(DeadlineSchema.parse({ date: '2026-07-30', time: null })).toEqual({
      date: '2026-07-30',
      time: null,
    })
    expect(DeadlineSchema.parse({ date: '2026-07-30', time: '17:00' })).toEqual({
      date: '2026-07-30',
      time: '17:00',
    })
  })
  test('rejects malformed dates/times and the old bare-string shape', () => {
    expect(DeadlineSchema.safeParse({ date: '2026-7-30', time: null }).success).toBe(false)
    expect(DeadlineSchema.safeParse({ date: '2026-07-30', time: '5pm' }).success).toBe(false)
    expect(DeadlineSchema.safeParse({ date: '2026-07-30' }).success).toBe(false)
    expect(DeadlineSchema.safeParse('2026-07-30').success).toBe(false)
  })
})

describe('ParsedQuickAddSchema', () => {
  test('round-trips a representative object', () => {
    const parsed = {
      title: 'Submit report',
      tokens: [
        { kind: 'due' as const, start: 14, end: 21, text: 'tom 4pm' },
        { kind: 'priority' as const, start: 22, end: 24, text: 'p1' },
      ],
      due: {
        date: '2026-07-16',
        time: '16:00',
        string: 'tom 4pm',
        recurrence: null,
      },
      durationMin: 45,
      deadline: { date: '2026-07-30', time: null },
      priority: 1 as const,
      labels: ['email'],
      project: 'Work',
      section: 'Admin',
      reminders: [
        { kind: 'relative' as const, minutesBefore: 30 },
        { kind: 'absolute' as const, date: '2026-07-16', time: '09:00' },
      ],
      description: 'gate closes 30m before',
      uncompletable: false,
    }
    expect(ParsedQuickAddSchema.parse(parsed)).toEqual(parsed)
  })

  test('rejects out-of-range duration', () => {
    const base = {
      title: 'x',
      tokens: [],
      due: null,
      deadline: null,
      priority: 4,
      labels: [],
      project: null,
      section: null,
      reminders: [],
      description: null,
      uncompletable: false,
    }
    expect(ParsedQuickAddSchema.safeParse({ ...base, durationMin: 0 }).success).toBe(false)
    expect(ParsedQuickAddSchema.safeParse({ ...base, durationMin: 1441 }).success).toBe(false)
    expect(ParsedQuickAddSchema.safeParse({ ...base, durationMin: 1440 }).success).toBe(true)
  })
})
