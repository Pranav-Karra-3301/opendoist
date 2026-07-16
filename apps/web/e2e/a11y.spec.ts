import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'

/**
 * Accessibility smoke: the login screen and the most complex authed views must carry zero
 * `serious`/`critical` axe violations. Each `<main>` (auth shell or app content) exposes a heading,
 * used as the "rendered" signal — the app holds a long-lived SSE connection, so `networkidle` never
 * settles and must not be awaited. Phase 5 (Task X Step 4) adds Filters & Labels, Reporting, and
 * the Settings/Theme overlay (its heading lives in the portalled dialog, not `<main>`).
 */
const ROUTES = ['/login', '/today', '/upcoming', '/filters-labels', '/reporting'] as const

async function expectNoBlockingViolations(page: Page, route: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze()
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  )

  expect(
    blocking.map((v) => `${v.id} (${v.impact})`),
    `a11y violations on ${route}`,
  ).toEqual([])
}

for (const route of ROUTES) {
  test(`no serious or critical a11y violations on ${route}`, async ({ page }) => {
    await page.goto(route)
    await expect(page.getByRole('main').getByRole('heading').first()).toBeVisible()
    await expectNoBlockingViolations(page, route)
  })
}

test('no serious or critical a11y violations on /settings/theme', async ({ page }) => {
  await page.goto('/settings/theme')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog.getByRole('heading', { name: 'Theme', exact: true })).toBeVisible()
  await expectNoBlockingViolations(page, '/settings/theme')
})
