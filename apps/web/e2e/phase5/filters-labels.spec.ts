import { expect, test } from '@playwright/test'
import { SEL } from '../helpers'

/**
 * Filters & Labels page (Task D). Covers the behaviours this task owns end-to-end: favorite
 * star (optimistic + persisted), inline drag-reorder (persisted), delete → confirm → undo
 * restore, and that the Add buttons open the create dialogs (Task E owns the dialog bodies, so
 * this only asserts a dialog appears — the full create/rename-in-dialog flow is Task E's spec).
 *
 * State is seeded through the authenticated API (page.request shares the storageState cookie)
 * so the assertions don't depend on Task E's dialog markup. Names carry a per-run tag to avoid
 * colliding with rows other phase-5 specs create in the shared dev DB.
 */

const tag = () => Math.random().toString(36).slice(2, 8)

async function seedFilter(
  request: import('@playwright/test').APIRequestContext,
  name: string,
  query: string,
  color = 'blue',
): Promise<void> {
  const res = await request.post('/api/v1/filters', {
    data: { name, query, color, is_favorite: false },
  })
  expect(res.ok(), `seed filter ${name}`).toBeTruthy()
}

async function openList(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/filters-labels')
  await expect(page.getByRole('heading', { name: 'Filters & Labels' })).toBeVisible()
}

function row(page: import('@playwright/test').Page, name: string) {
  return page.getByRole('listitem').filter({ hasText: name })
}

test('favorite star toggles optimistically and persists across reload', async ({ page }) => {
  const name = `flt-fav-${tag()}`
  await seedFilter(page.request, name, 'today | overdue')
  await openList(page)

  const target = row(page, name)
  await expect(target).toBeVisible()
  await target.hover()
  const star = target.getByRole('button', { name: /favorites$/ })
  await expect(star).toHaveAttribute('aria-pressed', 'false')
  await star.click()
  await expect(star).toHaveAttribute('aria-pressed', 'true')

  await openList(page)
  const persisted = row(page, name).getByRole('button', { name: /favorites$/ })
  await expect(persisted).toHaveAttribute('aria-pressed', 'true')
})

test('delete a filter behind a confirm, then undo restores it', async ({ page }) => {
  const name = `flt-del-${tag()}`
  await seedFilter(page.request, name, 'no date')
  await openList(page)

  const target = row(page, name)
  await expect(target).toBeVisible()
  await target.hover()
  await target.getByRole('button', { name: `More actions for ${name}` }).click()
  await page.getByRole('menuitem', { name: 'Delete filter' }).click()

  // Confirmation dialog, then the row leaves the list + an undo toast appears.
  await expect(page.getByRole('heading', { name: 'Delete filter?' })).toBeVisible()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(row(page, name)).toHaveCount(0)
  await expect(page.getByText('Filter deleted')).toBeVisible()

  // Undo re-creates the filter (fresh id; the name is preserved).
  await page.getByRole('button', { name: SEL.undo }).click()
  await expect(row(page, name)).toBeVisible()
})

test('drag-reorder persists across reload', async ({ page }) => {
  const t = tag()
  const [a, b, c] = [`flt-a-${t}`, `flt-b-${t}`, `flt-c-${t}`]
  await seedFilter(page.request, a, 'today')
  await seedFilter(page.request, b, 'overdue')
  await seedFilter(page.request, c, '#Inbox')
  await openList(page)

  const list = page.getByRole('list').filter({ hasText: a })
  const indexOf = async (name: string): Promise<number> => {
    const items = await list.getByRole('listitem').allInnerTexts()
    return items.findIndex((text) => text.includes(name))
  }
  // Seeded newest-last by item_order → a, b, c in order.
  expect(await indexOf(a)).toBeLessThan(await indexOf(c))

  // Drag a's grip past c (dnd-kit is pointer-driven — manual mouse steps past the 4px threshold).
  const source = row(page, a)
  await source.hover()
  const grip = source.getByRole('button', { name: `Reorder ${a}` })
  const from = await grip.boundingBox()
  const dest = await row(page, c).boundingBox()
  if (!from || !dest) throw new Error('missing bounding boxes for drag')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, from.y + 12, { steps: 4 })
  await page.mouse.move(dest.x + dest.width / 2, dest.y + dest.height + 8, { steps: 12 })
  await page.mouse.up()

  await expect(async () => {
    expect(await indexOf(a)).toBeGreaterThan(await indexOf(c))
  }).toPass()

  await openList(page)
  expect(await indexOf(a)).toBeGreaterThan(await indexOf(c))
})

test('Add buttons open the create dialogs', async ({ page }) => {
  await openList(page)
  await page.getByRole('button', { name: 'Add filter' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()

  await page.getByRole('button', { name: 'Add label' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})
