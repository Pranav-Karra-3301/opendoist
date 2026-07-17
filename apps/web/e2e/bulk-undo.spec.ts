import { expect, test } from '@playwright/test'
import { SEL } from './helpers'

/**
 * Regression (phase-10 review, LOW — undo consolidation): the bulk actions used to push into
 * phase 4's parallel `stores/undo` rendered by <Toaster/>, a second undo system next to the
 * single-slot UndoHost. Both bulk callers (multi-select toolbar, overdue reschedule-all) now
 * push through features/undo/store and render via UndoHost — these tests pin that path
 * end-to-end: ONE undo toast, keyboard/UndoHost semantics, inverse op restores server truth.
 */

test('multi-select bulk complete pushes ONE undo through the single undo host', async ({
  page,
}) => {
  const tag = `blk${Date.now().toString(36)}`
  const ids: string[] = []
  for (const name of ['alpha', 'beta']) {
    const res = await page.request.post('/api/v1/tasks', { data: { content: `${tag} ${name}` } })
    expect(res.ok()).toBeTruthy()
    ids.push(((await res.json()) as { id: string }).id)
  }

  await page.goto('/inbox')
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
  const rows = page.locator(SEL.taskRow).filter({ hasText: tag })
  await expect(rows).toHaveCount(2)

  // Select both rows with the keyboard: j-walk to each (bounded — the shared DB may hold
  // earlier rows), then `x` toggles selection of the focused row.
  for (const id of ids) {
    const row = page.locator(`[id="task-${id}"]`)
    for (let i = 0; i < 80; i++) {
      if ((await row.getAttribute('data-focused')) !== null) break
      await page.keyboard.press('j')
    }
    await expect(row).toHaveAttribute('data-focused', 'true')
    await page.keyboard.press('x')
  }
  const toolbar = page.getByRole('toolbar', { name: 'Selected tasks' })
  await expect(toolbar).toBeVisible()
  await expect(toolbar.getByText('2 selected')).toBeVisible()

  // Bulk complete → both rows leave the list and a SINGLE undo toast appears via UndoHost.
  await toolbar.getByRole('button', { name: 'Complete' }).click()
  await expect(rows).toHaveCount(0)
  const undoToast = page.locator('[role="status"]').filter({ hasText: '2 tasks completed' })
  await expect(undoToast).toHaveCount(1)
  await expect(undoToast.getByRole('button', { name: SEL.undo })).toBeVisible()

  // Undo → the single entry reopens BOTH tasks.
  await undoToast.getByRole('button', { name: SEL.undo }).click()
  await expect(rows).toHaveCount(2)
})

test('overdue reschedule-all pushes ONE undo and restores the original due on undo', async ({
  page,
}) => {
  const tag = `ovd${Date.now().toString(36)}`
  const createRes = await page.request.post('/api/v1/tasks', {
    data: { content: `Water ferns ${tag}`, due: { string: 'yesterday' } },
  })
  expect(createRes.ok()).toBeTruthy()
  const created = (await createRes.json()) as { id: string; due: { date: string } | null }

  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  const overdueSection = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Overdue', exact: true }) })
  await expect(overdueSection.locator(SEL.taskRow).filter({ hasText: tag })).toBeVisible()

  // Reschedule ALL overdue tasks to Today (the shared DB may hold other overdue rows, so the
  // toast count is asserted by shape, not by exact number).
  await page.getByRole('button', { name: 'Reschedule all overdue tasks' }).click()
  // The preset row's accessible name is "Today {weekday}" (label + weekday abbreviation).
  await page.getByRole('button', { name: /^Today\b/ }).click()
  await expect(overdueSection.locator(SEL.taskRow).filter({ hasText: tag })).toHaveCount(0)
  const undoToast = page.locator('[role="status"]').filter({ hasText: /Rescheduled \d+ tasks?/ })
  await expect(undoToast).toHaveCount(1)

  // Undo → the tagged task is overdue again, and the SERVER has its original due date back.
  await undoToast.getByRole('button', { name: SEL.undo }).click()
  await expect(overdueSection.locator(SEL.taskRow).filter({ hasText: tag })).toBeVisible()
  const afterRes = await page.request.get(`/api/v1/tasks/${created.id}`)
  expect(afterRes.ok()).toBeTruthy()
  const after = (await afterRes.json()) as { due: { date: string } | null }
  expect(after.due?.date).toBe(created.due?.date)
})
