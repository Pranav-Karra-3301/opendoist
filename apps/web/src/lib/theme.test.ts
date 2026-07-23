import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyAccent,
  applyAppearance,
  settingsPatchForChoice,
  THEME_CHOICES,
  type ThemeChoice,
  themeChoiceFromSettings,
} from './theme'

// The web vitest env is `node` (no jsdom), so stub the minimal DOM surface the apply fns touch.
function makeRoot() {
  const attrs = new Map<string, string>()
  const classes = new Set<string>()
  return {
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    removeAttribute: (k: string) => attrs.delete(k),
    getAttribute: (k: string) => attrs.get(k) ?? null,
    hasAttribute: (k: string) => attrs.has(k),
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      toggle: (c: string, on?: boolean) => {
        const next = on ?? !classes.has(c)
        if (next) classes.add(c)
        else classes.delete(c)
        return next
      },
      contains: (c: string) => classes.has(c),
    },
  }
}

let root: ReturnType<typeof makeRoot>
let store: Map<string, string>
let osDark = false

beforeEach(() => {
  root = makeRoot()
  store = new Map()
  osDark = false
  vi.stubGlobal('document', { documentElement: root })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  })
  vi.stubGlobal('window', {
    matchMedia: (q: string) => ({
      matches: q.includes('dark') ? osDark : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('applyAppearance (light/dark/system → data-mode / .system-dark)', () => {
  it('sets data-mode="dark" and clears system-dark for explicit Dark', () => {
    applyAppearance('dark')
    expect(root.getAttribute('data-mode')).toBe('dark')
    expect(root.classList.contains('system-dark')).toBe(false)
    expect(store.get('ot-appearance')).toBe('dark')
  })

  it('sets data-mode="light" and clears system-dark for explicit Light, ignoring a dark OS', () => {
    osDark = true
    applyAppearance('light')
    expect(root.getAttribute('data-mode')).toBe('light')
    expect(root.classList.contains('system-dark')).toBe(false)
    expect(store.get('ot-appearance')).toBe('light')
  })

  it('clears data-mode and follows the OS via system-dark for System', () => {
    osDark = true
    applyAppearance('system')
    expect(root.hasAttribute('data-mode')).toBe(false)
    expect(root.classList.contains('system-dark')).toBe(true)

    osDark = false
    applyAppearance('system')
    expect(root.classList.contains('system-dark')).toBe(false)
    expect(store.get('ot-appearance')).toBe('system')
  })
})

describe('applyAccent (data-accent + persistence)', () => {
  it('sets data-accent and persists, independently of appearance', () => {
    applyAppearance('dark')
    applyAccent('tangerine')
    expect(root.getAttribute('data-accent')).toBe('tangerine')
    expect(root.getAttribute('data-mode')).toBe('dark') // accent switch does not disturb the mode
    expect(store.get('ot-accent')).toBe('tangerine')
  })
})

describe('settingsPatchForChoice (quick-toggle → appearance+accent patch)', () => {
  it('maps System to system appearance on the kale accent', () => {
    expect(settingsPatchForChoice('system')).toEqual({ appearance: 'system', accent: 'kale' })
  })

  it('maps Dark to dark appearance on the kale accent', () => {
    expect(settingsPatchForChoice('dark')).toEqual({ appearance: 'dark', accent: 'kale' })
  })

  it('maps a light accent choice to light appearance + that accent', () => {
    expect(settingsPatchForChoice('kale')).toEqual({ appearance: 'light', accent: 'kale' })
    expect(settingsPatchForChoice('tangerine')).toEqual({
      appearance: 'light',
      accent: 'tangerine',
    })
  })
})

describe('themeChoiceFromSettings (settings → menu checkmark)', () => {
  it('reads appearance system/dark as their own choice', () => {
    expect(themeChoiceFromSettings({ appearance: 'system', accent: 'tangerine' })).toBe('system')
    expect(themeChoiceFromSettings({ appearance: 'dark', accent: 'kale' })).toBe('dark')
  })

  it('reads a light appearance as its accent', () => {
    expect(themeChoiceFromSettings({ appearance: 'light', accent: 'raspberry' })).toBe('raspberry')
  })

  it('migrates a legacy (pre-appearance) row via theme/autoDark', () => {
    expect(themeChoiceFromSettings({ theme: 'kale', autoDark: true })).toBe('system')
    expect(themeChoiceFromSettings({ theme: 'dark', autoDark: false })).toBe('dark')
    expect(themeChoiceFromSettings({ theme: 'tangerine', autoDark: false })).toBe('tangerine')
  })

  it('round-trips every quick-toggle choice', () => {
    for (const choice of THEME_CHOICES) {
      const patch = settingsPatchForChoice(choice)
      expect(themeChoiceFromSettings(patch)).toBe(choice satisfies ThemeChoice)
    }
  })
})
