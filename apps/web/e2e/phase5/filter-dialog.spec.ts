import { expect, test } from '@playwright/test'
import { quickAdd } from '../helpers'

/**
 * Task E — Filter dialog live query validation. Assertions on the dialog body (title, the
 * "Query" field, the inline error alert, the "Pane N · <count>" chips) are owned by Task E and
 * are stable. Opening the dialog goes through the Filters & Labels "Add filter" control built
 * by Task D; if Task D named that control differently, Task X reconciles this one selector at
 * the integration gate. (Task X runs this suite — Task E does not run Playwright.)
 */
test.describe('Filter dialog — live query validation', () => {
  test('flags an invalid query and shows live per-pane counts before saving', async ({ page }) => {
    // Load the authed layout first — quickAdd drives the global `q` hotkey (Task X gate fix:
    // the spec previously pressed `q` on about:blank).
    await page.goto('/today')
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()

    // Seed a task due today in the Inbox so the filter's first pane has something to count.
    await quickAdd(page, 'Filter probe task today')

    await page.goto('/filters-labels')
    await page
      .getByRole('button', { name: /add filter/i })
      .first()
      .click()

    const dialog = page.getByRole('dialog', { name: /add filter/i })
    await expect(dialog).toBeVisible()

    // An unbalanced query surfaces the core parser error inline and keeps Save disabled.
    const query = dialog.getByLabel('Query')
    await query.fill('today &')
    await expect(dialog.getByRole('alert')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Add filter', exact: true })).toBeDisabled()

    // A valid two-pane query shows one live count chip per pane before anything is saved.
    await dialog.getByLabel('Name').fill('Probe filter')
    await query.fill('(today | overdue) & #Inbox, view all & !#Inbox')
    await expect(dialog.getByText(/Pane 1 ·/)).toBeVisible()
    await expect(dialog.getByText(/Pane 2 ·/)).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Add filter', exact: true })).toBeEnabled()
  })
})
