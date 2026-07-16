import { type ReactNode, useEffect, useState } from 'react'

/** data-theme values; 'kale' is the :root default and 'system' follows the OS. */
type ThemeChoice =
  | 'system'
  | 'kale'
  | 'todoist'
  | 'dark'
  | 'moonstone'
  | 'tangerine'
  | 'blueberry'
  | 'lavender'
  | 'raspberry'

const THEME_OPTIONS: ReadonlyArray<{ id: ThemeChoice; label: string; swatch: string }> = [
  { id: 'system', label: 'System', swatch: 'linear-gradient(135deg, #fcfcf8 50%, #1e1e1e 50%)' },
  { id: 'kale', label: 'Kale', swatch: '#4c7a45' },
  { id: 'todoist', label: 'Todoist', swatch: '#dc4c3e' },
  { id: 'dark', label: 'Dark', swatch: '#bd4337' },
  { id: 'moonstone', label: 'Moonstone', swatch: '#4a5462' },
  { id: 'tangerine', label: 'Tangerine', swatch: '#d68400' },
  { id: 'blueberry', label: 'Blueberry', swatch: '#3669ba' },
  { id: 'lavender', label: 'Lavender', swatch: '#766bbd' },
  { id: 'raspberry', label: 'Raspberry', swatch: '#c94f71' },
]

const TYPE_SCALE = [
  { name: 'caption', className: 'text-caption', metrics: '12/16' },
  { name: 'copy', className: 'text-copy', metrics: '13/17' },
  { name: 'body', className: 'text-body', metrics: '14/20' },
  { name: 'subtitle', className: 'text-subtitle', metrics: '16/22' },
  { name: 'header', className: 'text-header', metrics: '20/25' },
  { name: 'header-lg', className: 'text-header-lg', metrics: '24/30' },
  { name: 'header-xl', className: 'text-header-xl', metrics: '32/41' },
] as const

const WEIGHTS = [
  { name: 'regular', className: 'font-regular', value: '400' },
  { name: 'medium', className: 'font-medium', value: '600' },
  { name: 'strong', className: 'font-strong', value: '700' },
] as const

const RADII = [
  { name: 'radius-xs', px: '3px', className: 'rounded-xs', usage: 'badges, tiny chips' },
  { name: 'radius-sm', px: '5px', className: 'rounded-sm', usage: 'buttons, inputs, rows' },
  { name: 'radius-lg', px: '10px', className: 'rounded-lg', usage: 'cards, dialogs, quick add' },
  { name: 'radius-full', px: '9999px', className: 'rounded-full', usage: 'checkbox circle' },
] as const

const SHADOWS = [
  { name: 'shadow-menu', className: 'shadow-menu', usage: 'dropdowns, menus' },
  { name: 'shadow-popover', className: 'shadow-popover', usage: 'popovers, scheduler' },
  { name: 'shadow-dialog', className: 'shadow-dialog', usage: 'dialogs, quick add' },
  { name: 'shadow-drag', className: 'shadow-drag', usage: 'drag ghost' },
  { name: 'shadow-toast', className: 'shadow-toast', usage: 'toasts' },
] as const

const SEMANTIC_GROUPS: ReadonlyArray<{ title: string; tokens: readonly string[] }> = [
  {
    title: 'Canvas & surfaces',
    tokens: [
      '--od-bg',
      '--od-surface',
      '--od-surface-raised',
      '--od-surface-overlay',
      '--od-hover',
      '--od-selected',
      '--od-selected-text',
      '--od-sidebar-hover',
    ],
  },
  {
    title: 'Borders & inputs',
    tokens: ['--od-border', '--od-border-subtle', '--od-input-border', '--od-input-border-focus'],
  },
  {
    title: 'Text',
    tokens: ['--od-text-primary', '--od-text-secondary', '--od-text-tertiary'],
  },
  {
    title: 'Accent',
    tokens: [
      '--od-accent',
      '--od-accent-hover',
      '--od-accent-disabled',
      '--od-on-accent',
      '--od-accent-soft',
    ],
  },
  {
    title: 'Status',
    tokens: ['--od-danger', '--od-danger-hover', '--od-success', '--od-warning', '--od-info'],
  },
  {
    title: 'Priorities',
    tokens: [
      '--od-p1',
      '--od-p1-disabled',
      '--od-p2',
      '--od-p2-disabled',
      '--od-p3',
      '--od-p3-disabled',
      '--od-p4',
      '--od-p4-disabled',
    ],
  },
  {
    title: 'Focus (always blue, never the accent)',
    tokens: ['--od-focus-ring', '--od-focus-ring-outer', '--od-row-focus-ring'],
  },
]

/** official palette order, IDs 30–49 */
const PALETTE = [
  'berry-red',
  'red',
  'orange',
  'yellow',
  'olive-green',
  'lime-green',
  'green',
  'mint-green',
  'teal',
  'sky-blue',
  'light-blue',
  'blue',
  'grape',
  'violet',
  'lavender',
  'magenta',
  'salmon',
  'charcoal',
  'grey',
  'taupe',
] as const

const DATE_CHIPS = [
  { label: 'Today', token: '--od-date-today' },
  { label: 'Tomorrow', token: '--od-date-tomorrow' },
  { label: 'Weekend', token: '--od-date-weekend' },
  { label: 'Next week', token: '--od-date-next-week' },
  { label: 'Overdue', token: '--od-date-overdue' },
] as const

const PRIORITIES = [1, 2, 3, 4] as const
type PriorityLevel = (typeof PRIORITIES)[number]

/** P1–P3: 2px ring in priority color + 10% fill (20% on hover); P4: 1px grey, no fill. */
const CHECKBOX_CLASSES: Record<PriorityLevel, string> = {
  1: 'border-2 border-p1 bg-p1/10 text-p1 group-hover:bg-p1/20',
  2: 'border-2 border-p2 bg-p2/10 text-p2 group-hover:bg-p2/20',
  3: 'border-2 border-p3 bg-p3/10 text-p3 group-hover:bg-p3/20',
  4: 'border border-p4 text-p4',
}

const BUTTON_VARIANTS = [
  {
    name: 'primary',
    className: 'bg-accent text-on-accent hover:bg-accent-hover disabled:bg-accent-disabled',
  },
  {
    name: 'secondary',
    className:
      'bg-[#f5f5f5] text-text-primary hover:bg-[#e5e5e5] dark:bg-[#292929] dark:hover:bg-[#3d3d3d]',
  },
  {
    name: 'danger',
    className: 'bg-danger text-white hover:bg-danger-hover',
  },
] as const

const BUTTON_SIZES = [
  { label: 'Small', className: 'h-7 px-2 text-caption' },
  { label: 'Normal', className: 'h-8 px-3 text-copy' },
  { label: 'Large', className: 'h-9 px-4 text-body' },
] as const

const BUTTON_BASE =
  'inline-flex items-center rounded-sm font-medium transition-colors duration-300 ease-standard ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'

const ALL_TOKEN_NAMES: readonly string[] = [
  ...SEMANTIC_GROUPS.flatMap((g) => g.tokens),
  ...PALETTE.map((name) => `--od-palette-${name}`),
  ...DATE_CHIPS.map((chip) => chip.token),
]

function isThemeChoice(value: string | null): value is ThemeChoice {
  return value !== null && THEME_OPTIONS.some((option) => option.id === value)
}

function readStoredTheme(): ThemeChoice {
  const stored = localStorage.getItem('od-theme')
  return isThemeChoice(stored) ? stored : 'system'
}

/** Mirrors the index.html head script: explicit data-theme wins over OS, both ways. */
function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement
  localStorage.setItem('od-theme', choice)
  if (choice === 'system') {
    root.removeAttribute('data-theme')
    root.classList.toggle('system-dark', matchMedia('(prefers-color-scheme: dark)').matches)
  } else {
    root.setAttribute('data-theme', choice)
    root.classList.remove('system-dark')
  }
}

function readComputedTokens(): Record<string, string> {
  const style = getComputedStyle(document.documentElement)
  const values: Record<string, string> = {}
  for (const name of ALL_TOKEN_NAMES) values[name] = style.getPropertyValue(name).trim()
  return values
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="border-b border-border pb-2 font-medium text-header">{title}</h2>
      {children}
    </section>
  )
}

function CheckIcon({ size, strokeWidth }: { size: number; strokeWidth: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  )
}

export function TokenShowcase() {
  const [theme, setTheme] = useState<ThemeChoice>(readStoredTheme)
  const [computed, setComputed] = useState<Record<string, string>>({})

  useEffect(() => {
    applyTheme(theme)
    setComputed(readComputedTokens())
  }, [theme])

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (theme !== 'system') return
      document.documentElement.classList.toggle('system-dark', media.matches)
      setComputed(readComputedTokens())
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme])

  return (
    <div className="min-h-screen bg-bg font-sans text-body text-text-primary antialiased">
      <main className="mx-auto flex w-full max-w-(--content-max) flex-col gap-12 px-6 py-12">
        <header className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <p className="font-medium text-accent text-caption uppercase tracking-widest">
              OpenDoist
            </p>
            <h1 className="font-strong text-header-xl">Design tokens</h1>
            <p className="max-w-[60ch] text-copy text-text-secondary">
              The canonical <code className="font-mono">tokens.css</code> showcase — Kale is the
              default accent, radii are 5px/10px only, and the focus ring stays blue in every theme.
              Pick a theme to watch every token below re-resolve.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-caption text-text-tertiary">
              Theme — persisted to <code className="font-mono">od-theme</code>
            </span>
            <div className="flex flex-wrap gap-2">
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={theme === option.id}
                  onClick={() => setTheme(option.id)}
                  className={`${BUTTON_BASE} h-8 gap-2 border px-3 text-copy ${
                    theme === option.id
                      ? 'border-transparent bg-selected text-selected-text'
                      : 'border-input-border bg-surface-raised text-text-secondary hover:bg-hover'
                  }`}
                >
                  <span
                    className="size-3 rounded-full border border-border"
                    style={{ background: option.swatch }}
                  />
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </header>

        <Section title="Type scale">
          <div className="flex flex-col gap-3">
            {TYPE_SCALE.map((step) => (
              <div key={step.name} className="flex items-baseline gap-4">
                <span className="w-28 shrink-0 font-mono text-caption text-text-tertiary">
                  {step.name} · {step.metrics}
                </span>
                <span className={step.className}>The quick brown fox jumps over the lazy dog</span>
              </div>
            ))}
            <div className="mt-2 flex flex-wrap items-baseline gap-6 border-t border-border-subtle pt-3">
              {WEIGHTS.map((weight) => (
                <span key={weight.name} className={`${weight.className} text-subtitle`}>
                  {weight.name} {weight.value}
                </span>
              ))}
              <span className="text-caption text-text-tertiary">
                Todoist “medium” is semibold 600 — there is no 500
              </span>
            </div>
          </div>
        </Section>

        <Section title="Radii & shadows">
          <div className="flex flex-wrap gap-4">
            {RADII.map((radius) => (
              <div key={radius.name} className="flex flex-col items-center gap-2">
                <div
                  className={`${radius.className} flex h-16 w-24 items-center justify-center border border-border bg-accent-soft font-mono text-caption text-selected-text`}
                >
                  {radius.px}
                </div>
                <span className="text-caption text-text-tertiary">{radius.name}</span>
                <span className="text-caption text-text-tertiary">{radius.usage}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-6 pt-2">
            {SHADOWS.map((shadow) => (
              <div key={shadow.name} className="flex flex-col items-center gap-2">
                <div
                  className={`${shadow.className} flex h-16 w-32 items-center justify-center rounded-lg border border-border-subtle bg-surface-raised font-mono text-caption`}
                >
                  {shadow.name}
                </div>
                <span className="text-caption text-text-tertiary">{shadow.usage}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Semantic colors (computed)">
          <div className="flex flex-col gap-6">
            {SEMANTIC_GROUPS.map((group) => (
              <div key={group.title} className="flex flex-col gap-2">
                <h3 className="font-medium text-copy text-text-secondary">{group.title}</h3>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                  {group.tokens.map((token) => (
                    <div key={token} className="flex flex-col gap-1">
                      <div
                        className="h-10 rounded-sm border border-border-subtle"
                        style={{ background: `var(${token})` }}
                      />
                      <span className="font-mono text-caption">{token.replace('--od-', '')}</span>
                      <span className="font-mono text-caption text-text-tertiary">
                        {computed[token] ?? '…'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Project palette (20)">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-3">
            {PALETTE.map((name) => (
              <div key={name} className="flex items-center gap-2">
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{ background: `var(--od-palette-${name})` }}
                />
                <span className="text-copy">{name.replace('-', ' ')}</span>
                <span className="ml-auto font-mono text-caption text-text-tertiary">
                  {computed[`--od-palette-${name}`] ?? ''}
                </span>
              </div>
            ))}
          </div>
          <p className="text-caption text-text-tertiary">
            Palette tokens auto-brighten in dark themes (Todoist-verified overrides).
          </p>
        </Section>

        <Section title="Priority checkboxes">
          <div className="flex flex-wrap items-end gap-8">
            {PRIORITIES.map((priority) => (
              <div key={priority} className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  aria-label={`Complete p${priority} task`}
                  className="group flex size-6 items-center justify-center"
                >
                  <span
                    className={`flex size-[18px] items-center justify-center rounded-full transition-colors duration-150 ease-in ${CHECKBOX_CLASSES[priority]}`}
                  >
                    <span className="opacity-0 transition-opacity duration-150 ease-in group-hover:opacity-100">
                      <CheckIcon size={11} strokeWidth={3} />
                    </span>
                  </span>
                </button>
                <span className="font-mono text-caption text-text-tertiary">p{priority}</span>
              </div>
            ))}
            <p className="max-w-[38ch] text-caption text-text-tertiary">
              18px circle in a 24px hit area. P1–P3: 2px ring + 10% fill, 20% on hover with a
              check-glyph preview. P4: 1px grey ring, no fill.
            </p>
          </div>
        </Section>

        <Section title="Date colors">
          <div className="flex flex-wrap gap-3">
            {DATE_CHIPS.map((chip) => (
              <span
                key={chip.token}
                className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface-raised px-2 py-1 text-caption"
                style={{ color: `var(${chip.token})` }}
              >
                <CalendarIcon />
                {chip.label}
                <span className="font-mono text-text-tertiary">{computed[chip.token] ?? ''}</span>
              </span>
            ))}
          </div>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-col gap-4">
            {BUTTON_VARIANTS.map((variant) => (
              <div key={variant.name} className="flex flex-wrap items-center gap-3">
                <span className="w-24 font-mono text-caption text-text-tertiary">
                  {variant.name}
                </span>
                {BUTTON_SIZES.map((size) => (
                  <button
                    key={size.label}
                    type="button"
                    className={`${BUTTON_BASE} ${size.className} ${variant.className}`}
                  >
                    {size.label}
                  </button>
                ))}
                {variant.name === 'primary' && (
                  <button
                    type="button"
                    disabled
                    className={`${BUTTON_BASE} h-8 px-3 text-copy ${variant.className}`}
                  >
                    Disabled
                  </button>
                )}
              </div>
            ))}
            <p className="text-caption text-text-tertiary">
              Heights 28/32/36 · weight 600 · radius 5px · color transitions 300ms ease-standard.
            </p>
          </div>
        </Section>

        <footer className="border-t border-border pt-4 text-caption text-text-tertiary">
          apps/web/src/styles/tokens.css — dossier §2.8, Kale default. “Tokens are law.”
        </footer>
      </main>
    </div>
  )
}
