import { expect, type Page, test } from '@playwright/test'
import { openQuickAdd } from '../helpers'

/**
 * Task Q — Settings → Quick Add. The plan's verify: hiding a chip and reordering another are
 * reflected by the composer chip row after a reload. Covers three flows:
 *   1. hide "Duration" → it leaves the inline row for the "…" overflow, and persists across reload;
 *   2. "Show labels on buttons" off → composer chips render icons only;
 *   3. drag "Priority" above "Date" → the row order persists across reload.
 *
 * Chip selectors are the composer's stable aria-labels (Date/Priority/Duration, "More Quick Add
 * options"); the settings rows carry `data-chip-id`. Runs against the shared dev DB, so a
 * beforeEach resets the quickAdd prefs to their defaults (the settings PATCH merges shallow at the
 * top level, so this never touches other specs' viewPrefs/theme). Task X runs this suite.
 */

const DEFAULT_QUICK_ADD = {
  chips: ['date', 'deadline', 'priority', 'reminders', 'labels', 'duration', 'description'].map(
    (id) => ({ id, visible: true }),
  ),
  labeled: true,
}

test.beforeEach(async ({ page }) => {
  const res = await page.request.patch('/api/v1/user/settings', {
    data: { quickAdd: DEFAULT_QUICK_ADD },
  })
  expect(res.ok(), 'reset quickAdd prefs').toBeTruthy()
})

/** Toggle a settings switch and wait for its PATCH to land so the change survives a reload. */
async function toggleAndPersist(page: Page, switchName: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  const control = dialog.getByRole('switch', { name: switchName })
  await expect(control).toBeChecked()
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/v1/user/settings') && r.request().method() === 'PATCH',
    ),
    control.click(),
  ])
  expect(res.ok()).toBeTruthy()
  await expect(control).not.toBeChecked()
}

test('hiding Duration moves it to the composer overflow and persists across reload', async ({
  page,
}) => {
  await page.goto('/settings/quick-add')
  await expect(
    page.getByRole('dialog', { name: 'Settings' }).getByRole('heading', {
      name: 'Quick Add',
      exact: true,
    }),
  ).toBeVisible()

  await toggleAndPersist(page, 'Show Duration button')

  // Close settings back to Today, then open the real Quick Add composer.
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/today$/)
  await openQuickAdd(page)

  const qa = page.getByRole('dialog', { name: 'Quick add task' })
  // Duration is gone from the inline row; the "…" overflow appeared to hold it.
  await expect(qa.getByRole('button', { name: 'Duration', exact: true })).toHaveCount(0)
  const overflow = qa.getByRole('button', { name: 'More Quick Add options' })
  await expect(overflow).toBeVisible()
  // Opening the overflow reveals the hidden Duration chip (popover portals to the page root).
  await overflow.click()
  await expect(page.getByRole('button', { name: 'Duration', exact: true })).toBeVisible()

  // Persist across a reload. Wait for the authed layout to re-render before pressing `q` —
  // straight after reload() the hotkeys are not bound yet (Task X gate fix).
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  await openQuickAdd(page)
  const qa2 = page.getByRole('dialog', { name: 'Quick add task' })
  await expect(qa2.getByRole('button', { name: 'Duration', exact: true })).toHaveCount(0)
  await expect(qa2.getByRole('button', { name: 'More Quick Add options' })).toBeVisible()
})

test('turning off "Show labels on buttons" renders composer chips icon-only', async ({ page }) => {
  await page.goto('/settings/quick-add')
  await expect(
    page.getByRole('dialog', { name: 'Settings' }).getByRole('heading', {
      name: 'Quick Add',
      exact: true,
    }),
  ).toBeVisible()

  await toggleAndPersist(page, 'Show labels on buttons')

  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/today$/)
  await openQuickAdd(page)

  const qa = page.getByRole('dialog', { name: 'Quick add task' })
  // The Date chip keeps its accessible name but shows no visible "Date" text (icon only).
  const date = qa.getByRole('button', { name: 'Date', exact: true })
  await expect(date).toBeVisible()
  await expect(date).not.toContainText('Date')
})

test('reordering Priority above Date persists across reload', async ({ page }) => {
  await page.goto('/settings/quick-add')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog.getByRole('heading', { name: 'Quick Add', exact: true })).toBeVisible()

  const rows = dialog.locator('[data-chip-id]')
  await expect(rows.first()).toHaveAttribute('data-chip-id', 'date')

  // Drag Priority's grip above the Date row (dnd-kit is pointer-driven — manual mouse steps).
  const grip = dialog.getByRole('button', { name: 'Reorder Priority' })
  const from = await grip.boundingBox()
  const dest = await dialog.locator('[data-chip-id="date"]').boundingBox()
  if (!from || !dest) throw new Error('missing bounding boxes for drag')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, from.y - 12, { steps: 4 })
  await page.mouse.move(dest.x + dest.width / 2, dest.y - 8, { steps: 12 })
  await page.mouse.up()

  await expect(async () => {
    await expect(rows.first()).toHaveAttribute('data-chip-id', 'priority')
  }).toPass()

  await page.reload()
  await expect(dialog.getByRole('heading', { name: 'Quick Add', exact: true })).toBeVisible()
  await expect(dialog.locator('[data-chip-id]').first()).toHaveAttribute('data-chip-id', 'priority')
})
