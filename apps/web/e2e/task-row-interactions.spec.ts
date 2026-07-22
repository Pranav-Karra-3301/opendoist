import { expect, type Locator, type Page, test } from '@playwright/test'
import { quickAdd, SEL } from './helpers'

/**
 * Task E — task-row refinements: contextual due-chip suppression, click-empty-to-deselect,
 * and the 6-dot drag handle.
 *
 * Runs against the shared owner session, so every fixture carries a unique marker (sibling
 * specs never look for these) and seeding is presence-guarded so a Playwright retry
 * (config `retries: 1`) re-runs the whole test without ever double-seeding.
 */

async function seedIfAbsent(page: Page, marker: string, text: string): Promise<void> {
  const existing = page.locator('[id^="task-"]').filter({ hasText: marker })
  if ((await existing.count()) === 0) await quickAdd(page, text)
}

async function rowTop(locator: Locator): Promise<number> {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('row has no bounding box')
  return box.y
}

test('a due chip that just repeats the view date is suppressed in Today but kept in Inbox', async ({
  page,
}) => {
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  // NL date words are parsed out of the content, so the titles carry no "Today"/"Tomorrow" text.
  await seedIfAbsent(page, 'Chipsuppress alpha', 'Chipsuppress alpha today')
  await seedIfAbsent(page, 'Chipkeep bravo', 'Chipkeep bravo tomorrow')

  // Today view: the today task is listed, but its redundant "Today" chip is gone.
  await page.goto('/today')
  const todayRow = page.locator('[id^="task-"]').filter({ hasText: 'Chipsuppress alpha' }).first()
  await expect(todayRow).toBeVisible()
  await expect(todayRow.getByText('Today', { exact: true })).toHaveCount(0)

  // Inbox implies no date, so the SAME task keeps its "Today" chip and the tomorrow task keeps
  // "Tomorrow" — proving the suppression is contextual to the view, not a global change.
  await page.goto('/inbox')
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
  const inboxToday = page.locator('[id^="task-"]').filter({ hasText: 'Chipsuppress alpha' }).first()
  await expect(inboxToday.getByText('Today', { exact: true })).toBeVisible()
  const inboxTomorrow = page.locator('[id^="task-"]').filter({ hasText: 'Chipkeep bravo' }).first()
  await expect(inboxTomorrow.getByText('Tomorrow', { exact: true })).toBeVisible()
})

test('clicking empty content-area space clears the focused task', async ({ page }) => {
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  await seedIfAbsent(page, 'Deselect probe', 'Deselect probe today')

  await page.goto('/today')
  await expect(
    page.locator('[id^="task-"]').filter({ hasText: 'Deselect probe' }).first(),
  ).toBeVisible()

  // Focus the first row (j), then click the empty left gutter of <main>: the content is a
  // centered 800px column, so the gutter is bare scroll-container background — not a row,
  // control, or popover.
  await page.keyboard.press('j')
  await expect(page.locator(SEL.focusedRow)).toBeVisible()
  await page.locator('#main').click({ position: { x: 8, y: 160 } })
  await expect(page.locator(SEL.focusedRow)).toHaveCount(0)
})

test('the 6-dot drag handle reorders two rows and the order persists via the API', async ({
  page,
}) => {
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  await seedIfAbsent(page, 'Dragzeta alpha', 'Dragzeta alpha today')
  await seedIfAbsent(page, 'Dragzeta bravo', 'Dragzeta bravo today')

  // Upcoming's today section is a manual (day_order) sortable list with the drag handle.
  await page.goto('/upcoming')
  const alpha = page.locator('[id^="task-"]').filter({ hasText: 'Dragzeta alpha' }).first()
  const bravo = page.locator('[id^="task-"]').filter({ hasText: 'Dragzeta bravo' }).first()
  await expect(alpha).toBeVisible()
  await expect(bravo).toBeVisible()

  // Fresh tasks all carry day_order 0 and byDayOrder tie-breaks by random id, so which of the
  // two starts on top is a coin flip. Dragging DOWN (top row onto the bottom one) is the only
  // orientation closestCenter resolves deterministically, so pick the pair by measured position:
  // drag the top row's grip onto the bottom row → they swap.
  const alphaStartsTop = (await rowTop(alpha)) < (await rowTop(bravo))
  const [topText, bottomText] = alphaStartsTop
    ? (['Dragzeta alpha', 'Dragzeta bravo'] as const)
    : (['Dragzeta bravo', 'Dragzeta alpha'] as const)
  const topRow = alphaStartsTop ? alpha : bravo
  const bottomRow = alphaStartsTop ? bravo : alpha

  const grip = topRow.getByRole('button', { name: 'Reorder task' })
  const from = await grip.boundingBox()
  const dest = await bottomRow.boundingBox()
  if (from === null || dest === null) throw new Error('missing bounding boxes for drag')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, from.y + 12, { steps: 4 })
  await page.mouse.move(dest.x + dest.width / 2, dest.y + dest.height * 0.75, { steps: 12 })
  // The same-day reorder writes day_order back through PATCH /tasks/{id}; wait for the first
  // write to land, then poll SERVER truth below (the reorder patches every shifted row in the
  // day, so a single response is necessary but not sufficient for the reload to read the swap).
  const persisted = page.waitForResponse(
    (r) => /\/tasks\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH',
  )
  await page.mouse.up()
  await persisted

  // The optimistic cache swaps the rows immediately…
  await expect.poll(async () => (await rowTop(bottomRow)) < (await rowTop(topRow))).toBe(true)

  // …and the API confirms the persisted day_order ranks the former bottom row strictly first
  // (a tie means a sibling silent PATCH is still in flight — keep polling until it lands).
  await expect
    .poll(async () => {
      const rows: Array<{ content: string; day_order: number }> = []
      let cursor: string | null = null
      do {
        const res = await page.request.get(
          `/api/v1/tasks${cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`}`,
        )
        expect(res.ok(), 'list tasks').toBeTruthy()
        const body = (await res.json()) as {
          results: Array<{ content: string; day_order: number }>
          next_cursor: string | null
        }
        rows.push(...body.results)
        cursor = body.next_cursor
      } while (cursor !== null)
      const topOrder = rows.find((t) => t.content.includes(topText))?.day_order
      const bottomOrder = rows.find((t) => t.content.includes(bottomText))?.day_order
      return topOrder !== undefined && bottomOrder !== undefined && bottomOrder < topOrder
    })
    .toBe(true)

  // Reload from the server: the new order came from the persisted day_order, not local cache.
  await page.reload()
  const top2 = page.locator('[id^="task-"]').filter({ hasText: topText }).first()
  const bottom2 = page.locator('[id^="task-"]').filter({ hasText: bottomText }).first()
  await expect(top2).toBeVisible()
  await expect(bottom2).toBeVisible()
  await expect.poll(async () => (await rowTop(bottom2)) < (await rowTop(top2))).toBe(true)
})
