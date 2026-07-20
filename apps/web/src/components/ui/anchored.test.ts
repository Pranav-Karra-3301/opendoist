import { describe, expect, test } from 'vitest'
import { type AnchorRect, anchorRect, placePopover } from './anchored'

const viewport = { width: 1280, height: 800 }
const menu = { width: 256, height: 200 }

function rect(top: number, left: number, width = 120, height = 24): AnchorRect {
  return { top, left, width, height }
}

/** Stub with only the surface `anchorRect` touches (web vitest runs in the node env). */
function fakeElement(r: AnchorRect): HTMLElement {
  return {
    getBoundingClientRect: () => ({ ...r, right: r.left + r.width, bottom: r.top + r.height }),
  } as unknown as HTMLElement
}

describe('anchorRect', () => {
  test('prefers the caret (zero-width rect at the caret coords)', () => {
    const el = fakeElement(rect(100, 300))
    expect(anchorRect(el, { top: 120, left: 340, height: 20 })).toEqual({
      top: 120,
      left: 340,
      width: 0,
      height: 20,
    })
  })

  test('falls back to the element bounding rect', () => {
    const el = fakeElement(rect(96, 360, 560, 32))
    expect(anchorRect(el)).toEqual({ top: 96, left: 360, width: 560, height: 32 })
  })
})

describe('placePopover', () => {
  test('places below the anchor with the default 4px offset', () => {
    const pos = placePopover(rect(120, 400), menu, { viewport })
    expect(pos).toEqual({ top: 120 + 24 + 4, left: 400 })
  })

  test('honors a custom offset', () => {
    const pos = placePopover(rect(120, 400), menu, { viewport, offset: 10 })
    expect(pos.top).toBe(120 + 24 + 10)
  })

  test('flips above when the anchor bottom is within 240px of the viewport bottom', () => {
    // anchor bottom = 620 → 180px of space below < 240 → flip
    const pos = placePopover(rect(596, 400), menu, { viewport })
    expect(pos).toEqual({ top: 596 - 4 - 200, left: 400 })
  })

  test('does not flip at exactly 240px of space below', () => {
    // anchor bottom = 560 → space below = 240, not < 240 → stays below
    const pos = placePopover(rect(536, 400), menu, { viewport })
    expect(pos.top).toBe(536 + 24 + 4)
  })

  test('clamps the left edge to the 8px gutter', () => {
    const pos = placePopover(rect(120, 2), menu, { viewport })
    expect(pos.left).toBe(8)
  })

  test('clamps the right edge to the 8px gutter', () => {
    const pos = placePopover(rect(120, 1270), menu, { viewport })
    expect(pos.left).toBe(viewport.width - menu.width - 8)
  })

  test('flipped placement clamps back into the viewport near the top', () => {
    // Tiny viewport: anchor near the bottom flips, but there is no room above either.
    const small = { width: 400, height: 300 }
    const pos = placePopover(rect(150, 50), menu, { viewport: small })
    expect(pos.top).toBe(8)
  })

  test('bottom clamp keeps an unflipped popover fully inside the viewport', () => {
    // flipZone 0 disables flipping; the popover would overflow and must clamp instead.
    const pos = placePopover(rect(700, 400), menu, { viewport, flipZone: 0 })
    expect(pos.top).toBe(viewport.height - menu.height - 8)
  })

  test('a popover wider than the viewport pins to the left gutter', () => {
    const pos = placePopover(rect(120, 300), { width: 2000, height: 100 }, { viewport })
    expect(pos.left).toBe(8)
  })

  test('caret-style zero-width anchors position like any other rect', () => {
    const caret = { top: 130, left: 512, width: 0, height: 20 }
    const pos = placePopover(caret, menu, { viewport })
    expect(pos).toEqual({ top: 130 + 20 + 4, left: 512 })
  })
})
