/**
 * Appearance × accent theming (plan Task C). Two independent axes drive <html>:
 *  - APPEARANCE (`light` | `dark` | `system`) → `data-mode="light|dark"`, or `.system-dark`
 *    (toggled by the OS) when `system`. Explicit light/dark win over the OS, both ways.
 *  - ACCENT (the palette) → `data-accent="<name>"`, applied in BOTH light and dark.
 * Both are mirrored to localStorage (`ot-appearance` / `ot-accent`) so index.html's head script
 * paints the same result pre-hydration on the next load.
 *
 * The account settings are the single source of truth: `useThemeSync` (mounted in AppLayout, and
 * on the Theme page) reads `UserSettings` and applies both axes, migrating a pre-appearance row
 * (`theme`/`autoDark`) via core's `resolveAppearance`/`resolveAccent`. The user-menu / palette
 * quick-toggles write through the same settings via `settingsPatchForChoice`.
 */
import {
  type AccentName,
  type Appearance,
  resolveAccent,
  resolveAppearance,
  type ThemeReadable,
  type UserSettingsPatch,
} from '@opentask/core'
import { useEffect } from 'react'
import { syncWindowBackground } from '@/desktop/window-chrome'
import { useUserSettings } from '@/features/settings/useSettings'

/** The nine legacy quick-toggle choices (user menu + palette) — a coarse control mapped onto the
 *  appearance×accent model. Task D's Theme page is the full two-axis control. */
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

const APPEARANCE_KEY = 'ot-appearance'
const ACCENT_KEY = 'ot-accent'

function osPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * Apply the light/dark/system appearance to <html> and persist it. `system` follows the OS via
 * `.system-dark`; explicit `light`/`dark` set `data-mode` and win over the OS both ways. Mirrors
 * the index.html head script exactly.
 */
export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement
  localStorage.setItem(APPEARANCE_KEY, appearance)
  root.classList.remove('system-dark')
  if (appearance === 'system') {
    root.removeAttribute('data-mode')
    root.classList.toggle('system-dark', osPrefersDark())
  } else {
    root.setAttribute('data-mode', appearance)
  }
  // Desktop shell: keep the native NSWindow background on the resolved theme (no-op on web).
  syncWindowBackground()
}

/** Apply the accent palette to <html> (`data-accent`) and persist it for the pre-hydration script. */
export function applyAccent(accent: AccentName): void {
  document.documentElement.setAttribute('data-accent', accent)
  localStorage.setItem(ACCENT_KEY, accent)
}

/**
 * Map a legacy quick-toggle choice to the settings patch it implies (new model). `system` follows
 * the OS from Kale; `dark` is explicit dark on the Kale accent (old Dark had no accent axis); every
 * other choice is an explicit light accent. Pure — unit-tested.
 */
export function settingsPatchForChoice(choice: ThemeChoice): UserSettingsPatch {
  if (choice === 'system') return { appearance: 'system', accent: 'kale' }
  if (choice === 'dark') return { appearance: 'dark', accent: 'kale' }
  return { appearance: 'light', accent: choice }
}

/**
 * Inverse of `settingsPatchForChoice` for menu checkmarks: which coarse choice reflects the
 * account settings? `system`/`dark` map to themselves; a light appearance maps to its accent.
 * Reads through the migration resolvers so a pre-appearance row still resolves. Pure.
 */
export function themeChoiceFromSettings(s: ThemeReadable): ThemeChoice {
  const appearance = resolveAppearance(s)
  if (appearance === 'system') return 'system'
  if (appearance === 'dark') return 'dark'
  return resolveAccent(s)
}

/**
 * Keep <html> in sync with the account-settings appearance + accent: applies on mount and whenever
 * they change (optimistically, through the shared ['user-settings'] cache), and re-applies when the
 * OS `prefers-color-scheme` flips while appearance is `system`. Idempotent — safe to mount more than
 * once (AppLayout for global coverage; the Theme page so it applies changes standalone).
 */
export function useThemeSync(): void {
  const { settings, isLoading } = useUserSettings()
  const appearance = resolveAppearance(settings)
  const accent = resolveAccent(settings)
  useEffect(() => {
    if (isLoading) return
    applyAppearance(appearance)
    applyAccent(accent)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (appearance === 'system') applyAppearance('system')
    }
    mq.addEventListener('change', onChange)
    return () => {
      mq.removeEventListener('change', onChange)
    }
  }, [appearance, accent, isLoading])
}
