/**
 * Theme switching. Mirrors the index.html head script exactly: explicit `data-theme`
 * wins over the OS preference, both ways; 'system' follows the OS via `.system-dark`.
 * Persisted to localStorage 'od-theme'.
 */

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
