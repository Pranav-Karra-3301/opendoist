import { expect, test } from '@playwright/test'
import { SEL } from '../helpers'

/**
 * Phase-5 undo coverage (plan Task W) driven through the single-slot UndoHost. Reschedule is the
 * clearest task-level phase-5 undo: it exercises the migrated `update` mutation → `useUndoStore`
 * → UndoHost, plus the "Rescheduled to {date}" message and the full-previous-due restore.
 *
 * Complete-undo and delete-undo already run through this same host — see e2e/complete-undo.spec.ts
 * (its "Task completed" / "Task deleted" toasts + Undo button now render via UndoHost). The move
 * test below covers the inverse-move restore, ORIGINAL child_order included (spec §2.4 exact-prior-
 * state; regression for the move-appends-on-undo bug).
 */
test('reschedule a task tomorrow, undo restores today with the due string verbatim', async ({
  page,
}) => {
  // Seed via the authed API — the returned id lets the final assertion read server truth,
  // and the per-run tag keeps row locators unique across the shared DB and retries.
  const tag = `rsu${Date.now().toString(36)}`
  const createRes = await page.request.post('/api/v1/tasks', {
    data: { content: `Review the annual budget ${tag}`, due: { string: 'today' } },
  })
  expect(createRes.ok()).toBeTruthy()
  const created = (await createRes.json()) as {
    id: string
    due: { date: string; string: string } | null
  }
  expect(created.due?.string).toBe('today')

  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  const row = page.locator(SEL.taskRow).filter({ hasText: tag })
  await expect(row).toBeVisible()

  // Row hover → Schedule action → "Tomorrow" preset. The task leaves Today (its due is no longer
  // today) and a single "Rescheduled to Tomorrow" undo toast appears.
  await row.hover()
  await row.getByRole('button', { name: 'Schedule' }).click()
  await page.getByRole('button', { name: /Tomorrow/ }).click()
  await expect(page.getByText(tag)).toHaveCount(0)
  await expect(page.getByText('Rescheduled to Tomorrow')).toBeVisible()

  // Undo → the previous due (today) is restored and the row returns to Today.
  await page.getByRole('button', { name: SEL.undo }).click()
  await expect(page.getByText(tag)).toBeVisible()

  // The restore is EXACT on the server: original date AND the natural-language phrase kept
  // verbatim (regression: undo used to normalize due.string to the ISO date).
  const afterRes = await page.request.get(`/api/v1/tasks/${created.id}`)
  expect(afterRes.ok()).toBeTruthy()
  const after = (await afterRes.json()) as {
    due: { date: string; time: string | null; string: string; is_recurring: boolean } | null
  }
  expect(after.due?.date).toBe(created.due?.date)
  expect(after.due?.string).toBe('today')
  expect(after.due?.is_recurring).toBe(false)
})

test('move a task to another project, undo restores its original position', async ({ page }) => {
  const tag = `mvu-${Date.now()}`
  const destName = `MoveUndoDest ${Date.now()}`

  // Destination project + three Inbox siblings seeded through the authed API (page.request
  // shares the storage-state session). Sequential creates append, so the tagged rows sit in
  // creation order at the end of the Inbox list with consecutive child_orders.
  const projectRes = await page.request.post('/api/v1/projects', {
    data: { name: destName, color: 'grey' },
  })
  expect(projectRes.ok()).toBeTruthy()
  const ids: string[] = []
  for (const name of ['first', 'second', 'third']) {
    const res = await page.request.post('/api/v1/tasks', { data: { content: `${tag} ${name}` } })
    expect(res.ok()).toBeTruthy()
    ids.push(((await res.json()) as { id: string }).id)
  }

  await page.goto('/inbox')
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
  const rows = page.locator(SEL.taskRow).filter({ hasText: tag })
  await expect(rows).toHaveCount(3)
  await expect(rows).toHaveText([/first/, /second/, /third/])

  // Focus the MIDDLE sibling with j (bounded walk — the shared DB may hold earlier rows),
  // then `v` opens the Move panel; search narrows it to the destination project.
  const middleRow = page.locator(`[id="task-${ids[1]}"]`)
  for (let i = 0; i < 60; i++) {
    if ((await middleRow.getAttribute('data-focused')) !== null) break
    await page.keyboard.press('j')
  }
  await expect(middleRow).toHaveAttribute('data-focused', 'true')
  await page.keyboard.press('v')
  const search = page.getByRole('textbox', { name: 'Search projects' })
  await expect(search).toBeVisible()
  await search.fill(destName)
  await page.getByRole('button', { name: destName }).click()

  // The row leaves the Inbox and a single "Moved to {project}" undo toast appears.
  await expect(rows).toHaveCount(2)
  await expect(page.getByText(`Moved to ${destName}`)).toBeVisible()

  // Undo → the task returns to the Inbox at its ORIGINAL position (child_order restored,
  // not appended at the end of the sibling list).
  await page.getByRole('button', { name: SEL.undo }).click()
  await expect(rows).toHaveCount(3)
  await expect(rows).toHaveText([/first/, /second/, /third/])

  // Reload to assert the SERVER-persisted order — the optimistic cache already shows the
  // restored position, so only a fresh fetch proves the inverse move stored child_order.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
  await expect(rows).toHaveCount(3)
  await expect(rows).toHaveText([/first/, /second/, /third/])
})
