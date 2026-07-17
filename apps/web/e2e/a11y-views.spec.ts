import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'

/**
 * Task E — accessibility of the Project, Label, Filter, and Reporting surfaces.
 *
 * Every seeded view must carry zero serious/critical structural axe violations in BOTH the light
 * Kale and dark themes, `color-contrast` included (Task O landed the token/primitive fixes
 * Task E had deferred — see `axeStructural`). axe is scoped to the `<main>`
 * content region (`include: 'main'`) so these assertions cover Task E's surfaces without coupling
 * to the app chrome (sidebar / topbar are Task D's, exercised by a11y-core.spec.ts). Fixtures are
 * created through the real API with the authenticated session; `page.goto` performs a full reload
 * so every view mounts against fresh react-query caches that include the just-created entities.
 *
 * Dark mode is toggled by stamping `data-theme="dark"` on <html> (the same attribute
 * lib/theme.ts writes for the explicit Dark theme) — it re-computes every design token, so axe
 * re-evaluates the dark surface under the full rule set.
 */

interface Created {
  id: string
}

async function createProject(page: Page, name: string, color = 'blue'): Promise<string> {
  const res = await page.request.post('/api/v1/projects', { data: { name, color } })
  expect(res.ok(), `create project ${name}`).toBeTruthy()
  return ((await res.json()) as Created).id
}

/**
 * axe gate for Task E's surfaces — every WCAG 2.x A/AA rule scoped to `<main>`, run in light
 * Kale then dark, `color-contrast` INCLUDED.
 *
 * Task E originally deferred `color-contrast` here because it surfaced three shortfalls that
 * lived in cross-owned files (design tokens + shared primitives, not these views). Task O
 * landed all three, so the rule is enforced again per Task E's handoff note:
 *   1. tokens.css — dark `--od-text-tertiary` lifted #808080 → #a0a0a0 (≥4.62:1 on every
 *      dark scan surface).
 *   2. components/task/task-meta.tsx — label chips now mix the palette color 65/35 toward
 *      `--od-text-primary`, so every palette clears the AA 4.5:1 floor as 12px text in both
 *      themes (worst light case: grey 4.53:1 on --od-hover).
 *   3. Reporting inactive tabs/select values recompute ≥5.4:1 against the final tokens.css.
 * CSS transitions are killed before scanning: the `data-theme` flip crossfades colors for up
 * to 300ms (`transition-colors`), and axe must never read mid-interpolation values.
 */
async function axeStructural(page: Page): Promise<void> {
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none !important}' })
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((t) => {
      if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark')
      else document.documentElement.removeAttribute('data-theme')
    }, theme)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .include('main')
      .analyze()
    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    )
    expect(
      blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
      `${theme}-theme structural axe`,
    ).toEqual([])
  }
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
}

test('project view: an empty project announces a role=status empty state and is axe-clean', async ({
  page,
}) => {
  const projectId = await createProject(page, `E Empty ${Date.now()}`, 'grey')

  await page.goto(`/project/${projectId}`)
  // The empty-state block (feedback/EmptyState) is a role=status region carrying the frozen copy.
  const emptyState = page.getByRole('status').filter({ hasText: 'No tasks in' })
  await expect(emptyState).toBeVisible()

  await axeStructural(page)
})

test('project view: sections + a subtask are axe-clean, with headed sections and named collapse buttons', async ({
  page,
}) => {
  const projectId = await createProject(page, `E Proj ${Date.now()}`, 'blue')

  const sectionRes = await page.request.post('/api/v1/sections', {
    data: { project_id: projectId, name: 'E Section' },
  })
  expect(sectionRes.ok()).toBeTruthy()
  const sectionId = ((await sectionRes.json()) as Created).id

  const parentRes = await page.request.post('/api/v1/tasks', {
    data: { content: 'E parent task', project_id: projectId, section_id: sectionId },
  })
  expect(parentRes.ok()).toBeTruthy()
  const parentId = ((await parentRes.json()) as Created).id

  const childRes = await page.request.post('/api/v1/tasks', {
    data: { content: 'E child task', project_id: projectId, parent_id: parentId },
  })
  expect(childRes.ok()).toBeTruthy()

  const rootRes = await page.request.post('/api/v1/tasks', {
    data: { content: 'E root task', project_id: projectId },
  })
  expect(rootRes.ok()).toBeTruthy()

  await page.goto(`/project/${projectId}`)
  await expect(page.getByText('E parent task')).toBeVisible()

  // The section name is a real heading (visually hidden — the visible title is a rename button).
  await expect(page.getByRole('heading', { name: 'E Section' })).toBeAttached()
  // The collapse control names the section it toggles.
  await expect(page.getByRole('button', { name: 'Collapse section E Section' })).toBeVisible()

  await axeStructural(page)
})

test('label view lists labelled tasks and is axe-clean', async ({ page }) => {
  const labelName = `elabel${Date.now()}`
  const labelRes = await page.request.post('/api/v1/labels', {
    data: { name: labelName, color: 'teal' },
  })
  expect(labelRes.ok()).toBeTruthy()
  const labelId = ((await labelRes.json()) as Created).id

  const taskRes = await page.request.post('/api/v1/tasks', {
    data: { content: 'E labelled task', labels: [labelName] },
  })
  expect(taskRes.ok()).toBeTruthy()

  await page.goto(`/label/${labelId}`)
  await expect(page.getByRole('heading', { name: labelName, exact: true })).toBeVisible()
  await expect(page.getByText('E labelled task')).toBeVisible()

  await axeStructural(page)
})

test('label view: an unused label shows a role=status empty state and is axe-clean', async ({
  page,
}) => {
  const labelName = `eempty${Date.now()}`
  const labelRes = await page.request.post('/api/v1/labels', {
    data: { name: labelName, color: 'grey' },
  })
  expect(labelRes.ok()).toBeTruthy()
  const labelId = ((await labelRes.json()) as Created).id

  await page.goto(`/label/${labelId}`)
  const emptyState = page.getByRole('status').filter({ hasText: `No tasks with @${labelName}` })
  await expect(emptyState).toBeVisible()

  await axeStructural(page)
})

test('two-pane filter view: each pane is a labelled region and axe-clean', async ({ page }) => {
  const filterRes = await page.request.post('/api/v1/filters', {
    data: { name: `E Filter ${Date.now()}`, query: '#Work, @errands', color: 'grey' },
  })
  expect(filterRes.ok()).toBeTruthy()
  const filterId = ((await filterRes.json()) as Created).id

  await page.goto(`/filter/${filterId}`)
  await expect(page.getByRole('heading', { name: /^E Filter/ })).toBeVisible()

  // Each comma-separated pane is exposed as a region whose accessible name is its sub-query.
  await expect(page.getByRole('region', { name: '#Work' })).toBeVisible()
  await expect(page.getByRole('region', { name: '@errands' })).toBeVisible()
  // Both panes are empty here → the ListFilter empty state renders inside a region.
  await expect(
    page.getByRole('status').filter({ hasText: 'No tasks match this filter' }).first(),
  ).toBeVisible()

  await axeStructural(page)
})

test('reporting: activity, completed, and goals tabs are axe-clean (light + dark)', async ({
  page,
}) => {
  // Seed one completed task so the Activity + Completed feeds have day-grouped content.
  const tag = `erpt-${Date.now()}`
  const taskRes = await page.request.post('/api/v1/tasks', {
    data: { content: `E reporting ${tag}` },
  })
  expect(taskRes.ok()).toBeTruthy()
  const taskId = ((await taskRes.json()) as Created).id
  const closeRes = await page.request.post(`/api/v1/tasks/${taskId}/close`, { data: {} })
  expect(closeRes.ok()).toBeTruthy()

  await page.goto('/reporting')
  await expect(page.getByRole('heading', { name: 'Reporting', exact: true })).toBeVisible()
  // Activity tab (default): day-group headings are real headings, rows carry accessible names.
  await expect(
    page.getByRole('listitem', { name: `You completed a task: E reporting ${tag}` }),
  ).toBeVisible()
  await axeStructural(page)

  // Completed tab: line-through rows + a named uncomplete control.
  await page.getByRole('tab', { name: 'Completed' }).click()
  await expect(
    page.getByRole('button', { name: `Uncomplete task: E reporting ${tag}` }),
  ).toBeVisible()
  await axeStructural(page)

  // Goals tab: the completion charts expose a text alternative (role=img + aria-label).
  await page.getByRole('tab', { name: 'Goals' }).click()
  await expect(page.getByRole('img', { name: /Tasks completed per day/ })).toBeVisible()
  await axeStructural(page)
})
