/**
 * Theme settings (plan Task D) — two independent axes, no Pro gating (every accent is selectable):
 *  - APPEARANCE: Light / Dark / System. Writes `settings.appearance`; `useThemeSync`/`applyAppearance`
 *    (lib/theme.ts) stamp `data-mode="light|dark"` on <html>, or toggle `.system-dark` per the OS
 *    when `system`.
 *  - ACCENT: the seven palette accents. Writes `settings.accent`; drives `data-accent`, applied in
 *    BOTH light and dark. Each accent's swatch sets `data-accent` on itself so it previews in the
 *    CURRENT appearance (its light half in Light, its dark half in Dark) — a faithful live preview.
 *
 * Both write through the optimistic `useUserSettings` PATCH; `useThemeSync` then re-applies the
 * resolved axes to <html> (whole-app live preview) and mirrors localStorage so index.html's head
 * script paints correctly pre-hydration. Reads go through core's `resolveAppearance`/`resolveAccent`
 * so a pre-migration row (legacy `theme`/`autoDark`) still resolves with no data loss.
 */
import {
  ACCENT_NAMES,
  type AccentName,
  type Appearance,
  resolveAccent,
  resolveAppearance,
} from '@opentask/core'
import { Check, type LucideIcon, Monitor, Moon, Sun } from 'lucide-react'
import { useThemeSync } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { SettingsSection } from '../ui'
import { useUserSettings } from '../useSettings'

const APPEARANCE_OPTIONS: { value: Appearance; label: string; Icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
]

const ACCENT_LABELS: Record<AccentName, string> = {
  kale: 'Kale',
  todoist: 'Red',
  moonstone: 'Moonstone',
  tangerine: 'Tangerine',
  blueberry: 'Blueberry',
  lavender: 'Lavender',
  raspberry: 'Raspberry',
}

/** Light / Dark / System as a segmented radiogroup. Selected = accent-soft fill + accent icon +
 *  selected-text (the app's active-choice language), legible in both appearances. */
function AppearanceControl({
  value,
  onSelect,
}: {
  value: Appearance
  onSelect: (next: Appearance) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby="theme-appearance-label"
      className="grid grid-cols-3 gap-2"
    >
      {APPEARANCE_OPTIONS.map(({ value: v, label, Icon }) => {
        const selected = value === v
        return (
          // biome-ignore lint/a11y/useSemanticElements: styled segmented radio (icon + label) inside role="radiogroup" — a native <input type="radio"> can't carry this content (matches ThemeCard/ColorPicker).
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            onClick={() => onSelect(v)}
            className={cn(
              'flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-body outline-offset-2 transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring',
              selected
                ? 'border-accent bg-accent-soft font-medium text-selected-text'
                : 'border-border text-text-secondary hover:bg-hover hover:text-text-primary',
            )}
          >
            <Icon
              size={16}
              aria-hidden="true"
              className={selected ? 'text-accent' : 'text-text-tertiary'}
            />
            {label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * A single accent choice rendered as a mini app-preview. Setting `data-accent` on the card
 * redefines the accent family for its subtree while it inherits the app's current appearance
 * (`data-mode`/`.system-dark` on <html>), so `--ot-accent`/neutral tokens resolve to THIS accent in
 * the CURRENT mode — the swatch previews exactly how the accent will look after selecting it.
 */
function AccentSwatch({
  name,
  selected,
  onSelect,
}: {
  name: AccentName
  selected: boolean
  onSelect: () => void
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: styled accent-preview button inside role="radiogroup" — a native <input type="radio"> cannot render a mini app-preview card (matches ThemeCard/ColorPicker).
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={ACCENT_LABELS[name]}
      onClick={onSelect}
      className="group flex flex-col items-center gap-2 rounded-lg outline-offset-2 focus-visible:outline-2 focus-visible:outline-focus-ring"
    >
      <div
        data-accent={name}
        style={{ background: 'var(--ot-bg)', borderColor: 'var(--ot-border)' }}
        className={cn(
          'relative h-20 w-full overflow-hidden rounded-lg border',
          selected && 'outline-2 outline-offset-2 outline-focus-ring',
        )}
      >
        <div className="absolute inset-0 flex">
          {/* sidebar strip */}
          <div className="h-full w-[32%]" style={{ background: 'var(--ot-surface)' }}>
            <div className="mt-2 ml-1.5 flex flex-col gap-1.5">
              <span className="h-1.5 w-7 rounded-full" style={{ background: 'var(--ot-accent)' }} />
              <span
                className="h-1.5 w-5 rounded-full opacity-40"
                style={{ background: 'var(--ot-text-tertiary)' }}
              />
              <span
                className="h-1.5 w-6 rounded-full opacity-40"
                style={{ background: 'var(--ot-text-tertiary)' }}
              />
            </div>
          </div>
          {/* canvas with an accent pill + fake task rows */}
          <div className="flex-1 p-2">
            <span
              className="mb-2 block h-2 w-8 rounded-full"
              style={{ background: 'var(--ot-accent)' }}
            />
            {[0, 1, 2].map((row) => (
              <div key={row} className="mb-1.5 flex items-center gap-1.5">
                <span
                  className="size-2 shrink-0 rounded-full border-2"
                  style={{ borderColor: 'var(--ot-accent)' }}
                />
                <span
                  className="h-1.5 flex-1 rounded-full opacity-35"
                  style={{ background: 'var(--ot-text-tertiary)' }}
                />
              </div>
            ))}
          </div>
        </div>
        {selected ? (
          <span
            className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full"
            style={{ background: 'var(--ot-accent)' }}
          >
            <Check size={11} style={{ color: 'var(--ot-on-accent)' }} aria-hidden="true" />
          </span>
        ) : null}
      </div>
      <span
        className={cn(
          'text-copy',
          selected ? 'font-medium text-text-primary' : 'text-text-secondary',
        )}
      >
        {ACCENT_LABELS[name]}
      </span>
    </button>
  )
}

export default function ThemePage() {
  // Apply the resolved appearance + accent, and react to settings/OS changes while mounted.
  useThemeSync()
  const { settings, update } = useUserSettings()
  const appearance = resolveAppearance(settings)
  const accent = resolveAccent(settings)

  return (
    <div className="max-w-2xl">
      <SettingsSection title="Theme" description="Choose how OpenTask looks.">
        <div className="p-4">
          <div id="theme-appearance-label" className="mb-3 font-medium text-body text-text-primary">
            Appearance
          </div>
          <AppearanceControl value={appearance} onSelect={(next) => update({ appearance: next })} />
        </div>

        <div className="p-4">
          <div id="theme-accent-label" className="mb-3 font-medium text-body text-text-primary">
            Accent
          </div>
          <div
            role="radiogroup"
            aria-labelledby="theme-accent-label"
            className="grid grid-cols-2 gap-3 sm:grid-cols-4"
          >
            {ACCENT_NAMES.map((name) => (
              <AccentSwatch
                key={name}
                name={name}
                selected={accent === name}
                onSelect={() => update({ accent: name })}
              />
            ))}
          </div>
        </div>
      </SettingsSection>

      <p className="text-copy text-text-secondary">
        Your theme syncs across devices — it's stored in your account settings.
      </p>
    </div>
  )
}
