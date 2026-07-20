import { expect, type Page, test } from '@playwright/test'
import { openQuickAdd, quickAdd, SEL } from './helpers'

/**
 * Quick Add ENTRY-POINT SEMANTICS (Task H). The rule: list-anchored triggers open the INLINE
 * composer; global triggers open the centered dialog.
 *
 *  - Space opens the centered dialog ONLY from a neutral focus (body / non-interactive), and stays
 *    inert on a focused control (a task checkbox keeps toggling) and inside inputs (keeps typing).
 *  - `a` / `Shift+A` open the inline composer at the bottom / top of the focused list view, seeded
 *    with that row's context; in a non-list view they fall back to the centered dialog.
 *  - Enter inside the composer saves and keeps it open with the context re-applied (save-and-new).
 *
 * The centered dialog is `role="dialog"` named "Quick add task"; the inline composer is the
 * `[data-slot="inline-composer"]` card. Asserting the one that appears is asserting WHERE the
 * composer opened. The composer carries its context AS TEXT (text is the single source of truth),
 * so the seeded input value is the load-bearing assertion, not a chip screenshot.
 */

const dialogOf = (page: Page) => page.getByRole('dialog', { name: SEL.quickAddDialog })
const composerOf = (page: Page) => page.locator('[data-slot="inline-composer"]')

test.describe('Quick Add entry points', () => {
  test('Space from a non-interactive target opens the centered dialog', async ({ page }) => {
    await page.goto('/today')
    // Hotkeys bind with the authed layout — wait for it before pressing keys.
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
    const dialog = dialogOf(page)
    await expect(dialog).toBeHidden()

    // The view heading is not focusable, so clicking it drops focus to <body> (a neutral target).
    await page.getByRole('heading', { name: 'Today', exact: true }).click()
    await page.keyboard.press('Space')
    await expect(dialog).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('Space on a focused task checkbox toggles it and does NOT open the dialog', async ({
    page,
  }) => {
    await page.goto('/inbox')
    await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()

    const title = `Space checkbox target ${Date.now()}`
    await quickAdd(page, title) // no date → lands in the Inbox
    await expect(page.getByText(title).first()).toBeVisible()

    const dialog = dialogOf(page)
    const checkbox = page.getByRole('checkbox', { name: title })
    await checkbox.focus()
    await expect(checkbox).toBeFocused()

    await page.keyboard.press('Space')
    // Native activation completes the task (its row leaves the active list); Quick Add never opened.
    await expect(page.getByText(title)).toHaveCount(0)
    await expect(dialog).toBeHidden()
  })

  test('Space typed inside an input inserts a space and never opens the dialog', async ({
    page,
  }) => {
    await page.goto('/today')
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()

    // The dialog input is a form field: enableOnFormTags keeps the Space binding from firing here.
    await openQuickAdd(page)
    const dialog = dialogOf(page)
    const input = page.getByRole('textbox', { name: SEL.quickAddInput })
    await input.click()
    await input.pressSequentially('buy')
    await page.keyboard.press('Space')
    await input.pressSequentially('milk')
    await expect(input).toHaveValue('buy milk')
    // Still exactly one dialog — Space did not re-trigger Quick Add on top of itself.
    await expect(dialog).toHaveCount(1)

    await page.keyboard.press('Escape')
    if (await dialog.isVisible()) await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('a / Shift+A open the inline composer in-list (bottom / top), not the dialog', async ({
    page,
  }) => {
    await page.goto('/upcoming')
    const trigger = page.locator('#main').getByRole('button', { name: 'Add task' })
    await expect(trigger.first()).toBeVisible()
    // Upcoming renders one "+ Add task" row per day, so there is a real top and bottom to land on.
    expect(await trigger.count()).toBeGreaterThanOrEqual(2)

    const dialog = dialogOf(page)
    const composer = composerOf(page)
    const composerInput = () => composer.getByRole('textbox', { name: SEL.quickAddInput })

    // Shift+A → the TOP row (the earliest day); each day seeds its own ISO date into the composer.
    await page.keyboard.press('Shift+A')
    await expect(composer).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(composerInput()).toHaveValue(/^\d{4}-\d{2}-\d{2} $/)
    const topDate = (await composerInput().inputValue()).trim()
    await page.keyboard.press('Escape')
    await expect(composer).toBeHidden()

    // a → the BOTTOM row (a later day) → a later ISO date (ISO strings sort chronologically).
    await page.keyboard.press('a')
    await expect(composer).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(composerInput()).toHaveValue(/^\d{4}-\d{2}-\d{2} $/)
    const bottomDate = (await composerInput().inputValue()).trim()
    expect(topDate < bottomDate).toBe(true)

    await page.keyboard.press('Escape')
    await expect(composer).toBeHidden()
  })

  test('the inline composer opens in place with context and Enter chains adds (save-and-new)', async ({
    page,
  }) => {
    await page.goto('/inbox')
    await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
    // The inbox "+ Add task" row mounts only after projects + tasks load; `a` targets that row, so
    // wait for it before pressing (same precondition the Upcoming case asserts). Pressing mid-load
    // would find no row and fall back to the centered dialog.
    await expect(page.locator('#main').getByRole('button', { name: 'Add task' })).toBeVisible()

    const dialog = dialogOf(page)
    const composer = composerOf(page)
    const input = composer.getByRole('textbox', { name: SEL.quickAddInput })

    // `a` on Inbox opens the composer inline (not the centered dialog), seeded with the #Inbox
    // context expressed as text.
    await page.keyboard.press('a')
    await expect(composer).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(input).toHaveValue('#Inbox ')
    await expect(input).toBeFocused()

    const stamp = Date.now()
    const first = `Inline chain ${stamp} A`
    const second = `Inline chain ${stamp} B`

    await page.keyboard.type(first)
    await expect(input).toHaveValue(`#Inbox ${first}`)
    await input.press('Enter')

    // Save-and-new: the task is created, the composer stays open, and the context is re-applied.
    await expect(page.getByText(first).first()).toBeVisible()
    await expect(composer).toBeVisible()
    await expect(input).toHaveValue('#Inbox ')

    // A second add chains through the same open composer.
    await page.keyboard.type(second)
    await input.press('Enter')
    await expect(page.getByText(second).first()).toBeVisible()
    await expect(composer).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(composer).toBeHidden()
  })

  test('a in a non-list view falls back to the centered dialog', async ({ page }) => {
    await page.goto('/filters-labels')
    await expect(page.getByRole('heading', { name: 'Filters & Labels', exact: true })).toBeVisible()
    // No "+ Add task" rows here.
    await expect(page.locator('#main').getByRole('button', { name: 'Add task' })).toHaveCount(0)

    const dialog = dialogOf(page)
    await expect(dialog).toBeHidden()
    await page.keyboard.press('a')
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })
})
