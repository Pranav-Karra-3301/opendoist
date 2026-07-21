import { expect, type Page, test } from '@playwright/test'

/** Open the account menu → Theme submenu → pick a theme by its visible label. */
async function pickTheme(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Theme' }).hover()
  await page.getByRole('menuitem', { name: label, exact: true }).click()
}

/**
 * Theme switching from the user menu (appearance × accent model). The coarse menu choices map onto
 * the two axes via `settingsPatchForChoice`: `Dark` → explicit dark on the Kale accent, a light
 * accent (e.g. `Tangerine`) → explicit light on that accent, `System` → follow the OS from Kale.
 * `applyAppearance`/`applyAccent` (lib/theme.ts) stamp `data-mode="light|dark"` + `data-accent` on
 * <html> (removing `data-mode` for System) and mirror `od-appearance`/`od-accent` to localStorage;
 * the index.html head script re-paints the persisted choice on reload.
 */
test('applies, persists across reload, and clears the mode for System', async ({ page }) => {
  await page.goto('/today')
  // `exact` — the Today view also renders an h2 like "Jul 16 · Today · Thursday".
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  const html = page.locator('html')

  // Dark → explicit dark appearance on the Kale accent.
  await pickTheme(page, 'Dark')
  await expect(html).toHaveAttribute('data-mode', 'dark')
  await expect(html).toHaveAttribute('data-accent', 'kale')

  // Persists across a reload (the head script reads od-appearance/od-accent before React mounts).
  await page.reload()
  await expect(html).toHaveAttribute('data-mode', 'dark')
  await expect(html).toHaveAttribute('data-accent', 'kale')

  // Tangerine → an explicit LIGHT accent: the mode flips to light, the accent to tangerine.
  await pickTheme(page, 'Tangerine')
  await expect(html).toHaveAttribute('data-mode', 'light')
  await expect(html).toHaveAttribute('data-accent', 'tangerine')

  // System removes the explicit mode (the OS then drives `.system-dark`).
  await pickTheme(page, 'System')
  await expect(html).not.toHaveAttribute('data-mode')
})
