import { expect, test } from '@playwright/test'

/**
 * Task L — Settings shell (SettingsLayout + SettingsSearch). Verifies the overlay dialog
 * deep-links to the right page, that search-within-settings filters the nav and Enter opens the
 * first match, that an unknown `:page` canonicalises to Account, and that Escape closes back to a
 * real view. Selectors are scoped to the "Settings" dialog and its "Settings" nav landmark so
 * they stay stable once Tasks M–V fill in the individual pages.
 */

test('deep-links a page into the overlay dialog with the nav entry active', async ({ page }) => {
  await page.goto('/settings/theme')

  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  // Pane header shows the active registry title (owned by the layout, not the page body).
  await expect(dialog.getByRole('heading', { name: 'Theme', exact: true })).toBeVisible()
  // The matching nav row is marked as the current page.
  const nav = dialog.getByRole('navigation', { name: 'Settings' })
  await expect(nav.getByRole('button', { name: 'Theme', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
})

test('search filters the nav and Enter opens the first match', async ({ page }) => {
  await page.goto('/settings/account')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()

  const nav = dialog.getByRole('navigation', { name: 'Settings' })
  await page.getByPlaceholder('Search settings…').fill('week')

  // "week" hits General (keyword "week start") and drops Account from the list.
  await expect(nav.getByRole('button', { name: 'General', exact: true })).toBeVisible()
  await expect(nav.getByRole('button', { name: 'Account', exact: true })).toBeHidden()

  await page.getByPlaceholder('Search settings…').press('Enter')
  await expect(page).toHaveURL(/\/settings\/general$/)
  await expect(dialog.getByRole('heading', { name: 'General', exact: true })).toBeVisible()
})

test('shows an empty state when nothing matches', async ({ page }) => {
  await page.goto('/settings/account')
  await page.getByPlaceholder('Search settings…').fill('xyzzy')
  await expect(page.getByText('No settings found')).toBeVisible()
})

test('canonicalises an unknown page to Account', async ({ page }) => {
  await page.goto('/settings/bogus')
  await expect(page).toHaveURL(/\/settings\/account$/)
  await expect(
    page.getByRole('dialog', { name: 'Settings' }).getByRole('heading', {
      name: 'Account',
      exact: true,
    }),
  ).toBeVisible()
})

test('Escape closes settings back to the home view', async ({ page }) => {
  await page.goto('/settings/theme')
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden()
  // Default home view is Today.
  await expect(page).toHaveURL(/\/today$/)
})
