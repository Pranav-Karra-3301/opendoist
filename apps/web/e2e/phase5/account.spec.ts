import { expect, type Page, test } from '@playwright/test'
import { STORAGE_STATE } from '../helpers'

/**
 * Task M — Account settings: password change.
 *
 * The task's acceptance check: "change password → old session still valid,
 * sign-out/sign-in with new password works."
 *
 * The whole suite shares ONE server + ONE owner session (playwright.config: workers 1,
 * serial, storageState = the owner's cookie). Two properties make that safe here:
 *  - better-auth's `changePassword({ revokeOtherSessions: true })` deletes ALL of the
 *    user's sessions and hands the *calling* context a freshly rotated cookie
 *    (update-user.mjs: deleteUserSessions → createSession → setSessionCookie). This
 *    page therefore stays signed in, but the token saved in `e2e/.auth/user.json` is
 *    revoked — so the spec RE-SAVES its context's storage state at the end, leaving a
 *    valid session for every later test (Task X integration-gate fix).
 *  - The spec restores the original password at the end, so the fixture is left exactly
 *    as it was found. Retries are disabled so a mid-way failure can't re-enter with the
 *    wrong "current" password.
 *
 * Requires the Settings shell (Task L) to render the Account page at /settings/account;
 * Task X runs this after all phase-5 tasks integrate.
 */

const OWNER_EMAIL = 'owner@example.com'
const ORIGINAL_PASSWORD = 'test-password-1'
const NEW_PASSWORD = 'test-password-2-rotated'

test.describe.configure({ mode: 'serial', retries: 0 })

/** Drive the Password section of /settings/account and wait for the success banner. */
async function changePassword(page: Page, current: string, next: string): Promise<void> {
  await page.goto('/settings/account')
  await expect(page.getByRole('heading', { name: 'Password', exact: true })).toBeVisible()
  await page.locator('#account-current-password').fill(current)
  await page.locator('#account-new-password').fill(next)
  await page.locator('#account-confirm-password').fill(next)
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText(/password updated/i)).toBeVisible()
}

test('changing the password keeps this session and works on a fresh login', async ({
  page,
  browser,
  baseURL,
}) => {
  // 1. Change the password from the shared owner session.
  await changePassword(page, ORIGINAL_PASSWORD, NEW_PASSWORD)

  // 2. The current session is still valid — a guarded route does not bounce to /login.
  await page.goto('/today')
  await expect(page).toHaveURL(/\/today/)
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()

  // 3. A brand-new, unauthenticated context can sign in with the NEW password.
  const fresh = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    const freshPage = await fresh.newPage()
    await freshPage.goto('/login')
    await freshPage.getByLabel('Email', { exact: true }).fill(OWNER_EMAIL)
    await freshPage.getByLabel('Password', { exact: true }).fill(NEW_PASSWORD)
    await freshPage.getByRole('button', { name: /^log in$/i }).click()
    await expect(freshPage).toHaveURL(/\/today/, { timeout: 20_000 })
  } finally {
    await fresh.close()
  }

  // 4. Restore the fixture: change the password back (again keeping this session).
  await changePassword(page, NEW_PASSWORD, ORIGINAL_PASSWORD)

  // 5. Both changePassword calls revoked every stored session and rotated this context's
  // cookie, so persist the rotated (valid) token for all later tests in the serial suite.
  await page.context().storageState({ path: STORAGE_STATE })
})

test('password form validates before calling the server', async ({ page }) => {
  await page.goto('/settings/account')
  await expect(page.getByRole('heading', { name: 'Password', exact: true })).toBeVisible()

  // Too-short new password → inline error, no success banner.
  await page.locator('#account-current-password').fill(ORIGINAL_PASSWORD)
  await page.locator('#account-new-password').fill('short')
  await page.locator('#account-confirm-password').fill('short')
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText(/at least 8/i)).toBeVisible()

  // Mismatched confirmation → inline error.
  await page.locator('#account-new-password').fill('a-longer-password')
  await page.locator('#account-confirm-password').fill('a-different-password')
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText(/do not match/i)).toBeVisible()
})
