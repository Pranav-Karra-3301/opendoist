import { describe, expect, it } from 'vitest'
import {
  ACCENT_NAMES,
  DEFAULT_USER_SETTINGS,
  DEFAULT_VIEW_PREFS,
  migrateThemeToAppearance,
  resolveAccent,
  resolveAppearance,
  THEME_NAMES,
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

describe('migrateThemeToAppearance (legacy theme+autoDark → appearance+accent)', () => {
  it('maps Auto Dark on to appearance system, keeping the base accent', () => {
    expect(migrateThemeToAppearance('kale', true)).toEqual({ appearance: 'system', accent: 'kale' })
    expect(migrateThemeToAppearance('tangerine', true)).toEqual({
      appearance: 'system',
      accent: 'tangerine',
    })
  })

  it('maps an explicit dark theme to appearance dark with the kale accent (Dark had no accent)', () => {
    expect(migrateThemeToAppearance('dark', false)).toEqual({ appearance: 'dark', accent: 'kale' })
  })

  it('treats dark + Auto Dark as system with the kale accent', () => {
    expect(migrateThemeToAppearance('dark', true)).toEqual({ appearance: 'system', accent: 'kale' })
  })

  it('maps every light accent (Auto Dark off) to appearance light + that accent', () => {
    for (const accent of ACCENT_NAMES) {
      expect(migrateThemeToAppearance(accent, false)).toEqual({ appearance: 'light', accent })
    }
  })

  it('produces a valid accent for every legacy theme value', () => {
    for (const theme of THEME_NAMES) {
      const { accent } = migrateThemeToAppearance(theme, false)
      expect(ACCENT_NAMES).toContain(accent)
    }
  })
})

describe('resolveAppearance / resolveAccent', () => {
  it('migrates from theme/autoDark when appearance/accent are absent (old row)', () => {
    const oldRow = { theme: 'dark', autoDark: false } as const
    expect(resolveAppearance(oldRow)).toBe('dark')
    expect(resolveAccent(oldRow)).toBe('kale')

    const liveRow = { theme: 'kale', autoDark: true } as const
    expect(resolveAppearance(liveRow)).toBe('system')
    expect(resolveAccent(liveRow)).toBe('kale')
  })

  it('prefers the stored appearance/accent when present (new row is authoritative)', () => {
    const newRow = {
      appearance: 'dark',
      accent: 'tangerine',
      theme: 'kale',
      autoDark: true,
    } as const
    expect(resolveAppearance(newRow)).toBe('dark')
    expect(resolveAccent(newRow)).toBe('tangerine')
  })

  it('parses a pre-migration document without injecting appearance/accent defaults', () => {
    const parsed = UserSettingsSchema.parse({ theme: 'tangerine', autoDark: false })
    expect(parsed.appearance).toBeUndefined()
    expect(parsed.accent).toBeUndefined()
    // resolvers still recover the intended appearance/accent with no data loss
    expect(resolveAppearance(parsed)).toBe('light')
    expect(resolveAccent(parsed)).toBe('tangerine')
  })

  it('round-trips a new-model patch through the schema', () => {
    const parsed = UserSettingsSchema.parse({ appearance: 'system', accent: 'blueberry' })
    expect(parsed.appearance).toBe('system')
    expect(parsed.accent).toBe('blueberry')
  })
})

describe('UserSettingsPatchSchema', () => {
  it('accepts an appearance/accent patch', () => {
    expect(UserSettingsPatchSchema.parse({ appearance: 'dark' }).appearance).toBe('dark')
    expect(UserSettingsPatchSchema.parse({ accent: 'raspberry' }).accent).toBe('raspberry')
  })

  it('rejects unknown appearance/accent values', () => {
    expect(() => UserSettingsPatchSchema.parse({ appearance: 'twilight' })).toThrow()
    expect(() => UserSettingsPatchSchema.parse({ accent: 'neon' })).toThrow()
  })

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
