import { expect, test } from '@playwright/test'

/**
 * Task V — Integrations settings (API tokens, Developer links, calendar-feed placeholder).
 *
 * The suite shares ONE server + ONE owner session (playwright.config: workers 1, serial,
 * storageState = the owner's cookie). The token test creates a uniquely-named token and
 * revokes it at the end, leaving the fixture exactly as found. Task X's gate additionally
 * curls a Bearer request with a freshly-minted token; this spec covers the UI contract:
 * create shows `od_…` once, Done collapses to the hint, revoke removes the row.
 */

test.describe.configure({ mode: 'serial', retries: 0 })

test('create a token (shown once), then revoke it', async ({ page }) => {
  const tokenName = `E2E token ${Date.now()}`

  await page.goto('/settings/integrations')
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings.getByRole('heading', { name: 'API tokens', exact: true })).toBeVisible()

  // Open the create dialog from the section footer (unique before the dialog mounts).
  await settings.getByRole('button', { name: 'Create token' }).click()

  const createDialog = page.getByRole('dialog', { name: 'Create API token' })
  await expect(createDialog).toBeVisible()
  await createDialog.getByLabel('Name', { exact: true }).fill(tokenName)
  await createDialog.getByRole('radio', { name: 'Read & write' }).check()
  await createDialog.getByRole('button', { name: 'Create token' }).click()

  // Phase 2: the full secret is revealed exactly once and starts with the od_ prefix.
  const revealed = page.getByRole('dialog', { name: 'Copy your token' })
  await expect(revealed).toBeVisible()
  await expect(revealed.getByText('This token is shown only once — store it now.')).toBeVisible()
  const tokenValue = await revealed.getByLabel('API token').inputValue()
  expect(tokenValue).toMatch(/^od_/)

  await revealed.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('dialog', { name: 'Copy your token' })).toBeHidden()

  // After Done the list shows only the hint — the full secret is nowhere on the page.
  const row = settings.getByRole('row', { name: new RegExp(tokenName) })
  await expect(row).toBeVisible()
  await expect(row.getByText(/^od_.+…$/)).toBeVisible()
  await expect(settings.getByText(tokenValue, { exact: true })).toHaveCount(0)

  // Revoke → confirm → the row disappears.
  await row.getByRole('button', { name: 'Revoke' }).click()
  const confirm = page.getByRole('dialog', { name: 'Revoke token' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Revoke token' }).click()
  await expect(settings.getByRole('row', { name: new RegExp(tokenName) })).toHaveCount(0)
})

test('developer links and the calendar-feed placeholder render', async ({ page }) => {
  await page.goto('/settings/integrations')
  const settings = page.getByRole('dialog', { name: 'Settings' })

  // Developer section: external links point at the live docs + spec routes, new tab.
  const apiRef = settings.getByRole('link', { name: /API reference/i })
  await expect(apiRef).toHaveAttribute('href', '/api/v1/docs')
  await expect(apiRef).toHaveAttribute('target', '_blank')
  await expect(settings.getByRole('link', { name: /OpenAPI spec/i })).toHaveAttribute(
    'href',
    '/api/v1/openapi.json',
  )

  // Calendar feed (phase-6 placeholder): the URL field and Rotate button are disabled.
  await expect(settings.getByRole('textbox', { name: 'Calendar feed URL' })).toBeDisabled()
  await expect(settings.getByRole('button', { name: 'Rotate URL' })).toBeDisabled()
})
