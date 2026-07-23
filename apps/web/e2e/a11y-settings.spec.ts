import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { expectNoAxeViolations } from './helpers/a11y'

/**
 * Accessibility gate for the Settings surfaces + auth screens (Phase 10 Task G).
 *
 * Every registry page (features/settings/registry.ts → /settings/$page) and the logged-out
 * login screen must be axe-clean, carry exactly one <h1>, and expose the Settings navigation as
 * a labelled landmark. The Theme page additionally proves that changing the appearance updates
 * `<html data-mode>` and survives a reload from the persisted account setting.
 *
 * Settings renders as a Base UI dialog (SettingsLayout) portalled over the app, so page-level
 * assertions are scoped to `getByRole('dialog', { name: 'Settings' })` — the app chrome behind it
 * (sidebar/topbar) is Task D's surface, gated by a11y-core.
 *
 * Theme coverage: BOTH themes run the FULL axe gate (incl. color-contrast). The dark pass
 * originally had to exclude `color-contrast` for two shortfalls in shared theme tokens
 * (dark `--ot-text-tertiary` #808080 ≈ 3.7:1 on the raised surface; white `--ot-on-accent`
 * on the dark accent ≈ 2.7:1). Task O landed both token fixes (#a0a0a0 tertiary, #1e1e1e
 * on-accent), so dark is contrast-enforced again — see `expectNoDarkViolations`.
 */

/** Registry keys (features/settings/registry.ts), in nav order → /settings/<key>. */
const SETTINGS_PAGES = [
  'account',
  'general',
  'theme',
  'sidebar',
  'quick-add',
  'productivity',
  'reminders',
  'notifications',
  'backups',
  'import',
  'integrations',
  'about',
] as const

/**
 * First SECTION heading (level 2) of each page — proof the lazily-loaded page body has mounted
 * under Suspense (the SettingsLayout chrome itself only renders an `<h2>Settings</h2>`, so a
 * page-specific level-2 heading means the pane resolved). ImportPage has no section heading, so
 * it waits on its intro copy (handled in `openSettings`).
 */
const FIRST_SECTION: Record<string, string> = {
  account: 'Profile',
  general: 'Startup',
  theme: 'Theme',
  sidebar: 'Show in sidebar',
  'quick-add': 'Preview',
  productivity: 'Goals',
  reminders: 'Reminders',
  notifications: 'Push notifications',
  backups: 'Snapshots',
  integrations: 'API tokens',
  about: 'About',
}

const DIALOG = '[role="dialog"]'

async function openSettings(page: Page, key: string) {
  await page.goto(`/settings/${key}`)
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  // The page-title <h1> is part of the (non-lazy) layout header, so it appears immediately.
  await expect(dialog.getByRole('heading', { level: 1 })).toBeVisible()
  // Wait for the lazy page body itself to mount before scanning.
  if (key === 'import') {
    await expect(
      dialog.getByText(/Move your projects|Importing is not available/).first(),
    ).toBeVisible()
  } else {
    await expect(
      dialog.getByRole('heading', { level: 2, name: FIRST_SECTION[key], exact: true }).first(),
    ).toBeVisible()
  }
  return dialog
}

async function setDark(page: Page, dark: boolean) {
  await page.evaluate((on) => {
    if (on) document.documentElement.setAttribute('data-mode', 'dark')
    else document.documentElement.removeAttribute('data-mode')
  }, dark)
}

/**
 * Dark-theme gate: WCAG A+AA, zero serious/critical, `color-contrast` INCLUDED — Task O
 * landed the two dark token fixes (text-tertiary #a0a0a0, on-accent #1e1e1e) that this gate
 * originally had to exclude. Transitions are killed first so switching `data-mode` doesn't
 * crossfade colours mid-scan.
 */
async function expectNoDarkViolations(page: Page, include?: string) {
  await page.addStyleTag({
    content: '*,*::before,*::after{transition:none !important;animation:none !important}',
  })
  await setDark(page, true)
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark')
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
  if (include) builder = builder.include(include)
  const results = await builder.analyze()
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  )
  expect(
    blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([])
}

test.describe('settings pages a11y', () => {
  for (const key of SETTINGS_PAGES) {
    test(`/settings/${key}: one h1, axe-clean in light + dark`, async ({ page }) => {
      const dialog = await openSettings(page, key)

      // Exactly one <h1> (the page title) inside the settings pane.
      await expect(dialog.getByRole('heading', { level: 1 })).toHaveCount(1)

      // Light (Kale baseline clears data-mode) — full axe including color-contrast.
      await setDark(page, false)
      await expectNoAxeViolations(page, { include: DIALOG })

      // Dark — the same full axe gate (Task O landed the dark token fixes).
      await expectNoDarkViolations(page, DIALOG)
    })
  }

  test('settings navigation is a labelled landmark with the active page marked', async ({
    page,
  }) => {
    await openSettings(page, 'account')
    const nav = page.getByRole('navigation', { name: 'Settings' })
    await expect(nav).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Account', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  test('appearance change updates <html data-mode> and persists across a reload', async ({
    page,
  }) => {
    await openSettings(page, 'theme')

    // Selecting the Dark appearance writes through the account-settings PATCH; wait for it to land.
    const [patch] = await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'PATCH' && r.url().includes('/user/settings'),
      ),
      page.getByRole('radio', { name: 'Dark', exact: true }).click(),
    ])
    expect(patch.ok()).toBeTruthy()
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark')

    // Clear the pre-paint localStorage mirror (both axes + the legacy key) so the reload can only
    // get the appearance from the persisted account setting — a genuine server-persistence check.
    await page.evaluate(() => {
      localStorage.removeItem('ot-appearance')
      localStorage.removeItem('ot-accent')
      localStorage.removeItem('ot-theme')
    })
    await page.reload()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await expect(dialog.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark')

    // Restore the System default so sibling specs observe the light baseline (System + the
    // untouched Kale accent → light under the pinned light OS). Wait for the restore PATCH so the
    // shared account is clean server-side before the next spec loads.
    await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'PATCH' && r.url().includes('/user/settings'),
      ),
      page.getByRole('radio', { name: 'System', exact: true }).click(),
    ])
    await expect
      .poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-mode')))
      .toBe(false)
  })
})

test.describe('login screen a11y (logged out)', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('login: one h1, labelled + autocompleted fields, axe-clean in light + dark', async ({
    page,
  }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { level: 1, name: /log in/i })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)

    // Fields are labelled and carry the expected autocomplete hints.
    await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('autocomplete', 'email')
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
      'autocomplete',
      'current-password',
    )

    // Light — full axe; dark — structural (the accent button's dark contrast is a Task H token).
    await setDark(page, false)
    await expectNoAxeViolations(page)
    await expectNoDarkViolations(page)
  })
})
