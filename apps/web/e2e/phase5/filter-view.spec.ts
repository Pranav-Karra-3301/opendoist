import { expect, test } from '@playwright/test'
import { quickAdd } from '../helpers'

/**
 * Task G — filter & label views.
 *
 * A comma-separated filter query renders one list per pane, side by side, each showing only the
 * tasks matching its sub-query. Fixtures are seeded via the real Quick Add UI (dateless Inbox
 * task) and the API (a task in a non-Inbox project — avoids #-autocomplete flakiness); the filter
 * itself is created via the API because the filter dialog is a sibling task. `data-testid`
 * "filter-pane" marks each rendered pane.
 */
test('filter view splits a comma query into side-by-side panes', async ({ page }) => {
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()

  // Pane-1 fixture: a dateless task in the default Inbox project.
  await quickAdd(page, 'G pane inbox task')

  // Pane-2 fixture: a task in a fresh non-Inbox project.
  const projectRes = await page.request.post('/api/v1/projects', {
    data: { name: `G Pane Project ${Date.now()}`, color: 'grey' },
  })
  expect(projectRes.ok()).toBeTruthy()
  const project = (await projectRes.json()) as { id: string }
  const taskRes = await page.request.post('/api/v1/tasks', {
    data: { content: 'G pane other task', project_id: project.id },
  })
  expect(taskRes.ok()).toBeTruthy()

  const filterRes = await page.request.post('/api/v1/filters', {
    data: { name: 'G Panes', query: '#Inbox & no date, view all & !#Inbox', color: 'grey' },
  })
  expect(filterRes.ok()).toBeTruthy()
  const filter = (await filterRes.json()) as { id: string }

  await page.goto(`/filter/${filter.id}`)
  await expect(page.getByRole('heading', { name: 'G Panes', exact: true })).toBeVisible()

  const panes = page.getByTestId('filter-pane')
  await expect(panes).toHaveCount(2)

  // Pane 1 = "#Inbox & no date": the inbox task only.
  await expect(panes.nth(0).getByText('G pane inbox task')).toBeVisible()
  await expect(panes.nth(0).getByText('G pane other task')).toHaveCount(0)

  // Pane 2 = "view all & !#Inbox": the other-project task only.
  await expect(panes.nth(1).getByText('G pane other task')).toBeVisible()
  await expect(panes.nth(1).getByText('G pane inbox task')).toHaveCount(0)
})

/** The id-keyed label view lists every active task carrying the label (by name). */
test('label view lists tasks carrying the label', async ({ page }) => {
  const labelName = `gtag${Date.now()}`
  const labelRes = await page.request.post('/api/v1/labels', {
    data: { name: labelName, color: 'teal' },
  })
  expect(labelRes.ok()).toBeTruthy()
  const label = (await labelRes.json()) as { id: string }

  const taskRes = await page.request.post('/api/v1/tasks', {
    data: { content: 'G labelled task', labels: [labelName] },
  })
  expect(taskRes.ok()).toBeTruthy()

  await page.goto(`/label/${label.id}`)
  await expect(page.getByRole('heading', { name: labelName, exact: true })).toBeVisible()
  await expect(page.getByTestId('filter-pane').getByText('G labelled task')).toBeVisible()
})
