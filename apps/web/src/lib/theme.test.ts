import { describe, expect, it } from 'vitest'
import { resolveTheme, settingsPatchForChoice, themeChoiceFromSettings } from './theme'

describe('resolveTheme', () => {
  it('keeps the base theme when Auto Dark is off, whatever the OS reports', () => {
    expect(resolveTheme('tangerine', false, false)).toBe('tangerine')
    expect(resolveTheme('tangerine', false, true)).toBe('tangerine')
    expect(resolveTheme('kale', false, true)).toBe('kale')
  })

  it('maps to Dark only when Auto Dark is on AND the OS is dark', () => {
    expect(resolveTheme('tangerine', true, true)).toBe('dark')
    expect(resolveTheme('kale', true, true)).toBe('dark')
  })

  it('keeps the base theme when Auto Dark is on but the OS is light', () => {
    expect(resolveTheme('tangerine', true, false)).toBe('tangerine')
    expect(resolveTheme('kale', true, false)).toBe('kale')
  })

  it('leaves an explicit Dark base dark under a light OS', () => {
    expect(resolveTheme('dark', false, false)).toBe('dark')
    expect(resolveTheme('dark', true, false)).toBe('dark')
  })
})

describe('settingsPatchForChoice (quick-toggle → account settings)', () => {
  it('maps System to Kale + Auto Dark (OS decides dark vs default)', () => {
    expect(settingsPatchForChoice('system')).toEqual({ theme: 'kale', autoDark: true })
  })

  it('maps an explicit theme to itself with Auto Dark off (explicit wins over the OS)', () => {
    expect(settingsPatchForChoice('dark')).toEqual({ theme: 'dark', autoDark: false })
    expect(settingsPatchForChoice('tangerine')).toEqual({ theme: 'tangerine', autoDark: false })
    expect(settingsPatchForChoice('kale')).toEqual({ theme: 'kale', autoDark: false })
  })
})

describe('themeChoiceFromSettings (account settings → menu checkmark)', () => {
  it('reads Kale + Auto Dark as System', () => {
    expect(themeChoiceFromSettings({ theme: 'kale', autoDark: true })).toBe('system')
  })

  it('reads any other combination as its explicit theme', () => {
    expect(themeChoiceFromSettings({ theme: 'kale', autoDark: false })).toBe('kale')
    expect(themeChoiceFromSettings({ theme: 'dark', autoDark: true })).toBe('dark')
    expect(themeChoiceFromSettings({ theme: 'tangerine', autoDark: false })).toBe('tangerine')
  })

  it('round-trips every quick-toggle choice', () => {
    for (const choice of ['system', 'kale', 'dark', 'tangerine'] as const) {
      expect(themeChoiceFromSettings(settingsPatchForChoice(choice))).toBe(choice)
    }
  })
})
