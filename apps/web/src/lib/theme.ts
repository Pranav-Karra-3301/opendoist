/**
 * Theme switching. Mirrors the index.html head script exactly: explicit `data-theme`
 * wins over the OS preference, both ways; 'system' follows the OS via `.system-dark`.
 * Persisted to localStorage 'od-theme'.
 *
 * Phase 5 Task O adds the account-settings theme path (`resolveTheme`, `applyResolvedTheme`,
 * `useThemeSync`): the authoritative theme is `UserSettings.theme` + `UserSettings.autoDark`,
 * resolved to a concrete theme and mirrored to localStorage ('od-theme' + 'od-auto-dark') so
 * the head script paints it pre-hydration. The Task X integration gate rewired the phase-4
 * quick-toggles (user menu + palette) to write THROUGH the account settings via
 * `settingsPatchForChoice`/`themeChoiceFromSettings`, so there is one source of truth;
 * `applyTheme`/`getTheme` remain for direct/legacy use.
 */
import type { ThemeName, UserSettings } from '@opendoist/core'
import { useEffect } from 'react'
import { useUserSettings } from '@/features/settings/useSettings'

export type ThemeChoice =
  | 'system'
  | 'kale'
  | 'todoist'
  | 'dark'
  | 'moonstone'
  | 'tangerine'
  | 'blueberry'
  | 'lavender'
  | 'raspberry'

export const THEME_CHOICES: readonly ThemeChoice[] = [
  'system',
  'kale',
  'todoist',
  'dark',
  'moonstone',
  'tangerine',
  'blueberry',
  'lavender',
  'raspberry',
]

const STORAGE_KEY = 'od-theme'
const AUTO_DARK_KEY = 'od-auto-dark'

function isThemeChoice(value: string | null): value is ThemeChoice {
  return value !== null && (THEME_CHOICES as readonly string[]).includes(value)
}

/** Apply a theme to <html> and persist the choice. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement
  localStorage.setItem(STORAGE_KEY, choice)
  if (choice === 'system') {
    root.removeAttribute('data-theme')
    root.classList.toggle('system-dark', matchMedia('(prefers-color-scheme: dark)').matches)
  } else {
    root.setAttribute('data-theme', choice)
    root.classList.remove('system-dark')
  }
}

/** Read the persisted theme choice ('system' when unset or unknown). */
export function getTheme(): ThemeChoice {
  const stored = localStorage.getItem(STORAGE_KEY)
  return isThemeChoice(stored) ? stored : 'system'
}

/**
 * Map a quick-toggle choice (user menu / palette) to the account-settings patch it implies.
 * Explicit themes win over the OS both ways (phase-4 law) → Auto Dark off; 'System' means
 * "default look, Dark under a dark OS" → Kale + Auto Dark. Pure — unit-tested.
 */
export function settingsPatchForChoice(choice: ThemeChoice): {
  theme: ThemeName
  autoDark: boolean
} {
  return choice === 'system'
    ? { theme: 'kale', autoDark: true }
    : { theme: choice, autoDark: false }
}

/** Inverse of `settingsPatchForChoice` for menu checkmarks: which choice reflects the account
 *  settings? Kale + Auto Dark reads as 'system'; anything else is its explicit theme. */
export function themeChoiceFromSettings(s: Pick<UserSettings, 'theme' | 'autoDark'>): ThemeChoice {
  return s.autoDark && s.theme === 'kale' ? 'system' : s.theme
}

/**
 * Resolve the concrete theme to paint from the account settings. Auto Dark maps the base
 * theme to `dark` only when the OS reports a dark preference; an explicit `dark` base always
 * stays dark, and Auto Dark off ignores the OS entirely. Pure — unit-tested.
 */
export function resolveTheme(theme: ThemeName, autoDark: boolean, osDark: boolean): ThemeName {
  return autoDark && osDark ? 'dark' : theme
}

/**
 * Apply the account-settings theme to <html> and mirror it to localStorage so index.html's
 * head script paints the same result pre-hydration on the next load. `kale` is the :root
 * default (tokens.css has no `[data-theme="kale"]` block), so it clears the attribute; every
 * other resolved theme sets `data-theme`. The legacy `.system-dark` class is always cleared —
 * this path resolves Auto Dark to a concrete theme instead.
 */
export function applyResolvedTheme(theme: ThemeName, autoDark: boolean): void {
  const root = document.documentElement
  localStorage.setItem(STORAGE_KEY, theme)
  localStorage.setItem(AUTO_DARK_KEY, String(autoDark))
  const osDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const resolved = resolveTheme(theme, autoDark, osDark)
  root.classList.remove('system-dark')
  if (resolved === 'kale') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', resolved)
}

/**
 * Keep <html> in sync with the account-settings theme: applies on mount and whenever
 * `theme`/`autoDark` change (optimistically, through the shared ['user-settings'] cache), and
 * re-applies when the OS `prefers-color-scheme` flips while Auto Dark is on. Idempotent, so it
 * is safe to mount in more than one place. Mount once in the app root (AppLayout) for global
 * coverage; the Theme settings page also calls it so the page applies changes standalone.
 */
export function useThemeSync(): void {
  const { settings, isLoading } = useUserSettings()
  const { theme, autoDark } = settings
  useEffect(() => {
    if (isLoading) return
    applyResolvedTheme(theme, autoDark)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyResolvedTheme(theme, autoDark)
    mq.addEventListener('change', onChange)
    return () => {
      mq.removeEventListener('change', onChange)
    }
  }, [theme, autoDark, isLoading])
}
