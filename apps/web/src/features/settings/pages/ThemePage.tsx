/**
 * Theme settings — eight theme preview cards + Auto Dark Theme. Selecting a card or toggling
 * Auto Dark writes immediately through the optimistic `useUserSettings` PATCH; `useThemeSync`
 * (lib/theme.ts) then applies the resolved theme to <html> and mirrors localStorage so
 * index.html's head script paints correctly pre-hydration. Resolution law:
 * `autoDark && OS-dark ? 'dark' : theme`. Implements plan Task O.
 */
import { THEME_NAMES, type ThemeName } from '@opendoist/core'
import { Check } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Switch } from '@/components/ui/switch'
import { useThemeSync } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { SettingRow, SettingsSection } from '../ui'
import { useUserSettings } from '../useSettings'

const THEME_LABELS: Record<ThemeName, string> = {
  kale: 'Kale',
  todoist: 'Todoist',
  dark: 'Dark',
  moonstone: 'Moonstone',
  tangerine: 'Tangerine',
  blueberry: 'Blueberry',
  lavender: 'Lavender',
  raspberry: 'Raspberry',
}

/**
 * tokens.css paints each card via `data-theme`, but the light-accent `[data-theme]` blocks only
 * override accent/surface/selected — the base vars (bg/text/border) would inherit the ACTIVE app
 * theme, so under Dark the light previews would show a dark canvas. Re-assert a light baseline on
 * the light cards so previews stay faithful regardless of the current theme. `kale` has no block
 * at all (it IS :root), so assert its accent/surface here too. `dark`'s block is complete —
 * nothing to add. Values copied from tokens.css :root / accent blocks.
 */
function cardVars(name: ThemeName): CSSProperties {
  if (name === 'dark') return {}
  const light = {
    '--od-bg': '#ffffff',
    '--od-surface-raised': '#ffffff',
    '--od-text-primary': '#202020',
    '--od-text-tertiary': '#999999',
    '--od-border': '#eeeeee',
  }
  if (name === 'kale') {
    return { ...light, '--od-surface': '#fcfcf8', '--od-accent': '#4c7a45' } as CSSProperties
  }
  return light as CSSProperties
}

function ThemeCard({
  name,
  selected,
  onSelect,
}: {
  name: ThemeName
  selected: boolean
  onSelect: () => void
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: styled theme-preview button inside role="radiogroup" — a native <input type="radio"> cannot render a mini app-preview card (same pattern as ColorPicker).
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={THEME_LABELS[name]}
      onClick={onSelect}
      className="group flex flex-col items-center gap-2 rounded-lg outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--od-focus-ring)]"
    >
      {/* Mini app preview — data-theme + cardVars set the --od-* palette this card reads. */}
      <div
        data-theme={name}
        style={{ ...cardVars(name), background: 'var(--od-bg)', borderColor: 'var(--od-border)' }}
        className={cn(
          'relative h-24 w-full overflow-hidden rounded-lg border',
          selected && 'outline-2 outline-offset-2 outline-[var(--od-focus-ring)]',
        )}
      >
        <div className="absolute inset-0 flex">
          {/* sidebar strip */}
          <div className="h-full w-[30%]" style={{ background: 'var(--od-surface)' }}>
            <div className="mt-2.5 ml-2 flex flex-col gap-1.5">
              <span className="h-1.5 w-8 rounded-full" style={{ background: 'var(--od-accent)' }} />
              <span
                className="h-1.5 w-6 rounded-full opacity-40"
                style={{ background: 'var(--od-text-tertiary)' }}
              />
              <span
                className="h-1.5 w-7 rounded-full opacity-40"
                style={{ background: 'var(--od-text-tertiary)' }}
              />
            </div>
          </div>
          {/* canvas with an accent pill + fake task rows */}
          <div className="flex-1 p-2">
            <span
              className="mb-2 block h-2.5 w-10 rounded-full"
              style={{ background: 'var(--od-accent)' }}
            />
            {[0, 1, 2].map((row) => (
              <div key={row} className="mb-1.5 flex items-center gap-1.5">
                <span
                  className="size-2.5 shrink-0 rounded-full border-2"
                  style={{ borderColor: 'var(--od-accent)' }}
                />
                <span
                  className="h-1.5 flex-1 rounded-full opacity-35"
                  style={{ background: 'var(--od-text-tertiary)' }}
                />
              </div>
            ))}
          </div>
        </div>
        {selected ? (
          <span
            className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full"
            style={{ background: 'var(--od-accent)' }}
          >
            <Check size={11} className="text-white" aria-hidden="true" />
          </span>
        ) : null}
      </div>
      <span
        className={cn(
          'text-copy',
          selected ? 'font-medium text-text-primary' : 'text-text-secondary',
        )}
      >
        {THEME_LABELS[name]}
      </span>
    </button>
  )
}

export default function ThemePage() {
  // Apply the resolved theme + react to settings/OS changes while this page is mounted.
  useThemeSync()
  const { settings, update } = useUserSettings()

  return (
    <div>
      <SettingsSection title="Theme" description="Choose how OpenDoist looks.">
        <div className="p-4">
          <div
            role="radiogroup"
            aria-label="Theme"
            className="grid grid-cols-2 gap-3 sm:grid-cols-4"
          >
            {THEME_NAMES.map((name) => (
              <ThemeCard
                key={name}
                name={name}
                selected={settings.theme === name}
                onSelect={() => update({ theme: name })}
              />
            ))}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Appearance">
        <SettingRow
          label="Auto Dark Theme"
          description="Follow the system and switch to Dark automatically"
          control={
            <Switch
              checked={settings.autoDark}
              onCheckedChange={(autoDark) => update({ autoDark })}
              aria-label="Auto Dark Theme"
            />
          }
        />
      </SettingsSection>

      <p className="text-copy text-text-secondary">
        Your theme syncs across devices — it's stored in your account settings.
      </p>
    </div>
  )
}
