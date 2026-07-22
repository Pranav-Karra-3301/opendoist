import { expect, test } from '@playwright/test'
import { SEL } from './helpers'

/**
 * Task F — chrome restructure. The global top bar is removed; its controls now live in the
 * sidebar header, and each list view keeps the Display menu at its top-right.
 */

test('the global top bar is gone and its controls live in the sidebar header', async ({ page }) => {
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()

  // The former top bar was the app's only banner landmark (view/sidebar headers nest inside
  // <main>/<aside>, so they aren't banners); removing it leaves none.
  await expect(page.getByRole('banner')).toHaveCount(0)

  const sidebar = page.locator(SEL.sidebar)
  await expect(sidebar.getByRole('button', { name: 'Add task' })).toBeVisible()
  await expect(sidebar.getByRole('button', { name: /record a voice note/i })).toBeVisible()
  await expect(sidebar.getByRole('button', { name: 'Search' })).toBeVisible()
  await expect(sidebar.getByRole('link', { name: 'Notifications' })).toBeVisible()
  await expect(sidebar.getByRole('button', { name: 'Account menu' })).toBeVisible()

  // Search still opens the ⌘K palette from its new home in the sidebar.
  await sidebar.getByRole('button', { name: 'Search' }).click()
  await expect(page.getByPlaceholder('Search or jump to…')).toBeVisible()
  await page.keyboard.press('Escape')
})

test('the Display menu sits in the view header (not the sidebar) and opens', async ({ page }) => {
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()

  const sidebar = page.locator(SEL.sidebar)
  // The trigger is a "Display" text button (reference screenshot 1), not an icon-only control.
  const display = page.getByRole('button', { name: 'Display', exact: true })
  await expect(display).toBeVisible()
  // It is a top-right view-header control, not a sidebar one.
  await expect(sidebar.getByRole('button', { name: 'Display', exact: true })).toHaveCount(0)

  await display.click()
  const popover = page.locator('[data-slot="popover-content"]')
  await expect(popover).toBeVisible()

  // Layout segmented control (first section): List (the default) is active and Board is a live
  // choice (Board View pass); Calendar stays a non-goal, disabled with a "Soon" affordance.
  await expect(popover.getByText('Layout', { exact: true })).toBeVisible()
  const listSeg = popover.getByRole('button', { name: 'List', exact: true })
  await expect(listSeg).toBeEnabled()
  await expect(listSeg).toHaveAttribute('aria-pressed', 'true')
  const boardSeg = popover.getByRole('button', { name: 'Board', exact: true })
  await expect(boardSeg).toBeEnabled()
  await expect(boardSeg).toHaveAttribute('aria-pressed', 'false')
  await expect(popover.getByRole('button', { name: /Calendar/ })).toBeDisabled()
  await expect(popover.getByText('Soon', { exact: true })).toHaveCount(1)

  // Completed toggle + reference-named Sort sections; the extra "Due" filter is gone.
  await expect(popover.getByLabel('Show completed tasks')).toBeVisible()
  await expect(popover.getByText('Grouping', { exact: true })).toBeVisible()
  await expect(popover.getByText('Sorting', { exact: true })).toBeVisible()
  await expect(popover.getByText('Due', { exact: true })).toHaveCount(0)

  await page.keyboard.press('Escape')
})
