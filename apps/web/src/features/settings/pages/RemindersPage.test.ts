import { describe, expect, it } from 'vitest'
import { REMINDER_OPTIONS, reminderMinutesFromValue, reminderSelectValue } from './RemindersPage'

describe('reminderMinutesFromValue', () => {
  it('maps "None" to null (no extra heads-up)', () => {
    expect(reminderMinutesFromValue('none')).toBeNull()
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

  it('maps a legacy stored 0 to "none" (the at-time reminder is built in)', () => {
    expect(reminderSelectValue(0)).toBe('none')
  })

  it('maps the default 30 to its option', () => {
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

  it('offers off and the minutes-before offsets, without the redundant at-time entry', () => {
    expect(REMINDER_OPTIONS.map((o) => o.minutes)).toEqual([null, 5, 10, 15, 30, 45, 60, 120])
  })
})
