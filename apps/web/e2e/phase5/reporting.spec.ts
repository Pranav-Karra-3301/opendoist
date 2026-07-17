import { expect, test } from '@playwright/test'
import { quickAdd, SEL } from '../helpers'

/**
 * Reporting view (Task K): completing a task surfaces it in the Activity feed under a
 * "Today" day header that carries the per-day event count, the event-type filter narrows
 * the feed to the chosen types, and the Completed tab lists the task. A per-run tag keeps
 * assertions unique across the shared DB and Playwright retries.
 */
test('activity feed shows a completed task under Today, filters by type, and lists it under Completed', async ({
  page,
}) => {
  const tag = `rpt-${Date.now()}`
  const content = `Reporting ${tag}`

  // Seed a task due today and complete it → generates task_added + task_completed events.
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  await quickAdd(page, `${content} today`)

  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  const taskRow = page.locator(SEL.taskRow).filter({ hasText: content })
  await expect(taskRow).toBeVisible()
  await taskRow.getByRole('checkbox', { name: SEL.checkbox }).click()
  await expect(page.getByText(content)).toHaveCount(0)

  // Reporting → Activity tab groups both events under a "Today" header whose count
  // matches the number of rows in the day group (spec §2.5 day header with count).
  await page.goto('/reporting')
  await expect(page.getByRole('heading', { name: 'Reporting', exact: true })).toBeVisible()
  const addedRow = page.getByRole('listitem', { name: `You added a task: ${content}` })
  const completedRow = page.getByRole('listitem', { name: `You completed a task: ${content}` })
  await expect(completedRow).toBeVisible()
  await expect(addedRow).toBeVisible()
  const todayHeading = page.locator('h2', { hasText: /^Today\b/ }).first()
  await expect(todayHeading).toHaveText(/^Today · \d+$/)
  const todaySection = page.locator('section', { has: todayHeading })
  await expect(todayHeading).toHaveText(
    `Today · ${await todaySection.getByRole('listitem').count()}`,
  )

  // Filter by type "Task completed" → the added row drops out, the completed row remains,
  // and the day-header count shrinks to the narrowed row count.
  await page.getByRole('button', { name: 'Filter by event type' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Task completed', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(addedRow).toHaveCount(0)
  await expect(completedRow).toBeVisible()
  await expect(todayHeading).toHaveText(
    `Today · ${await todaySection.getByRole('listitem').count()}`,
  )

  // Completed tab lists the reopened-capable task row.
  await page.getByRole('tab', { name: 'Completed' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: content }).first()).toBeVisible()
})
