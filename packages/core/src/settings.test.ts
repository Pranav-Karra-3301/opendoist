import { describe, expect, it } from 'vitest'
import {
  DEFAULT_USER_SETTINGS,
  DEFAULT_VIEW_PREFS,
  UserSettingsPatchSchema,
  UserSettingsSchema,
  viewKey,
} from './settings'

describe('UserSettingsSchema', () => {
  it('parses an empty document into full defaults', () => {
    expect(UserSettingsSchema.parse({})).toEqual(DEFAULT_USER_SETTINGS)
  })

  it('defaults theme to kale', () => {
    expect(DEFAULT_USER_SETTINGS.theme).toBe('kale')
  })

  it('defaults dailyGoal to 5 and weeklyGoal to 25', () => {
    expect(DEFAULT_USER_SETTINGS.dailyGoal).toBe(5)
    expect(DEFAULT_USER_SETTINGS.weeklyGoal).toBe(25)
  })

  it('defaults the canonical camelCase document fields', () => {
    expect(DEFAULT_USER_SETTINGS.homeView).toBe('today')
    expect(DEFAULT_USER_SETTINGS.timeFormat).toBe('12h')
    expect(DEFAULT_USER_SETTINGS.dateFormat).toBe('MDY')
    expect(DEFAULT_USER_SETTINGS.autoDark).toBe(true)
    expect(DEFAULT_USER_SETTINGS.daysOff).toEqual([6, 7])
    expect(DEFAULT_USER_SETTINGS.autoReminderMinutes).toBe(30)
    expect(DEFAULT_USER_SETTINGS.viewPrefs).toEqual({})
  })

  it('fills nested viewPrefs entries with per-view defaults', () => {
    const parsed = UserSettingsSchema.parse({ viewPrefs: { today: { groupBy: 'priority' } } })
    expect(parsed.viewPrefs.today).toEqual({ ...DEFAULT_VIEW_PREFS, groupBy: 'priority' })
  })
})

describe('viewKey', () => {
  it('joins kind and id with a colon', () => {
    expect(viewKey('project', 'x')).toBe('project:x')
  })

  it('returns the bare kind when no id is given', () => {
    expect(viewKey('today')).toBe('today')
  })
})

describe('UserSettingsPatchSchema', () => {
  it('accepts a partial theme patch', () => {
    // NOTE (zod 4): `.partial()` keeps inner defaults, so parse() fills absent keys with
    // defaults — the TYPE stays Partial, and the server merges only raw-provided keys
    // (see apps/server/src/api/routes/user.ts). "Accepts" here means parse succeeds.
    expect(UserSettingsPatchSchema.parse({ theme: 'dark' }).theme).toBe('dark')
    expect(UserSettingsPatchSchema.safeParse({ theme: 'dark' }).success).toBe(true)
  })

  it('rejects unknown theme values', () => {
    expect(() => UserSettingsPatchSchema.parse({ theme: 'neon' })).toThrow()
  })
})
