import { expect, test as setup } from '@playwright/test'
import { STORAGE_STATE } from './helpers'

/**
 * First-run registration. On a fresh DB (a new mktemp data dir per run) the very first account
 * becomes the owner and registration then locks, so this must run exactly once — the `setup`
 * project every spec depends on. The register form (auth/register-page.tsx) treats the confirm
 * field as optional, so filling name/email/password is enough to submit.
 */
setup('register the first-run owner', async ({ page }) => {
  await page.goto('/register')
  await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible()

  await page.getByLabel('Name', { exact: true }).fill('Test Owner')
  await page.getByLabel('Email', { exact: true }).fill('owner@example.com')
  await page.getByLabel('Password', { exact: true }).fill('test-password-1')
  await page.getByRole('button', { name: /create account/i }).click()

  // better-auth auto-signs-in (requireEmailVerification: false) → the app redirects to Today.
  await expect(page).toHaveURL(/\/today/, { timeout: 20_000 })

  await page.context().storageState({ path: STORAGE_STATE })
})
