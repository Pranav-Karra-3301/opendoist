import { expect, test } from '@playwright/test'
import { SEL, seedTasks } from './helpers'

/**
 * The core keyboard map: g-sequence navigation, j/k focus movement, `e` complete, `1` priority,
 * `?` shortcut overlay, `m` sidebar collapse, and `⌘/Ctrl+K` command-palette jump. Assertions key
 * on frozen hooks (row `id`/`data-focused`, checkbox `data-priority`, sidebar `data-collapsed`) and
 * tolerate extra rows left in the shared DB by other specs.
 */
test('keyboard shortcuts drive navigation, focus, actions, overlay, sidebar and palette', async ({
  page,
}) => {
  await page.goto('/today')
  // Hotkeys bind in the same commit as the authed layout — wait for it before pressing keys
  // (goto resolves on document load, well before the router's async session check finishes).
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()

  // g-sequences jump between the primary views.
  await page.keyboard.press('g')
  await page.keyboard.press('i')
  await expect(page).toHaveURL(/\/inbox/)
  await page.keyboard.press('g')
  await page.keyboard.press('u')
  await expect(page).toHaveURL(/\/upcoming/)
  await page.keyboard.press('g')
  await page.keyboard.press('t')
  await expect(page).toHaveURL(/\/today/)

  // Seed two tasks due today, then land on Today.
  await seedTasks(page, ['Keyboard alpha today', 'Keyboard bravo today'])
  await page.goto('/today')
  // `exact` — the Today view also renders an h2 like "Jul 16 · Today · Thursday".
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  // `.first()` — a failed earlier attempt leaves its own seeded copies in the shared DB.
  await expect(page.getByText('Keyboard alpha').first()).toBeVisible()
  await expect(page.getByText('Keyboard bravo').first()).toBeVisible()

  // j / k move focus between rows (identified by their frozen row id).
  await page.keyboard.press('j')
  await expect(page.locator(SEL.focusedRow)).toHaveCount(1)
  const firstId = await page.locator(SEL.focusedRow).getAttribute('id')
  expect(firstId).toBeTruthy()
  await page.keyboard.press('j')
  const secondId = await page.locator(SEL.focusedRow).getAttribute('id')
  expect(secondId).not.toBe(firstId)
  await page.keyboard.press('k')
  await expect(page.locator(SEL.focusedRow)).toHaveAttribute('id', firstId ?? '')

  // `e` completes the focused row → it leaves the list.
  await page.keyboard.press('e')
  await expect(page.locator(`[id="${firstId}"]`)).toBeHidden()

  // Focus a remaining row and set priority 1 → its checkbox reflects data-priority.
  await page.keyboard.press('j')
  await page.keyboard.press('1')
  await expect(page.locator(SEL.focusedRow).locator('[data-priority="1"]')).toBeVisible()

  // `?` opens the shortcut overlay, which lists the Quick Add binding.
  await page.keyboard.press('Shift+Slash')
  const overlay = page.getByRole('dialog')
  await expect(overlay).toBeVisible()
  await expect(overlay.getByText(/quick add/i).first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(overlay).toBeHidden()

  // `m` collapses the sidebar.
  const sidebar = page.locator(SEL.sidebar)
  await expect(sidebar).toHaveAttribute('data-collapsed', 'false')
  await page.keyboard.press('m')
  await expect(sidebar).toHaveAttribute('data-collapsed', 'true')

  // Ctrl+K opens the command palette; typing + Enter jumps to Upcoming. Plain `Control` (not
  // `ControlOrMeta`): the Desktop Chrome descriptor pins a Windows UA, so the app's `mod` key
  // resolves to Ctrl in-page regardless of the host OS — ControlOrMeta would send Meta on macOS
  // hosts and never match.
  await page.keyboard.press('Control+k')
  const palette = page.getByPlaceholder(/search or jump/i)
  await expect(palette).toBeVisible()
  await palette.fill('upc')
  await palette.press('Enter')
  await expect(page).toHaveURL(/\/upcoming/)
})
