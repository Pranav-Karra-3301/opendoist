import { expect, type Page, test } from '@playwright/test'

/** Open the account menu → Theme submenu → pick a theme by its visible label. */
async function pickTheme(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Theme' }).hover()
  await page.getByRole('menuitem', { name: label, exact: true }).click()
}

/**
 * Theme switching from the user menu. `applyTheme` (lib/theme.ts) stamps `data-theme` on <html>
 * for explicit themes, persists `od-theme`, and removes the attribute for System. The index.html
 * head script re-applies the persisted choice on reload.
 */
test('applies, persists across reload, and clears the attribute for System', async ({ page }) => {
  await page.goto('/today')
  // `exact` — the Today view also renders an h2 like "Jul 16 · Today · Thursday".
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  const html = page.locator('html')

  await pickTheme(page, 'Dark')
  await expect(html).toHaveAttribute('data-theme', 'dark')

  // Persists across a reload (the head script reads od-theme before React mounts).
  await page.reload()
  await expect(html).toHaveAttribute('data-theme', 'dark')

  await pickTheme(page, 'Tangerine')
  await expect(html).toHaveAttribute('data-theme', 'tangerine')

  // System removes the explicit attribute.
  await pickTheme(page, 'System')
  await expect(html).not.toHaveAttribute('data-theme')
})
