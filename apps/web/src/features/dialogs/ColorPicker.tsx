/**
 * 20-color project/label/filter palette picker — FROZEN by Task A (plan Step 5).
 * Color names mirror the server's PALETTE enum; swatches paint via the
 * `--od-palette-*` tokens (auto-brightened in dark themes by tokens.css).
 */
// biome-ignore-all lint/a11y/useSemanticElements: frozen plan markup — styled swatch buttons inside role="radiogroup"; native radios cannot render as 24px color dots
export const PROJECT_COLORS = [
  'berry_red',
  'red',
  'orange',
  'yellow',
  'olive_green',
  'lime_green',
  'green',
  'mint_green',
  'teal',
  'sky_blue',
  'light_blue',
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
export type ProjectColor = (typeof PROJECT_COLORS)[number]
export const colorVar = (c: string) => `var(--od-palette-${c.replaceAll('_', '-')})`
export function ColorPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (c: ProjectColor) => void
}) {
  return (
    <div role="radiogroup" aria-label="Color" className="grid grid-cols-10 gap-2">
      {PROJECT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          title={c.replaceAll('_', ' ')}
          onClick={() => onChange(c)}
          className="h-6 w-6 rounded-full outline-offset-2 aria-checked:outline-2 aria-checked:outline-focus-ring"
          style={{ backgroundColor: colorVar(c) }}
        />
      ))}
    </div>
  )
}
