import { expect, test } from '@playwright/test'
import { SEL, seedTasks } from '../helpers'

/**
 * Task H — the per-view Display menu. Two flows from the plan's verify block:
 *   1. Today group-by is persisted per `viewKey('today')` and survives a reload.
 *   2. Toggling "show completed" in a (project) view reveals its completed tasks.
 *
 * The menu trigger is the "Display" text button; each control carries a stable
 * aria-label (Group by / Sort by / Show completed tasks). Runs against the shared dev DB,
 * so each test resets the prefs it changed. Task X runs this suite.
 */
test.describe('Display menu', () => {
  test('Today group-by priority persists across a reload', async ({ page }) => {
    await page.goto('/today')
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Display' }).click()
    await page.getByLabel('Group by').click()
    await page.getByRole('option', { name: 'Priority', exact: true }).click()
    // The trigger now reflects the choice and the "customized" dot appears.
    await expect(page.getByLabel('Group by')).toContainText('Priority')

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Display' }).click()
    await expect(page.getByLabel('Group by')).toContainText('Priority')

    // Leave defaults for the shared DB / other specs.
    await page.getByRole('button', { name: 'Reset to default' }).click()
  })

  test('show completed reveals completed tasks in the view', async ({ page }) => {
    await page.goto('/inbox')
    await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()

    const content = 'Display show-completed target'
    await seedTasks(page, [content])

    const row = page.locator(SEL.taskRow).filter({ hasText: content })
    await expect(row).toBeVisible()
    await row.getByRole('checkbox', { name: SEL.checkbox }).click()
    // Completing removes it from the active list.
    await expect(row).toBeHidden()

    await page.getByRole('button', { name: 'Display' }).click()
    await page.getByLabel('Show completed tasks').click()
    // Close the popover to inspect the view body.
    await page.keyboard.press('Escape')

    await expect(page.getByRole('heading', { name: 'Completed', exact: true })).toBeVisible()
    await expect(page.getByText(content)).toBeVisible()

    // Reset show-completed off.
    await page.getByRole('button', { name: 'Display' }).click()
    await page.getByRole('button', { name: 'Reset to default' }).click()
  })
})
