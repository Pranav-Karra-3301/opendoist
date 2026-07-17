import { expect, test } from '@playwright/test'

/**
 * Regression (phase-10 review, HIGH): a hard-offline reload used to render TanStack Router's
 * default "Something went wrong!" screen because the app-route session guard let the
 * `/api/auth/get-session` network failure propagate before any view mounted — defeating the
 * PWA offline story (precached shell + od-api cache held a fully renderable Today).
 *
 * The dev-server suite cannot go truly offline (no service worker in dev to serve the shell),
 * so this aborts ONLY the session probe — the exact request whose rejection caused the crash —
 * and asserts the app still renders: no router error screen, no bounce to /login.
 */
test('session probe network failure renders the app, not the router error screen', async ({
  page,
}) => {
  await page.route('**/api/auth/get-session*', (route) => route.abort('internetdisconnected'))

  await page.goto('/today')

  // The guard swallows the network failure: the Today view mounts on the requested URL.
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/today')
  // Neither failure mode regressed: no router error screen, no misredirect to the login form.
  await expect(page.getByText('Something went wrong')).toHaveCount(0)
  await expect(page.getByLabel('Email')).toHaveCount(0)

  await page.unroute('**/api/auth/get-session*')
})
