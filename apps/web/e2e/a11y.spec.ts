import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/**
 * Accessibility smoke: the login screen and the two most complex authed views must carry zero
 * `serious`/`critical` axe violations. Each `<main>` (auth shell or app content) exposes a heading,
 * used as the "rendered" signal — the app holds a long-lived SSE connection, so `networkidle` never
 * settles and must not be awaited.
 */
const ROUTES = ['/login', '/today', '/upcoming'] as const

for (const route of ROUTES) {
  test(`no serious or critical a11y violations on ${route}`, async ({ page }) => {
    await page.goto(route)
    await expect(page.getByRole('main').getByRole('heading').first()).toBeVisible()

    const results = await new AxeBuilder({ page }).analyze()
    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    )

    expect(
      blocking.map((v) => `${v.id} (${v.impact})`),
      `a11y violations on ${route}`,
    ).toEqual([])
  })
}
