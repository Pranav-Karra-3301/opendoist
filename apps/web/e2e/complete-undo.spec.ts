import { expect, test } from '@playwright/test'
import { quickAdd, SEL } from './helpers'

/**
 * The 10s undo contract for the two destructive row actions. Completing via the checkbox removes
 * the row (after the 250ms check animation) and raises a "Task completed" undo toast; deleting via
 * the row's more-menu raises "Task deleted". Undo restores the row in both cases. (Delete-undo
 * recreates the task with a fresh id — the assertion keys on content, which is preserved.)
 */
test('complete then undo, delete then undo', async ({ page }) => {
  await page.goto('/today')
  // Wait for the authed layout (which binds hotkeys in the same commit) before quickAdd's `q`.
  // `exact` — the Today view also renders an h2 like "Jul 16 · Today · Thursday".
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  await quickAdd(page, 'Water plants today')
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()

  const row = page.locator(SEL.taskRow).filter({ hasText: 'Water plants' })
  await expect(row).toBeVisible()

  // Complete via the checkbox → the row leaves the list + an undo toast appears.
  await row.getByRole('checkbox', { name: SEL.checkbox }).click()
  await expect(page.getByText('Water plants')).toHaveCount(0)
  await expect(page.getByText('Task completed')).toBeVisible()

  // Undo → the task returns to Today.
  await page.getByRole('button', { name: SEL.undo }).click()
  await expect(page.getByText('Water plants')).toBeVisible()

  // Delete via the row's more-menu → an undo toast → undo restores it.
  const restored = page.locator(SEL.taskRow).filter({ hasText: 'Water plants' })
  await restored.hover()
  await restored.getByRole('button', { name: SEL.moreActions }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(page.getByText('Water plants')).toHaveCount(0)
  await expect(page.getByText('Task deleted')).toBeVisible()

  await page.getByRole('button', { name: SEL.undo }).click()
  await expect(page.getByText('Water plants')).toBeVisible()
})
