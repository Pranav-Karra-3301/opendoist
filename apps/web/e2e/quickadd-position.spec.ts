import { expect, type Locator, type Page, test } from '@playwright/test'
import { SEL } from './helpers'

/**
 * Quick Add UX pass — Task D geometry regressions (plan 2026-07-18-opentask-quickadd-ux §Task D):
 *
 * 1. The dialog opens top-centered with identical geometry from every stable entry point
 *    (global `q`, the sidebar "Add task" button, the palette "Add task" command — all funnel
 *    through the single `setQuickAddOpen(true)` → one <QuickAddDialog>). `a`/`A` become inline
 *    composers in the later entry-point run (plan Task H) and are deliberately excluded here.
 * 2. The dialog top is `max(48px, 18vh)` — 18vh normally, floored at 48px on very short viewports.
 * 3. The sigil autocomplete menu anchors at the CARET (not a screen corner — the phase-4 bug),
 *    follows the caret while typing, stays fully within the viewport at extreme input lengths
 *    (anchored.ts clamp), and flips above the caret near the viewport bottom (anchored.ts flip).
 *
 * The caret's on-screen position is read off the `#…` token's highlight span in the overlay: the
 * caret sits at the span's right edge, so span.right/span.bottom is a stable caret proxy that
 * needs no rich-textarea internals.
 */

interface Box {
  x: number
  y: number
  width: number
  height: number
}

async function box(loc: Locator): Promise<Box> {
  const b = await loc.boundingBox()
  if (b === null) throw new Error('expected a bounding box')
  return b
}

function vpSize(page: Page): { width: number; height: number } {
  const v = page.viewportSize()
  if (v === null) throw new Error('expected a viewport size')
  return v
}

const dialog = (page: Page): Locator => page.getByRole('dialog', { name: SEL.quickAddDialog })
const menuLocator = (page: Page): Locator =>
  page.getByRole('listbox', { name: 'Autocomplete suggestions' })

async function gotoToday(page: Page): Promise<void> {
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
}

async function openViaHotkey(page: Page): Promise<void> {
  await page.keyboard.press('q')
  await expect(dialog(page)).toBeVisible()
}

async function openViaSidebar(page: Page): Promise<void> {
  await page.locator(SEL.sidebar).getByRole('button', { name: 'Add task' }).click()
  await expect(dialog(page)).toBeVisible()
}

async function openViaPalette(page: Page): Promise<void> {
  // Open via the topbar Search button (setPaletteOpen(true)) rather than the `mod+k` hotkey —
  // Playwright's ControlOrMeta and react-hotkeys-hook's `mod` resolve to different modifiers in
  // this Chromium, so the button is the platform-independent path to the same palette.
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Search or jump to' })).toBeVisible()
  // "Add task" is in the palette's default (empty-query) command list; onSelect closes the
  // palette and opens the centered Quick Add.
  await page.getByRole('option', { name: 'Add task' }).first().click()
  await expect(dialog(page)).toBeVisible()
}

/**
 * Type a boundary-anchored `#zzqqxx` (matches no project → the inline "Create" row, so the menu
 * always opens regardless of seed data). `prefix` is filled instantly; only the trigger is typed
 * key-by-key so the caret coords update. Returns the menu + the `#…` token span (caret proxy).
 */
async function typeTrigger(page: Page, prefix: string): Promise<{ menu: Locator; caret: Locator }> {
  const input = page.getByRole('textbox', { name: SEL.quickAddInput })
  await input.click()
  if (prefix !== '') await input.fill(prefix)
  await input.pressSequentially('#zzqqxx')
  const menu = menuLocator(page)
  await expect(menu).toBeVisible()
  const caret = dialog(page).locator(SEL.token('project')).last()
  await expect(caret).toBeVisible()
  return { menu, caret }
}

test.describe('Quick Add position', () => {
  test('opens top-centered with identical geometry from q, the sidebar, and the palette', async ({
    page,
  }) => {
    const vp = vpSize(page)
    const expectedTop = Math.max(48, 0.18 * vp.height)
    const rects: Box[] = []

    for (const open of [openViaHotkey, openViaSidebar, openViaPalette]) {
      await gotoToday(page)
      await open(page)
      const rect = await box(dialog(page))
      rects.push(rect)

      // Horizontally centered (left-1/2 -translate-x-1/2).
      expect(Math.abs(rect.x + rect.width / 2 - vp.width / 2)).toBeLessThanOrEqual(1.5)
      // Top pinned near 18vh, never above the 48px floor.
      expect(rect.y).toBeGreaterThanOrEqual(47.5)
      expect(Math.abs(rect.y - expectedTop)).toBeLessThanOrEqual(2)
      // Width capped at 560px (dossier §2.9 quick-add ≤ 560).
      expect(rect.width).toBeLessThanOrEqual(560.5)
      // No explicit close needed — each iteration's gotoToday() reload dismisses the dialog.
    }

    // Every entry point yields the same rect — geometry is owned by one dialog component.
    const [first, ...rest] = rects
    if (first === undefined) throw new Error('expected at least one dialog rect')
    for (const rect of rest) {
      expect(Math.abs(rect.x - first.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(rect.y - first.y)).toBeLessThanOrEqual(1)
      expect(Math.abs(rect.width - first.width)).toBeLessThanOrEqual(1)
    }
  })

  test('floors the dialog top at 48px on a very short viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 250 })
    await gotoToday(page)
    await openViaHotkey(page)
    // 18vh = 45px < 48 → max(48px,18vh) pins the top at the 48px floor.
    const rect = await box(dialog(page))
    expect(Math.abs(rect.y - 48)).toBeLessThanOrEqual(2)
  })

  test('autocomplete menu hugs the caret, follows it while typing, and stays in the viewport', async ({
    page,
  }) => {
    await gotoToday(page)
    await openViaHotkey(page)
    const { menu, caret } = await typeTrigger(page, 'Buy milk ')

    const m = await box(menu)
    const c = await box(caret)
    const caretRight = c.x + c.width
    const caretBottom = c.y + c.height

    // The menu anchors at the caret rect (< 48px away in both axes), never a screen corner.
    expect(Math.abs(m.x - caretRight)).toBeLessThan(48)
    expect(Math.abs(m.y - caretBottom)).toBeLessThan(48)

    // Fully within the viewport.
    const vp = vpSize(page)
    expect(m.x).toBeGreaterThanOrEqual(0)
    expect(m.y).toBeGreaterThanOrEqual(0)
    expect(m.x + m.width).toBeLessThanOrEqual(vp.width)
    expect(m.y + m.height).toBeLessThanOrEqual(vp.height)

    // Typing more of the query advances the caret → the menu tracks it rightward. Caret coords
    // ride an async `selectionchange`, so poll until the menu settles at the new position.
    await page.getByRole('textbox', { name: SEL.quickAddInput }).pressSequentially('abc')
    await expect(menu).toBeVisible()
    await expect
      .poll(async () => {
        const b = await menu.boundingBox()
        return b === null ? -1 : b.x
      })
      .toBeGreaterThan(m.x + 2)
  })

  test('autocomplete menu stays fully within the viewport at extreme input lengths', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 680, height: 720 })
    await gotoToday(page)
    await openViaHotkey(page)
    // A long run drives the caret toward the dialog's right/bottom; the menu must clamp inward.
    const long = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod '.repeat(4)
    const { menu } = await typeTrigger(page, long)

    const m = await box(menu)
    const vp = vpSize(page)
    expect(m.x).toBeGreaterThanOrEqual(0)
    expect(m.y).toBeGreaterThanOrEqual(0)
    expect(m.x + m.width).toBeLessThanOrEqual(vp.width)
    expect(m.y + m.height).toBeLessThanOrEqual(vp.height)
  })

  test('autocomplete menu flips above the caret near the viewport bottom', async ({ page }) => {
    // A 300px-tall viewport puts even the first caret line inside the 240px bottom flip zone.
    await page.setViewportSize({ width: 900, height: 300 })
    await gotoToday(page)
    await openViaHotkey(page)
    const { menu, caret } = await typeTrigger(page, 'Buy milk ')

    const m = await box(menu)
    const c = await box(caret)
    // Flipped: the menu's bottom sits at or above the caret line (placed above, not below it).
    expect(m.y + m.height).toBeLessThanOrEqual(c.y + 2)
    // Still fully within the viewport.
    const vp = vpSize(page)
    expect(m.x).toBeGreaterThanOrEqual(0)
    expect(m.y).toBeGreaterThanOrEqual(0)
    expect(m.x + m.width).toBeLessThanOrEqual(vp.width)
  })
})
