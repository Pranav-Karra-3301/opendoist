import { expect, test } from '@playwright/test'
import { openQuickAdd, SEL } from './helpers'

/**
 * Phase 7 (Task N gate) — Ramble smoke against the real stack.
 *
 * The e2e server boots with no `OPENTASK_STT_*` / `OPENTASK_LLM_*` env (playwright.config
 * webServer), so both provider slots resolve to `source: 'none'`. That is exactly the state
 * this smoke pins down: the Settings → Integrations page renders the two Voice & AI provider
 * cards with their "Not configured" defaults, and the Quick Add mic button is disabled with
 * the explanatory tooltip instead of silently recording into a 409. The full record→upload→
 * review flow needs a live STT provider plus a real microphone, so it is covered by the
 * server-side pipeline tests and the Task N mock-stack e2e script, not by this browser smoke.
 */

test.describe.configure({ mode: 'serial', retries: 0 })

test('Settings → Integrations renders the Voice & AI provider cards', async ({ page }) => {
  await page.goto('/settings/integrations')
  const settings = page.getByRole('dialog', { name: 'Settings' })

  // Both slot cards render (loaded state replaces the "Voice & AI" loading placeholder).
  await expect(settings.getByRole('heading', { name: 'Speech-to-text', exact: true })).toBeVisible()
  await expect(settings.getByRole('heading', { name: 'Task extraction (LLM)' })).toBeVisible()

  // No env providers on the e2e server → both slots explain their unconfigured default.
  await expect(
    settings.getByText('Not configured — set a provider to enable voice capture.'),
  ).toBeVisible()
  await expect(
    settings.getByText('Not configured — each recording becomes a single task.'),
  ).toBeVisible()

  // Key-handling footnote + docs link (Task L contract).
  await expect(
    settings.getByText('Keys are stored encrypted on this server and never sent to the browser.'),
  ).toBeVisible()
  await expect(
    settings.getByRole('link', { name: /Self-hosting a local transcriber/ }),
  ).toHaveAttribute('href', '/docs/voice-ramble.md')
})

test('Quick Add mic button is disabled with a configure tooltip when STT is unconfigured', async ({
  page,
}) => {
  await page.goto('/today')
  // Wait for the authed layout (which binds hotkeys in the same commit) before pressing `q`.
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  await openQuickAdd(page)
  const dialog = page.getByRole('dialog', { name: SEL.quickAddDialog })

  // Unconfigured STT → the mic renders as a non-interactive trigger, aria-disabled.
  const mic = dialog.getByRole('button', { name: 'Record a voice note' })
  await expect(mic).toBeVisible()
  await expect(mic).toHaveAttribute('aria-disabled', 'true')

  // Hovering surfaces the explanatory tooltip (portaled outside the dialog).
  await mic.hover()
  await expect(
    page.getByText('Configure a speech-to-text provider in Settings → Integrations'),
  ).toBeVisible()

  // Playwright honours aria-disabled: the trigger reads as disabled to AT and to actionability.
  await expect(mic).toBeDisabled()

  // Even a forced click must not start a recording: no pressed/stop state ever appears.
  await mic.click({ force: true })
  await expect(dialog.getByRole('button', { name: 'Stop recording' })).toHaveCount(0)
})
