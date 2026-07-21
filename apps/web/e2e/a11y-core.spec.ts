import { expect, type Page, test } from '@playwright/test'
import { quickAdd } from './helpers'
import { expectNoAxeViolations } from './helpers/a11y'

/**
 * Phase-10 Task D accessibility gate for the core surfaces: app chrome (sidebar nav
 * landmark, skip-to-content link, topbar) plus the Inbox, Today, and Upcoming views.
 *
 * Each view is axe-checked with seeded data in light and dark — both under the full shared
 * gate, incl. colour-contrast (Task O lifted the dark token shortfalls) — then the
 * landmark/keyboard/checkbox assertions from the frozen A11Y ACCEPTANCE CHECKLIST run
 * against a seeded Today view.
 *
 * Dark mode is applied through the real account-menu Theme path (not a forced attribute) so
 * the whole `--od-*` cascade lands; the OS color-scheme is pinned to `light` so the light
 * pass is deterministic; `settle()` waits for chrome paint + web fonts before every axe pass.
 */

/**
 * Idempotent seed: Playwright restarts the worker after any failure, so a module-level
 * "done" flag is unreliable. Instead we wait for Today to render (which means the app —
 * and its global hotkeys — has mounted) and only create the fixtures when they are absent,
 * so re-entry after a retry neither races the `q` hotkey nor piles up duplicates.
 */
async function ensureSeed(page: Page): Promise<void> {
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add task' }).first()).toBeVisible()
  const seededRow = page.locator('[id^="task-"]').filter({ hasText: 'Prepare standup notes' })
  if ((await seededRow.count()) > 0) return
  await quickAdd(page, 'Prepare standup notes today')
  await quickAdd(page, 'Buy stamps for the letter')
  await quickAdd(page, 'Draft trip plan tomorrow')
  await expect(seededRow.first()).toBeVisible()
}

/** Wait for the chrome to paint and fonts to load so axe never reads a mid-paint frame. */
async function settle(page: Page): Promise<void> {
  await expect(page.getByRole('navigation', { name: 'Projects and views' })).toBeVisible()
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const done = () => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts
        if (fonts?.ready) fonts.ready.then(done, done)
        else done()
      }),
  )
}

async function gotoRendered(page: Page, route: string): Promise<void> {
  await page.goto(route)
  // The app holds a long-lived SSE connection, so `networkidle` never settles; a heading
  // inside <main> (Inbox/Today title or the Upcoming month) is the "rendered" signal.
  await expect(page.getByRole('main').getByRole('heading').first()).toBeVisible()
}

/**
 * Switch the theme through the real account-menu path (mirrors theme.spec) so the whole
 * `--od-*` cascade is applied exactly as in production — forcing `data-mode` from JS can
 * leave a half-applied frame that axe reads as spurious contrast failures. The choice is
 * persisted + mirrored to localStorage, so subsequent full navigations stay on it.
 */
async function setTheme(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Theme' }).hover()
  await page.getByRole('menuitem', { name: label, exact: true }).click()
}

const VIEWS = ['/inbox', '/today', '/upcoming'] as const

test.describe('a11y — app chrome, Inbox, Today, Upcoming', () => {
  // Pin the OS preference so `system` theme resolves to light Kale deterministically.
  test.use({ colorScheme: 'light' })

  test('no serious or critical axe violations across Inbox, Today, Upcoming (light)', async ({
    page,
  }) => {
    await ensureSeed(page)
    for (const route of VIEWS) {
      await gotoRendered(page, route)
      await settle(page)
      await expectNoAxeViolations(page)
    }
  })

  test('no serious or critical axe violations across Inbox, Today, Upcoming (dark)', async ({
    page,
  }) => {
    await ensureSeed(page)
    await gotoRendered(page, '/today')
    await setTheme(page, 'Dark')
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark')
    try {
      for (const route of VIEWS) {
        await gotoRendered(page, route)
        // The head script re-applies the persisted choice before React mounts.
        await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark')
        await settle(page)
        // Full shared gate incl. colour-contrast: Task O lifted dark --od-text-tertiary to
        // #a0a0a0 and dark --od-on-accent to #1e1e1e, the two dark token shortfalls that
        // originally forced a contrast-exempt dark scan here.
        await expectNoAxeViolations(page)
      }
    } finally {
      // Never leave the shared user on dark — sibling specs assert light colours.
      await gotoRendered(page, '/today')
      await setTheme(page, 'System')
      await expect(page.locator('html')).not.toHaveAttribute('data-mode')
    }
  })

  test('app chrome: single main, skip link is the first Tab stop, sidebar nav is labeled with aria-current', async ({
    page,
  }) => {
    await ensureSeed(page)
    await gotoRendered(page, '/today')

    // Exactly one main landmark, targeted by the skip link.
    await expect(page.getByRole('main')).toHaveCount(1)
    await expect(page.locator('#main')).toHaveCount(1)

    // The skip-to-content link is the first focusable element.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Skip to content' })
    await expect(skip).toBeFocused()
    await expect(skip).toHaveAttribute('href', '#main')

    // Sidebar is a labeled navigation landmark; the active view carries aria-current="page".
    const nav = page.getByRole('navigation', { name: 'Projects and views' })
    await expect(nav).toBeVisible()
    const current = nav.locator('[aria-current="page"]')
    await expect(current).toHaveCount(1)
    await expect(current).toContainText('Today')
  })

  test('task rows expose a labeled checkbox and the task content', async ({ page }) => {
    await ensureSeed(page)
    await gotoRendered(page, '/today')

    const row = page.locator('[id^="task-"]').filter({ hasText: 'Prepare standup notes' }).first()
    await expect(row).toBeVisible()

    // Task O applied the deferred fix: task-checkbox.tsx now appends the task content to
    // the accessible name ("Complete task: {content}"), so the checkbox is self-describing.
    await expect(row.getByRole('checkbox')).toHaveAccessibleName(
      /complete task: Prepare standup notes/i,
    )
    await expect(row.getByRole('button', { name: /Prepare standup notes/ })).toBeVisible()
  })
})
