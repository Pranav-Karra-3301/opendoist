/**
 * Viewport-space popover positioning (quick-add UX pass, Task A — FROZEN contract; Tasks D/E/F
 * import, never edit).
 *
 * Every number in and out of this module is VIEWPORT space (what `getBoundingClientRect` and
 * rich-textarea's `onSelectionChange` caret coords report). Apply the result with
 * `position: fixed` on an element whose containing block is the viewport — i.e. portal the
 * popover to `document.body`. A CSS-transformed ancestor (the dialog popup uses
 * `-translate-x-1/2`) becomes the containing block for `fixed` descendants and re-introduces
 * exactly the coordinate-space mismatch this util exists to fix (the phase-4 autocomplete
 * rendered viewport coords `position:absolute` inside the input's `relative` wrapper — the
 * "menu in the screen corner" bug).
 */

/** Minimal viewport-space rect (a `DOMRect` satisfies it structurally). */
export interface AnchorRect {
  top: number
  left: number
  width: number
  height: number
}

export interface CaretCoords {
  /** viewport-space, as reported by rich-textarea `onSelectionChange` */
  top: number
  left: number
  height: number
}

/**
 * The rect a popover should anchor to: the caret (zero-width) when coords are available,
 * otherwise the element's own bounding rect (chips, buttons, inputs).
 */
export function anchorRect(el: HTMLElement, caret?: CaretCoords): AnchorRect {
  if (caret) return { top: caret.top, left: caret.left, width: 0, height: caret.height }
  const rect = el.getBoundingClientRect()
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
}

export interface PlacePopoverOptions {
  /** gap between anchor and popover edge (default 4) */
  offset?: number
  /** horizontal + vertical clamp margin against the viewport edges (default 8) */
  gutter?: number
  /** flip above when the anchor's bottom is within this many px of the viewport bottom (default 240) */
  flipZone?: number
  /** injectable for tests; defaults to `window` dimensions */
  viewport?: { width: number; height: number }
}

/**
 * Place a popover of known size against a viewport-space anchor rect:
 * below the anchor by default, flipped above when the anchor sits within `flipZone` px of the
 * viewport bottom, then clamped fully into the viewport with `gutter` px margins on all sides.
 */
export function placePopover(
  anchor: AnchorRect,
  popover: { width: number; height: number },
  opts?: PlacePopoverOptions,
): { top: number; left: number } {
  const offset = opts?.offset ?? 4
  const gutter = opts?.gutter ?? 8
  const flipZone = opts?.flipZone ?? 240
  const viewport = opts?.viewport ?? { width: window.innerWidth, height: window.innerHeight }

  const anchorBottom = anchor.top + anchor.height
  const flip = viewport.height - anchorBottom < flipZone
  const top = flip ? anchor.top - offset - popover.height : anchorBottom + offset

  return {
    top: clamp(top, gutter, viewport.height - popover.height - gutter),
    left: clamp(anchor.left, gutter, viewport.width - popover.width - gutter),
  }
}

function clamp(value: number, min: number, max: number): number {
  // A popover larger than the clamp range pins to the min edge (top/left stays visible).
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}
