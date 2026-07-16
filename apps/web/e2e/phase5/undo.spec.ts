import { expect, test } from '@playwright/test'
import { quickAdd, SEL } from '../helpers'

/**
 * Phase-5 undo coverage (plan Task W) driven through the single-slot UndoHost. Reschedule is the
 * clearest task-level phase-5 undo: it exercises the migrated `update` mutation → `useUndoStore`
 * → UndoHost, plus the "Rescheduled to {date}" message and the full-previous-due restore.
 *
 * Complete-undo and delete-undo already run through this same host — see e2e/complete-undo.spec.ts
 * (its "Task completed" / "Task deleted" toasts + Undo button now render via UndoHost). Move and
 * section-delete undos are exercised by the integration checklist once their UIs are wired.
 */
test('reschedule a task tomorrow, undo restores today', async ({ page }) => {
  await page.goto('/today')
  // Wait for the authed layout (binds hotkeys + mounts UndoHost) before quickAdd's `q`.
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  // NB: fixture wording must avoid Quick Add date/recurrence tokens — the original
  // "Review QUARTERLY budget" fixture had `quarterly` parsed as an every-3-months
  // recurrence by the core engine, landing the task in October (Task X gate fix).
  await quickAdd(page, 'Review the annual budget today')
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()

  const row = page.locator(SEL.taskRow).filter({ hasText: 'Review the annual budget' })
  await expect(row).toBeVisible()

  // Row hover → Schedule action → "Tomorrow" preset. The task leaves Today (its due is no longer
  // today) and a single "Rescheduled to Tomorrow" undo toast appears.
  await row.hover()
  await row.getByRole('button', { name: 'Schedule' }).click()
  await page.getByRole('button', { name: /Tomorrow/ }).click()
  await expect(page.getByText('Review the annual budget')).toHaveCount(0)
  await expect(page.getByText('Rescheduled to Tomorrow')).toBeVisible()

  // Undo → the previous due (today) is restored and the row returns to Today.
  await page.getByRole('button', { name: SEL.undo }).click()
  await expect(page.getByText('Review the annual budget')).toBeVisible()
})
