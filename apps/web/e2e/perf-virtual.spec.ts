import { expect, test } from '@playwright/test'
import { SEL } from './helpers'

/**
 * Task I — task-list virtualization.
 *
 * A project with 1,200 tasks must render only a windowed subset of rows (not 1,200 DOM nodes),
 * stay scrollable to the very last task, and keep j/k focus navigation working — which, past the
 * virtualization threshold, relies on the list pulling off-window rows into view on focus change.
 *
 * Fixtures are created through the authenticated API (`page.request` carries the storage-state
 * cookie), batched with bounded concurrency so 1,200 inserts don't open 1,200 sockets at once.
 */
test('a 1,200-task project virtualizes its rows yet stays fully navigable', async ({ page }) => {
  test.setTimeout(180_000)

  const projectRes = await page.request.post('/api/v1/projects', {
    data: { name: `Perf ${Date.now()}`, color: 'grey' },
  })
  expect(projectRes.ok()).toBeTruthy()
  const project = (await projectRes.json()) as { id: string }

  const TOTAL = 1200
  const BATCH = 50
  for (let start = 0; start < TOTAL; start += BATCH) {
    const batch = []
    for (let i = start; i < Math.min(start + BATCH, TOTAL); i += 1) {
      batch.push(
        page.request.post('/api/v1/tasks', {
          data: { content: `Perf task ${String(i).padStart(4, '0')}`, project_id: project.id },
        }),
      )
    }
    const results = await Promise.all(batch)
    for (const res of results) expect(res.ok()).toBeTruthy()
  }

  await page.goto(`/project/${project.id}`)
  // The list has mounted once the first row is on screen.
  await expect(page.locator(SEL.taskRow).first()).toBeVisible()

  // Virtualized: only a window of the 1,200 rows is in the DOM (visible span + overscan), far
  // fewer than a full render would produce.
  await expect
    .poll(async () => page.locator(SEL.taskRow).count(), { timeout: 15_000 })
    .toBeLessThan(200)

  // j/k still move the focus cursor across the (virtualized) list.
  await page.keyboard.press('j')
  await expect(page.locator(SEL.focusedRow)).toHaveCount(1)
  const firstFocused = await page.locator(SEL.focusedRow).getAttribute('id')
  expect(firstFocused).toBeTruthy()
  await page.keyboard.press('j')
  await page.keyboard.press('j')
  const laterFocused = await page.locator(SEL.focusedRow).getAttribute('id')
  expect(laterFocused).not.toBe(firstFocused)

  // Scrolling to the bottom renders the tail of the window — the very last task becomes visible.
  await page.locator('main').evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect(page.getByText('Perf task 1199', { exact: true })).toBeVisible()
})
