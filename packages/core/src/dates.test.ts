import { describe, expect, test } from 'vitest'
import {
  addDaysIso,
  compareIso,
  dateInTz,
  diffDays,
  instantFor,
  isoWeekday,
  lastDayOfMonth,
  nextWeekdayOnOrAfter,
  timeInTz,
} from './dates'

describe('dateInTz / timeInTz', () => {
  test('late-UTC instant is previous day in New York', () => {
    expect(dateInTz('2026-07-15T03:00:00Z', 'America/New_York')).toBe('2026-07-14')
    expect(timeInTz('2026-07-15T03:00:00Z', 'America/New_York')).toBe('23:00')
  })
  test('same instant, different zones', () => {
    expect(dateInTz('2026-07-15T21:00:00Z', 'America/New_York')).toBe('2026-07-15')
    expect(timeInTz('2026-07-15T21:00:00Z', 'America/New_York')).toBe('17:00')
    expect(dateInTz('2026-07-15T21:00:00Z', 'Asia/Tokyo')).toBe('2026-07-16')
    expect(timeInTz('2026-07-15T21:00:00Z', 'Asia/Tokyo')).toBe('06:00')
  })
})

describe('isoWeekday', () => {
  test('2026-07-15 is a Wednesday (3)', () => {
    expect(isoWeekday('2026-07-15')).toBe(3)
  })
  test('Monday=1 and Sunday=7', () => {
    expect(isoWeekday('2026-07-13')).toBe(1)
    expect(isoWeekday('2026-07-19')).toBe(7)
  })
})

describe('addDaysIso / diffDays / compareIso', () => {
  test('adds across month boundaries', () => {
    expect(addDaysIso('2026-07-30', 3)).toBe('2026-08-02')
    expect(addDaysIso('2026-07-15', -15)).toBe('2026-06-30')
  })
  test('advances exactly one calendar day across US DST transitions regardless of host TZ', () => {
    expect(addDaysIso('2026-03-08', 1)).toBe('2026-03-09') // spring forward
    expect(addDaysIso('2026-11-01', 1)).toBe('2026-11-02') // fall back
    expect(addDaysIso('2026-03-09', -1)).toBe('2026-03-08')
  })
  test('diffDays is b minus a', () => {
    expect(diffDays('2026-07-15', '2026-07-20')).toBe(5)
    expect(diffDays('2026-07-20', '2026-07-15')).toBe(-5)
  })
  test('compareIso ordering', () => {
    expect(compareIso('2026-07-15', '2026-07-16')).toBe(-1)
    expect(compareIso('2026-07-16', '2026-07-15')).toBe(1)
    expect(compareIso('2026-07-15', '2026-07-15')).toBe(0)
  })
})

describe('nextWeekdayOnOrAfter', () => {
  test('same-day allowed by default', () => {
    expect(nextWeekdayOnOrAfter('2026-07-15', 3)).toBe('2026-07-15')
  })
  test('same-day disallowed jumps a full week', () => {
    expect(nextWeekdayOnOrAfter('2026-07-15', 3, false)).toBe('2026-07-22')
  })
  test('forward to weekday later this week', () => {
    expect(nextWeekdayOnOrAfter('2026-07-15', 5)).toBe('2026-07-17')
    expect(nextWeekdayOnOrAfter('2026-07-15', 1)).toBe('2026-07-20')
  })
})

describe('lastDayOfMonth', () => {
  test('handles leap years and short months', () => {
    expect(lastDayOfMonth(2026, 2)).toBe(28)
    expect(lastDayOfMonth(2028, 2)).toBe(29)
    expect(lastDayOfMonth(2026, 7)).toBe(31)
    expect(lastDayOfMonth(2026, 9)).toBe(30)
  })
})

describe('instantFor', () => {
  test('summer EDT offset', () => {
    expect(instantFor('2026-07-15', '17:00', 'America/New_York')).toBe('2026-07-15T21:00:00.000Z')
  })
  test('winter EST offset', () => {
    expect(instantFor('2026-01-15', '17:00', 'America/New_York')).toBe('2026-01-15T22:00:00.000Z')
  })
  test('DST-ambiguous wall clock still returns a valid instant', () => {
    const iso = instantFor('2026-11-01', '01:30', 'America/New_York')
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/)
    expect(Number.isNaN(Date.parse(iso))).toBe(false)
  })
  test('round-trips through dateInTz/timeInTz', () => {
    const iso = instantFor('2026-07-16', '09:30', 'America/New_York')
    expect(dateInTz(iso, 'America/New_York')).toBe('2026-07-16')
    expect(timeInTz(iso, 'America/New_York')).toBe('09:30')
  })
})
