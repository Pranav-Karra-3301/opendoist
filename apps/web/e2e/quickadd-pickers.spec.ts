import { expect, type Locator, type Page, test } from '@playwright/test'
import { openQuickAdd, SEL } from './helpers'

/**
 * Quick Add UX pass — Task F chip pickers (plan 2026-07-18-opentask-quickadd-ux §Task F).
 *
 * The Deadline / Reminders / Duration chips are real pickers that COMPOSE token spans in the input
 * (text stays the single source of truth) instead of dumping `{}` / `!` / `for ` sigils. Each spec
 * asserts the plan's acceptance criteria: the picker opens anchored to its chip, a pick round-trips
 * into the parsed input text, and disabled states render their hint.
 *
 * Chips are located by the stable `data-chip` hook (their accessible name changes to the rendered
 * value once set, which is date-relative and would be brittle); each picker sets a `data-slot`; the
 * embedded month grid is `[data-slot="month-calendar"]` with `data-date` day buttons (reused from
 * month-calendar.tsx). The dialog and picker popups are both `role=dialog` (base-ui), so pickers are
 * located by `data-slot`, never by an ambiguous dialog role.
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

const dialog = (page: Page): Locator => page.getByRole('dialog', { name: SEL.quickAddDialog })
const input = (page: Page): Locator => page.getByRole('textbox', { name: SEL.quickAddInput })
const chip = (page: Page, id: string): Locator => dialog(page).locator(`[data-chip="${id}"]`)

function vpSize(page: Page): { width: number; height: number } {
  const v = page.viewportSize()
  if (v === null) throw new Error('expected a viewport size')
  return v
}

async function gotoToday(page: Page): Promise<void> {
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
}

/** Fresh centered dialog with `text` typed in. */
async function openWith(page: Page, text: string): Promise<void> {
  await gotoToday(page)
  await openQuickAdd(page)
  await input(page).fill(text)
}

/** Click a chip (by its `data-chip` id) and return its now-open picker (by `data-slot`). */
async function openPicker(page: Page, id: string, slot: string): Promise<Locator> {
  await chip(page, id).click()
  const picker = page.locator(`[data-slot="${slot}"]`)
  await expect(picker).toBeVisible()
  return picker
}

/** Gap between the nearest edges of two rects (0 when they overlap on that axis). */
function edgeGap(aMin: number, aMax: number, bMin: number, bMax: number): number {
  return Math.max(0, aMin - bMax, bMin - aMax)
}

/**
 * The picker is anchored to its chip: its rectangle sits flush against the chip's — just below,
 * flipped above, or (when it is too tall to fit and base-ui flips to the perpendicular side) beside
 * it — and stays fully on-screen. Asserting rectangle adjacency (not a fixed side) proves it hugs
 * the chip and is never floated into a screen corner, whichever side base-ui's collision picks.
 */
function expectAnchored(picker: Box, anchor: Box, vp: { width: number; height: number }): void {
  const dx = edgeGap(picker.x, picker.x + picker.width, anchor.x, anchor.x + anchor.width)
  const dy = edgeGap(picker.y, picker.y + picker.height, anchor.y, anchor.y + anchor.height)
  expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(24)

  expect(picker.x).toBeGreaterThanOrEqual(0)
  expect(picker.y).toBeGreaterThanOrEqual(0)
  expect(picker.x + picker.width).toBeLessThanOrEqual(vp.width + 0.5)
}

test.describe('Quick Add chip pickers', () => {
  test('deadline picker opens anchored to its chip and a day pick writes a {date} token', async ({
    page,
  }) => {
    await openWith(page, 'renew passport')
    const anchor = await box(chip(page, 'deadline'))
    const picker = await openPicker(page, 'deadline', 'deadline-picker')
    expectAnchored(await box(picker), anchor, vpSize(page))

    // Pick the 15th of the visible (current) month — the only `-15` cell in the grid.
    const cell = picker.locator('[data-slot="month-calendar"] button[data-date$="-15"]')
    const date = await cell.getAttribute('data-date')
    expect(date).not.toBeNull()
    await cell.click()

    await expect(picker).toBeHidden()
    await expect(input(page)).toHaveValue(new RegExp(`\\{${date}\\}`))
  })

  test('deadline picker: an optional time writes a {date time} token', async ({ page }) => {
    await openWith(page, 'file taxes')
    const picker = await openPicker(page, 'deadline', 'deadline-picker')
    await picker.getByLabel('Deadline time (optional)').fill('09:00')

    const cell = picker.locator('[data-slot="month-calendar"] button[data-date$="-20"]')
    const date = await cell.getAttribute('data-date')
    await cell.click()

    await expect(picker).toBeHidden()
    await expect(input(page)).toHaveValue(new RegExp(`\\{${date} 09:00\\}`))
  })

  test('deadline picker clears the deadline via its clear button', async ({ page }) => {
    await openWith(page, 'pay invoice {dec 25}')
    const picker = await openPicker(page, 'deadline', 'deadline-picker')
    await picker.getByRole('button', { name: 'Clear deadline' }).click()

    await expect(picker).toBeHidden()
    await expect(input(page)).toHaveValue('pay invoice')
  })

  test('reminder picker appends a !… token from a preset and lists it on reopen', async ({
    page,
  }) => {
    await openWith(page, 'ship it 3pm')
    const anchor = await box(chip(page, 'reminders'))
    const picker = await openPicker(page, 'reminders', 'reminder-picker')
    expectAnchored(await box(picker), anchor, vpSize(page))

    await picker.getByRole('button', { name: '30 minutes before' }).click()
    await expect(picker).toBeHidden()
    await expect(input(page)).toHaveValue(/!30 min before/)

    // Reopen the (now-valued) chip: the current-reminders list shows the added reminder.
    const reopened = await openPicker(page, 'reminders', 'reminder-picker')
    await expect(reopened).toContainText('30 min before')
  })

  test('reminder picker: relative presets are disabled with a hint when the due is untimed', async ({
    page,
  }) => {
    await openWith(page, 'ship it') // no due time
    const picker = await openPicker(page, 'reminders', 'reminder-picker')

    await expect(picker.getByText('Needs a due time')).toBeVisible()
    await expect(picker.getByRole('button', { name: '30 minutes before' })).toBeDisabled()
  })

  test('duration menu inserts `for X` after a timed due', async ({ page }) => {
    await openWith(page, 'call mom 4pm')
    const anchor = await box(chip(page, 'duration'))
    const menu = await openPicker(page, 'duration', 'duration-menu')
    expectAnchored(await box(menu), anchor, vpSize(page))

    await menu.getByRole('button', { name: '45 min' }).click()
    await expect(menu).toBeHidden()
    await expect(input(page)).toHaveValue(/for 45min/)
  })

  test('duration menu: disabled with a hint when there is no timed due', async ({ page }) => {
    await openWith(page, 'call mom') // no due time
    const menu = await openPicker(page, 'duration', 'duration-menu')

    await expect(menu.getByText('Add a due time first')).toBeVisible()
    // Presets are not rendered at all without a timed due — only the hint.
    await expect(menu.getByRole('button', { name: '45 min' })).toHaveCount(0)
  })
})
