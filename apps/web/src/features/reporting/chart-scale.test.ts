import { describe, expect, it } from 'vitest'
import { barLayout, niceMax } from './chart-scale'

describe('niceMax', () => {
  it.each([
    // [values, floor, expected]
    [[], 5, 5], // empty → floor
    [[3], 5, 5], // below floor → floor
    [[5], 5, 5], // exact ladder value
    [[6], 5, 10],
    [[10], 5, 10],
    [[11], 5, 25],
    [[25], 5, 25],
    [[26], 5, 50],
    [[50], 5, 50],
    [[51], 5, 100],
    [[0], 0, 5], // all-zero still gets a visible axis
    [[100], 10, 100],
    [[101], 10, 250],
    [[250], 10, 250],
    [[251], 10, 500],
    [[500], 25, 500],
    [[501], 25, 1000],
    [[1000], 25, 1000],
    [[1200], 100, 2500],
    [[7, 3, 9], 5, 10], // uses the peak
    [[2, 2, 2], 25, 25], // floor dominates the peak
  ])('niceMax(%j, %i) → %i', (values, floor, expected) => {
    expect(niceMax(values, floor)).toBe(expected)
  })
})

describe('barLayout', () => {
  it('returns nothing for a non-positive count', () => {
    expect(barLayout(0, 100, 4)).toEqual([])
    expect(barLayout(-3, 100, 4)).toEqual([])
  })

  it.each([
    [1, 100, 4, [{ x: 0, w: 100 }]],
    [
      2,
      100,
      4,
      [
        { x: 0, w: 48 },
        { x: 52, w: 48 },
      ],
    ],
    [
      3,
      100,
      5,
      [
        { x: 0, w: 30 },
        { x: 35, w: 30 },
        { x: 70, w: 30 },
      ],
    ],
    [
      4,
      100,
      4,
      [
        { x: 0, w: 22 },
        { x: 26, w: 22 },
        { x: 52, w: 22 },
        { x: 78, w: 22 },
      ],
    ],
  ])('barLayout(%i, %i, %i)', (n, width, gap, expected) => {
    expect(barLayout(n, width, gap)).toEqual(expected)
  })

  it('spans the full width with equal bars (14-bar daily chart)', () => {
    const bars = barLayout(14, 560, 8)
    expect(bars).toHaveLength(14)
    const first = bars[0]
    const last = bars.at(-1)
    if (first === undefined || last === undefined) throw new Error('expected 14 bars')
    expect(first.x).toBe(0)
    // every bar has the same width
    for (const bar of bars) expect(bar.w).toBeCloseTo(first.w, 10)
    // last bar's right edge lands exactly on the plot width
    expect(last.x + last.w).toBeCloseTo(560, 9)
  })

  it('clamps bar width to zero when there is no room', () => {
    // width smaller than the gaps alone → no negative widths reach the SVG
    for (const bar of barLayout(5, 4, 4)) expect(bar.w).toBe(0)
  })
})
