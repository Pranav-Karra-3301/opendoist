import { describe, expect, it } from 'vitest'

// Assert against the real tokens.css on disk. The web app's tsconfig targets the browser and
// ships no @types/node, so `node:fs` can't be a statically-typed import here; load it through a
// dynamic import with a computed specifier (TS skips module resolution on non-literal specifiers)
// and narrow it to the one call we use. Vitest's node environment provides the module at runtime.
// (Vite's `?raw` is not an option: its CSS plugin intercepts `.css` and yields an empty string.)
const { readFileSync } = (await import(['node', 'fs'].join(':'))) as {
  readFileSync(path: string | URL, encoding: 'utf8'): string
}
const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')

/**
 * Guards the r2 "text-on-dark-surface contrast ≥ 4.5:1" bar for the accent palette.
 *
 * Each accent's dark half (`--accent-dark`) drives `--ot-accent` in dark mode, which renders
 * both as accent-filled buttons (dark text on the accent) AND as accent-colored text/labels on
 * the neutral dark surfaces — including the #363636 hover/selected row, the tightest of them.
 * The codebase already treats #363636 as a ≥4.5:1 text surface (see the `--ot-text-tertiary`
 * #a0a0a0 comment in tokens.css). This test parses tokens.css and locks every accent to that
 * floor so a future palette edit can't silently drop an accent below AA on any dark surface.
 */

const AA_NORMAL = 4.5

function srgbToLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

function contrast(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Extract a `#rrggbb` value for `prop` from the given CSS block body. */
function readColor(block: string, prop: string): string {
  const value = block.match(new RegExp(`${prop}:\\s*(#[0-9a-fA-F]{6})`))?.[1]
  if (!value) throw new Error(`missing ${prop} in block`)
  return value.toLowerCase()
}

// The dark-mode block ([data-mode="dark"], .system-dark { ... }) holds the neutral surfaces the
// accent renders text on. No nested braces inside, so a lazy [^}] capture is exact.
const darkBlock = css.match(/\[data-mode="dark"\],\s*\.system-dark\s*\{([^}]*)\}/)?.[1]
if (!darkBlock) throw new Error('could not locate the [data-mode="dark"] block in tokens.css')

const darkSurfaces = {
  'bg (#1e1e1e)': readColor(darkBlock, '--ot-bg'),
  'raised (#282828)': readColor(darkBlock, '--ot-surface-raised'),
  'hover/selected-row (#363636)': readColor(darkBlock, '--ot-hover'),
}
const darkOnAccent = readColor(darkBlock, '--ot-on-accent') // #1e1e1e — dark text on the accent fill

// Every [data-accent="X"] block and its --accent-dark value.
const accentDark = new Map<string, string>()
for (const match of css.matchAll(/\[data-accent="(\w+)"\]\s*\{([^}]*)\}/g)) {
  const name = match[1]
  const body = match[2]
  if (!name || !body) continue
  accentDark.set(name, readColor(body, '--accent-dark'))
}

describe('accent dark-mode contrast (tokens.css)', () => {
  it('parses all seven accents', () => {
    expect([...accentDark.keys()].sort()).toEqual(
      ['blueberry', 'kale', 'lavender', 'moonstone', 'raspberry', 'tangerine', 'todoist'].sort(),
    )
  })

  for (const [accent, value] of accentDark) {
    for (const [surfaceName, surface] of Object.entries(darkSurfaces)) {
      it(`${accent} (${value}) is ≥ ${AA_NORMAL}:1 as text on ${surfaceName}`, () => {
        expect(contrast(value, surface)).toBeGreaterThanOrEqual(AA_NORMAL)
      })
    }

    it(`${accent} (${value}) carries legible on-accent text (${darkOnAccent}) ≥ ${AA_NORMAL}:1`, () => {
      expect(contrast(darkOnAccent, value)).toBeGreaterThanOrEqual(AA_NORMAL)
    })
  }
})
