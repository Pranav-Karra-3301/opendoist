import { expect, type Locator, type Page, test } from '@playwright/test'
import { quickAdd, SEL } from './helpers'

/**
 * Quick Add UX pass — Task E scheduler month calendar (plan 2026-07-18-opendoist-quickadd-ux §Task E).
 *
 * The row Schedule popover (SchedulerPanel) now embeds a MonthCalendar below the presets and the
 * free-text box. Both specs drive it from the Inbox, which lists a task regardless of its due —
 * so rescheduling never removes the row under test (Today would drop a task moved off today).
 *
 *  1. Paging to the next month and clicking a day sets the task's due to that month + day.
 *  2. Keyboard-only navigation (focus today's cell → ArrowRight → Enter) picks the next day.
 *
 * The Schedule popover is opened exactly like the undo spec opens the more-menu: hover the row,
 * click its (hover-revealed) action button. `data-slot="month-calendar"` / `data-testid` /
 * `aria-label` / `aria-current` / `data-date` hooks are all verified against month-calendar.tsx.
 */

/** The embedded month grid (month-calendar.tsx sets `data-slot="month-calendar"`). */
const CAL = '[data-slot="month-calendar"]'

/** The open Schedule row popover (row-popovers.tsx names it `aria-label="Schedule task"`). */
function schedulerPopover(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Schedule task' })
}

async function gotoInbox(page: Page): Promise<void> {
  await page.goto('/inbox')
  await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible()
}

/** Hover the (first) row matching `rowText` and open its Schedule popover with the calendar shown. */
async function openScheduler(page: Page, rowText: string): Promise<Locator> {
  const row = page.locator(SEL.taskRow).filter({ hasText: rowText }).first()
  await expect(row).toBeVisible()
  await row.hover()
  await row.getByRole('button', { name: 'Schedule' }).click()
  await expect(schedulerPopover(page).locator(CAL)).toBeVisible()
  return row
}

test.describe('Scheduler month calendar', () => {
  test('pages to the next month and picking a day sets the task due', async ({ page }) => {
    await gotoInbox(page) // mounts the authed layout so quickAdd's `q` hotkey binds
    await quickAdd(page, 'Plan the offsite') // no date token → lands in the Inbox
    await gotoInbox(page)

    const row = await openScheduler(page, 'Plan the offsite')
    const popover = schedulerPopover(page)
    const title = popover.getByTestId('month-title')

    const startTitle = ((await title.textContent()) ?? '').trim()
    await popover.getByRole('button', { name: 'Next month' }).click()
    await expect(title).not.toHaveText(startTitle)

    // e.g. "August 2026" → the chip renders the 3-letter abbrev, which is the month name's prefix
    // for every English month ("August"→"Aug", "September"→"Sep", …).
    const nextTitle = ((await title.textContent()) ?? '').trim()
    const nextMonthAbbr = nextTitle.slice(0, 3)

    // The 15th of the next month is always > 14 days out, so its chip is the plain "MMM 15" form.
    // Only one grid cell is a "-15" date (leading/trailing days are late-/early-month numbers).
    await popover.locator(`${CAL} button[data-date$="-15"]`).click()

    await expect(popover).toBeHidden()
    await expect(row).toContainText(nextMonthAbbr)
    await expect(row).toContainText('15')
  })

  test('keyboard-only navigation picks the next day (today → ArrowRight → Enter)', async ({
    page,
  }) => {
    await gotoInbox(page)
    await quickAdd(page, 'Renew passport')
    await gotoInbox(page)

    const row = await openScheduler(page, 'Renew passport')
    const cal = schedulerPopover(page).locator(CAL)

    // The roving-focus default is today's cell (aria-current="date"); focus it, then step one day.
    const todayCell = cal.locator('button[aria-current="date"]')
    await todayCell.focus()
    await expect(todayCell).toBeFocused()
    await page.keyboard.press('ArrowRight')

    // The roving tabindex (tabindex=0) followed to tomorrow's cell; wait for the effect to land DOM
    // focus there before activating it, so Enter picks tomorrow rather than today.
    const roving = cal.locator('button[tabindex="0"]')
    await expect(roving).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(schedulerPopover(page)).toBeHidden()
    await expect(row).toContainText('Tomorrow')
  })
})
