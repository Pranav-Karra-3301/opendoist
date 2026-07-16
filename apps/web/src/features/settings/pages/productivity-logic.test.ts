import { describe, expect, it } from 'vitest'
import { clampGoal, isDayOff, toggleDayOff } from './productivity-logic'

/** Core `daysOff` default (Sat/Sun) — the round-trip anchor for the day-off chips. */
const DEFAULT_DAYS_OFF = [6, 7]

describe('toggleDayOff', () => {
  it('round-trips the [6,7] default when a day is added then removed', () => {
    const added = toggleDayOff(DEFAULT_DAYS_OFF, 1)
    expect(added).toEqual([1, 6, 7])
    expect(toggleDayOff(added, 1)).toEqual([6, 7])
  })

  it('round-trips the [6,7] default when a day is removed then re-added', () => {
    const removed = toggleDayOff(DEFAULT_DAYS_OFF, 6)
    expect(removed).toEqual([7])
    expect(toggleDayOff(removed, 6)).toEqual([6, 7])
  })

  it('keeps the result ascending regardless of insertion order', () => {
    expect(toggleDayOff([7], 1)).toEqual([1, 7])
    expect(toggleDayOff([6, 7], 3)).toEqual([3, 6, 7])
  })

  it('does not mutate the input array', () => {
    const input = [6, 7]
    toggleDayOff(input, 1)
    expect(input).toEqual([6, 7])
  })

  it('clears to an empty set when the last day is toggled off', () => {
    expect(toggleDayOff([6], 6)).toEqual([])
  })
})

describe('isDayOff', () => {
  it('reflects membership in the days-off set', () => {
    expect(isDayOff(DEFAULT_DAYS_OFF, 6)).toBe(true)
    expect(isDayOff(DEFAULT_DAYS_OFF, 7)).toBe(true)
    expect(isDayOff(DEFAULT_DAYS_OFF, 1)).toBe(false)
  })
})

describe('clampGoal', () => {
  it('passes through an in-range value', () => {
    expect(clampGoal('5', 0, 100)).toBe(5)
    expect(clampGoal(25, 0, 700)).toBe(25)
  })

  it('clamps above the maximum and below the minimum', () => {
    expect(clampGoal('150', 0, 100)).toBe(100)
    expect(clampGoal('-3', 0, 100)).toBe(0)
  })

  it('falls back to the minimum for empty or non-numeric input', () => {
    expect(clampGoal('', 0, 100)).toBe(0)
    expect(clampGoal('abc', 0, 700)).toBe(0)
  })

  it('truncates fractional entries to a whole goal', () => {
    expect(clampGoal('3.9', 0, 100)).toBe(3)
  })
})
