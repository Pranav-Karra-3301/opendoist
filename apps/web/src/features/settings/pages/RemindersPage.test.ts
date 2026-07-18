import { describe, expect, it } from 'vitest'
import { REMINDER_OPTIONS, reminderMinutesFromValue, reminderSelectValue } from './RemindersPage'

describe('reminderMinutesFromValue', () => {
  it('maps "None" to null (no automatic reminder)', () => {
    expect(reminderMinutesFromValue('none')).toBeNull()
  })

  it('maps "At due time" to 0, not null', () => {
    expect(reminderMinutesFromValue('0')).toBe(0)
  })

  it('maps a minutes-before choice to its number', () => {
    expect(reminderMinutesFromValue('30')).toBe(30)
    expect(reminderMinutesFromValue('120')).toBe(120)
  })

  it('falls back to null for an unknown value', () => {
    expect(reminderMinutesFromValue('nope')).toBeNull()
  })
})

describe('reminderSelectValue', () => {
  it('maps null to the "none" option', () => {
    expect(reminderSelectValue(null)).toBe('none')
  })

  it('maps 0 to the "at due time" option (distinct from null)', () => {
    expect(reminderSelectValue(0)).toBe('0')
  })

  it('maps 30 to its option', () => {
    expect(reminderSelectValue(30)).toBe('30')
  })

  it('falls back to "none" for an off-menu value', () => {
    expect(reminderSelectValue(999)).toBe('none')
  })
})

describe('REMINDER_OPTIONS', () => {
  it('round-trips every option value ↔ minutes', () => {
    for (const o of REMINDER_OPTIONS) {
      expect(reminderMinutesFromValue(o.value)).toBe(o.minutes)
      expect(reminderSelectValue(o.minutes)).toBe(o.value)
    }
  })

  it('offers the offset menu the server accepts (off, at-time, and minutes-before)', () => {
    expect(REMINDER_OPTIONS.map((o) => o.minutes)).toEqual([null, 0, 5, 10, 15, 30, 45, 60, 120])
  })
})
