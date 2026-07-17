import { expect, test } from '@playwright/test'
import { SEL } from '../helpers'

/**
 * Phase-5 Task J: sidebar nav (Filters & Labels + Reporting), `settings.sidebar` visibility
 * flags, and the g/o keyboard sequences + `?` overlay entries. Assertions scope to the frozen
 * `aside[aria-label="Sidebar"]` shell and tolerate rows left by sibling specs.
 */

const FULL_SIDEBAR = {
  showInbox: true,
  showToday: true,
  showUpcoming: true,
  showFiltersLabels: true,
  showReporting: true,
  showCounts: true,
} as const

test('g/o sequences reach the phase-5 views and the overlay lists them', async ({ page }) => {
  await page.goto('/today')
  // Hotkeys bind with the authed layout — wait for it before pressing keys.
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()

  await page.keyboard.press('g')
  await page.keyboard.press('v')
  await expect(page).toHaveURL(/\/filters-labels/)

  await page.keyboard.press('g')
  await page.keyboard.press('a')
  await expect(page).toHaveURL(/\/reporting/)

  // Settings opens as a lazily-mounted MODAL dialog that focus-traps its search input.
  // Hotkeys are disabled while a modal is open (and swallowed by the focused input), so wait
  // for the dialog and close it before the next sequence — pressing on without waiting races
  // the mount and can stack the `?` overlay on top of it (mount-order-dependent Escape).
  const settingsDialog = page.getByRole('dialog', { name: 'Settings' })
  const closeSettings = async () => {
    await expect(settingsDialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
  }

  await page.keyboard.press('o')
  await page.keyboard.press('s')
  await expect(page).toHaveURL(/\/settings\/account/)
  await closeSettings()

  await page.keyboard.press('o')
  await page.keyboard.press('t')
  await expect(page).toHaveURL(/\/settings\/theme/)
  await closeSettings()

  // `?` overlay lists the new navigation shortcuts.
  await page.keyboard.press('Shift+Slash')
  const overlay = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(overlay).toBeVisible()
  await expect(overlay.getByText(/filters & labels/i).first()).toBeVisible()
  await expect(overlay.getByText(/go to reporting/i).first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(overlay).toBeHidden()
})

test('sidebar honours settings.sidebar visibility flags', async ({ page }) => {
  const sidebar = page.locator(SEL.sidebar)
  try {
    await page.goto('/today')
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()

    // Phase-5 nav items present by default.
    await expect(sidebar.getByRole('link', { name: /filters & labels/i })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: /reporting/i })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: /today/i })).toBeVisible()

    // Hide Today + Reporting via the settings API, then reload to refetch.
    const res = await page.request.patch('/api/v1/user/settings', {
      data: { sidebar: { ...FULL_SIDEBAR, showToday: false, showReporting: false } },
    })
    expect(res.ok()).toBeTruthy()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()

    await expect(sidebar.getByRole('link', { name: /today/i })).toHaveCount(0)
    await expect(sidebar.getByRole('link', { name: /reporting/i })).toHaveCount(0)
    // Untoggled items stay.
    await expect(sidebar.getByRole('link', { name: /filters & labels/i })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: /inbox/i })).toBeVisible()
  } finally {
    // Restore defaults so sibling specs still see the full sidebar.
    await page.request.patch('/api/v1/user/settings', { data: { sidebar: FULL_SIDEBAR } })
  }
})
