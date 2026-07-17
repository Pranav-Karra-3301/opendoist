/**
 * Pure geometry helpers for the hand-rolled reporting charts (Task M). No chart library:
 * `niceMax` picks a readable y-axis ceiling and `barLayout` spreads bars evenly across a
 * plot width. Both are deterministic and unit-tested (`chart-scale.test.ts`).
 */

/** Mantissas of the "nice" ladder: 5, 10, 25, 50 × 10^k → 5,10,25,50,100,250,500,1000,… */
const NICE_MANTISSAS = [5, 10, 25, 50] as const

/**
 * Smallest value on the 5/10/25/50/100… ladder that is ≥ both the largest input value and
 * `floor` (the goal line, kept inside the plot). Empty input falls back to `floor`. Never
 * returns 0, so a chart of all-zero days still gets a visible axis.
 */
export function niceMax(values: number[], floor: number): number {
  const peak = values.length > 0 ? Math.max(...values) : 0
  const target = Math.max(peak, floor, 0)
  let pow = 1
  // Guard against pathological inputs; the ladder grows past any realistic completion count.
  while (pow <= Number.MAX_SAFE_INTEGER) {
    for (const mantissa of NICE_MANTISSAS) {
      const candidate = mantissa * pow
      if (candidate >= target) return candidate
    }
    pow *= 10
  }
  return target
}

/**
 * Even column layout: `n` bars sharing `width`, separated by `gap`. Returns each bar's left
 * edge `x` and width `w` so that `n*w + (n-1)*gap === width`. Bar width is clamped to ≥ 0.
 */
export function barLayout(n: number, width: number, gap: number): { x: number; w: number }[] {
  if (n <= 0) return []
  const w = Math.max(0, (width - gap * (n - 1)) / n)
  return Array.from({ length: n }, (_, i) => ({ x: i * (w + gap), w }))
}
