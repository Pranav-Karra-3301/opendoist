import { expect, test } from '@playwright/test'
import { openQuickAdd, SEL } from './helpers'

/**
 * Quick Add: live token highlighting, chip mirroring, the Enter-saves-and-stays-open contract,
 * Escape-to-close, and the sigil autocomplete's inline "Create '…'" row. Highlight spans and the
 * dialog title are frozen selectors; chips are asserted through their button labels.
 */
test.describe('Quick Add', () => {
  test('highlights tokens, saves on Enter (stays open), closes on Escape', async ({ page }) => {
    await page.goto('/today')
    // Wait for the authed layout (which binds hotkeys in the same commit) before pressing `q`.
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
    await openQuickAdd(page)

    const dialog = page.getByRole('dialog', { name: SEL.quickAddDialog })
    const input = page.getByRole('textbox', { name: SEL.quickAddInput })
    await input.click()
    // Trailing space so the caret sits outside the @label token → the autocomplete menu is closed
    // and Enter submits (rather than selecting a menu item).
    await input.pressSequentially('Buy milk tomorrow 4pm p1 #Errands @shopping ')

    // Frozen highlight spans (quick-add-input.tsx renders one data-kind span per parsed token).
    await expect(
      dialog
        .locator(SEL.token('due'))
        .filter({ hasText: /tomorrow/i })
        .first(),
    ).toBeVisible()
    await expect(dialog.locator(SEL.token('priority')).first()).toBeVisible()
    await expect(dialog.locator(SEL.token('project')).first()).toBeVisible()
    await expect(dialog.locator(SEL.token('label')).first()).toBeVisible()

    // Chip row mirrors the parsed date + priority (chips are buttons with capital-cased labels).
    await expect(dialog.getByRole('button', { name: /tomorrow/i })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'P1', exact: true })).toBeVisible()

    // Enter saves and keeps the dialog open with a cleared input.
    await input.press('Enter')
    await expect(input).toHaveValue('')
    await expect(dialog).toBeVisible()

    // Escape closes: an empty draft closes on the first press; a non-empty draft would need two.
    await page.keyboard.press('Escape')
    if (await dialog.isVisible()) await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // The task is due tomorrow → it appears in Upcoming and is absent from Today.
    await page.goto('/upcoming')
    await expect(page.getByText('Buy milk').first()).toBeVisible()
    await page.goto('/today')
    // `exact` — the Today view also renders an h2 like "Jul 16 · Today · Thursday".
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
    await expect(page.getByText('Buy milk')).toHaveCount(0)
  })

  test('offers an inline "Create" row for an unknown #project', async ({ page }) => {
    await page.goto('/today')
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
    await openQuickAdd(page)

    const input = page.getByRole('textbox', { name: SEL.quickAddInput })
    await input.click()
    await input.pressSequentially('Plan launch #Zephyr')

    // The sigil autocomplete surfaces an inline create row for the new project name.
    const createRow = page.getByRole('option', { name: "Create 'Zephyr'" })
    await expect(createRow).toBeVisible()

    // Selecting it (Enter) creates the project and dismisses the create row.
    await input.press('Enter')
    await expect(page.getByRole('option', { name: "Create 'Zephyr'" })).toBeHidden()
    await expect(
      page.getByRole('dialog', { name: SEL.quickAddDialog }).locator(SEL.token('project')).first(),
    ).toBeVisible()
  })
})
