import { expect, test } from '@playwright/test'
import { quickAdd } from '../helpers'

/**
 * Phase 5 Task I — the ⌘K palette's server FTS search and navigation commands.
 *
 * `Control+k` (not `ControlOrMeta`): the Desktop Chrome descriptor pins a Windows UA, so the
 * app's `mod` key resolves to Ctrl in-page regardless of the host OS. Assertions tolerate the
 * shared DB (`.first()`, permissive URL regexes) since specs run serially against one server.
 */
test.describe('command palette — FTS search + navigation', () => {
  test('finds a task by a word only in its description and opens it', async ({ page }) => {
    await page.goto('/today')
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()

    // `//` splits content from description → 'eggs' lives only in the description.
    await quickAdd(page, 'buy groceries // milk and eggs')

    await page.keyboard.press('Control+k')
    const palette = page.getByPlaceholder(/search or jump/i)
    await expect(palette).toBeVisible()

    await palette.fill('eggs')

    // No static command/view matches 'eggs', so the only options are Tasks-group FTS hits.
    const result = page.getByRole('option').first()
    await expect(result).toBeVisible()
    await result.click()

    // Selecting a hit deep-links the task detail via the canonical `?task=<id>` search param.
    await expect(page).toHaveURL(/[?&]task=/)
  })

  test('navigation commands jump to the feature pages and settings', async ({ page }) => {
    await page.goto('/today')
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
    const palette = page.getByPlaceholder(/search or jump/i)

    // "Go to Reporting" → /reporting. After each Enter, wait for the palette instance to
    // unmount AND the destination view to render before reopening — reopening mid-close races
    // the old (detaching) input node (Task X gate de-flake).
    await page.keyboard.press('Control+k')
    await expect(palette).toBeVisible()
    await palette.fill('go to reporting')
    await expect(page.getByRole('option').first()).toBeVisible()
    await palette.press('Enter')
    await expect(page).toHaveURL(/\/reporting/)
    await expect(palette).toBeHidden()
    await expect(page.getByRole('heading', { name: 'Reporting', exact: true })).toBeVisible()

    // "Go to Filters & Labels" → /filters-labels.
    await page.keyboard.press('Control+k')
    await expect(palette).toBeVisible()
    await palette.fill('go to filters')
    await expect(page.getByRole('option').first()).toBeVisible()
    await palette.press('Enter')
    await expect(page).toHaveURL(/\/filters-labels/)
    await expect(palette).toBeHidden()
    await expect(page.getByRole('heading', { name: 'Filters & Labels' })).toBeVisible()

    // One command per settings page (from SETTINGS_PAGES): "Settings > Theme" → /settings/theme.
    await page.keyboard.press('Control+k')
    await expect(palette).toBeVisible()
    await palette.fill('settings > theme')
    await expect(page.getByRole('option').first()).toBeVisible()
    await palette.press('Enter')
    await expect(page).toHaveURL(/\/settings\/theme/)
  })
})
