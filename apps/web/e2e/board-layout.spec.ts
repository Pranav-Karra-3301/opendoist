import AxeBuilder from '@axe-core/playwright'
import { expect, type Locator, type Page, test } from '@playwright/test'

/**
 * Board View pass — Task D e2e.
 *
 * The board is a SECOND renderer over the same grouped slices the list computes; these specs prove
 * the seams that only surface in a real browser: the Display-menu layout toggle (persisted per view),
 * the per-view column model (§Reference column chrome), the drop→mutation wiring, and the header/tile
 * actions (add-task / add-section / rename / delete / reschedule). Every drag/reschedule assertion is
 * DETERMINISTIC — it waits on the real PATCH/POST the mutation fires (the board has no keyboard sensor,
 * so we never rely on the load-flaky mouse-drag-without-sync pattern) and then re-reads server state.
 *
 * Fixtures are created through the authenticated API with unique markers so a Playwright retry
 * (config `retries: 1`) re-runs a whole test cleanly, and sibling specs never collide with these rows.
 * `layout` is flipped straight through `PATCH /user/settings` (per-key viewPrefs REPLACE) so each test
 * lands on the board without threading the UI toggle it isn't exercising.
 */

/** The full ViewPrefs object a board view stores (per-key REPLACE — send every field). */
const BOARD_PREFS = {
  layout: 'board',
  groupBy: 'none',
  sortBy: 'manual',
  sortDir: 'asc',
  filterBy: { priority: null, label: null, due: null },
  showCompleted: false,
} as const
const LIST_PREFS = { ...BOARD_PREFS, layout: 'list' } as const

interface Created {
  id: string
}
interface TaskRow {
  id: string
  content: string
  section_id: string | null
  due: { date: string | null } | null
}

async function setLayout(page: Page, key: string, prefs: object): Promise<void> {
  const res = await page.request.patch('/api/v1/user/settings', {
    data: { viewPrefs: { [key]: prefs } },
  })
  expect(res.ok(), `set layout for ${key}`).toBeTruthy()
}

async function createProject(page: Page, name: string): Promise<string> {
  const res = await page.request.post('/api/v1/projects', { data: { name, color: 'blue' } })
  expect(res.ok(), `create project ${name}`).toBeTruthy()
  return ((await res.json()) as Created).id
}

async function createSection(page: Page, projectId: string, name: string): Promise<string> {
  const res = await page.request.post('/api/v1/sections', {
    data: { project_id: projectId, name },
  })
  expect(res.ok(), `create section ${name}`).toBeTruthy()
  return ((await res.json()) as Created).id
}

async function createTask(page: Page, data: Record<string, unknown>): Promise<string> {
  const res = await page.request.post('/api/v1/tasks', { data })
  expect(res.ok(), `create task ${JSON.stringify(data)}`).toBeTruthy()
  return ((await res.json()) as Created).id
}

async function closeTask(page: Page, id: string): Promise<void> {
  const res = await page.request.post(`/api/v1/tasks/${id}/close`)
  expect(res.ok(), `close task ${id}`).toBeTruthy()
}

/** Remove a fixture that is visible OUTSIDE this spec's own project (e.g. tasks due today, which
 *  land in the shared Today/Upcoming slices later specs drag around in). */
async function deleteTask(page: Page, id: string): Promise<void> {
  const res = await page.request.delete(`/api/v1/tasks/${id}`)
  expect(res.ok(), `delete task ${id}`).toBeTruthy()
}

/**
 * Read active tasks for post-mutation server-truth assertions. `GET /tasks` is the cursor-paginated
 * `{ results, next_cursor }` envelope, so we follow the cursor; an optional `projectId` scopes it.
 */
async function fetchTasks(page: Page, projectId?: string): Promise<TaskRow[]> {
  const out: TaskRow[] = []
  let cursor: string | null = null
  do {
    const params = new URLSearchParams()
    if (projectId !== undefined) params.set('project_id', projectId)
    if (cursor !== null) params.set('cursor', cursor)
    const res = await page.request.get(`/api/v1/tasks?${params.toString()}`)
    expect(res.ok(), 'list tasks').toBeTruthy()
    const page_ = (await res.json()) as { results: TaskRow[]; next_cursor: string | null }
    out.push(...page_.results)
    cursor = page_.next_cursor
  } while (cursor !== null)
  return out
}

/** A board column is a labelled `<section>` → an ARIA region named by its header. */
function column(page: Page, name: string): Locator {
  return page.getByRole('region', { name })
}

/** A card carries `id="task-…"`; find one by its unique content marker. */
function card(scope: Page | Locator, marker: string): Locator {
  return scope.locator('[id^="task-"]').filter({ hasText: marker }).first()
}

async function boxCenter(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('locator has no bounding box')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/**
 * Whole-card mouse drag with a PATCH/POST sync (never a fire-and-forget mouse-up). The board's pointer
 * sensor arms at 4px, so we nudge past that before travelling to the target, then await the mutation
 * the drop fires so the following reload reads persisted — not optimistic — state.
 */
async function dragCardOnto(
  page: Page,
  from: Locator,
  to: Locator,
  waitFor: RegExp,
  method: string,
) {
  const start = await boxCenter(from)
  const dest = await boxCenter(to)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x, start.y + 8, { steps: 4 })
  await page.mouse.move(dest.x, dest.y, { steps: 12 })
  const persisted = page.waitForResponse(
    (r) => waitFor.test(r.url()) && r.request().method() === method,
  )
  await page.mouse.up()
  await persisted
}

test('the Display menu switches Today to Board, and the choice persists across reload and is per-view', async ({
  page,
}) => {
  await setLayout(page, 'today', LIST_PREFS)
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  // List layout: no board rail (`role="group"` is unique to the board renderer).
  await expect(page.getByRole('group', { name: 'Today' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Display' }).click()
  // `exact` — a non-exact "Board" also matches "Keyboard shortcuts" (case-insensitive substring).
  const boardSegment = page.getByRole('button', { name: 'Board', exact: true })
  await expect(boardSegment).toHaveAttribute('aria-pressed', 'false')
  await boardSegment.click()
  await expect(boardSegment).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')

  // The board rail is now present, with the frozen Today columns.
  await expect(page.getByRole('group', { name: 'Today' })).toBeVisible()
  await expect(column(page, 'Overdue')).toBeVisible()

  // Persisted server-side: a full reload re-hydrates from settings, not local state.
  await page.reload()
  await expect(page.getByRole('group', { name: 'Today' })).toBeVisible()

  // Per-view: Today's board choice does not leak to Inbox (its own viewPrefs default stays list).
  await page.goto('/inbox')
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Inbox' })).toHaveCount(0)

  await setLayout(page, 'today', LIST_PREFS)
})

test('the project board renders one column per section in section_order, with counts, and "(No section)" only when non-empty', async ({
  page,
}) => {
  const tag = `bpj${Date.now()}`
  const projectId = await createProject(page, `Board Proj ${tag}`)
  // Sections created in order → section_order Alpha < Bravo.
  const alpha = await createSection(page, projectId, `Alpha${tag}`)
  const bravo = await createSection(page, projectId, `Bravo${tag}`)
  await createTask(page, { content: `${tag} a1`, project_id: projectId, section_id: alpha })
  await createTask(page, { content: `${tag} a2`, project_id: projectId, section_id: alpha })
  await createTask(page, { content: `${tag} b1`, project_id: projectId, section_id: bravo })
  await createTask(page, { content: `${tag} root`, project_id: projectId })
  await setLayout(page, `project:${projectId}`, BOARD_PREFS)

  await page.goto(`/project/${projectId}`)
  const noSection = column(page, '(No section)')
  const colAlpha = column(page, `Alpha${tag}`)
  const colBravo = column(page, `Bravo${tag}`)
  await expect(noSection).toBeVisible()
  await expect(colAlpha).toBeVisible()
  await expect(colBravo).toBeVisible()

  // Left-to-right order: (No section) → Alpha → Bravo (section_order).
  const xs = await Promise.all(
    [noSection, colAlpha, colBravo].map(async (c) => (await c.boundingBox())?.x ?? 0),
  )
  expect(xs[0]).toBeLessThan(xs[1] as number)
  expect(xs[1]).toBeLessThan(xs[2] as number)

  // Counts (header badge) + card totals match the list's SectionBlock counts.
  await expect(colAlpha.getByTestId('column-count')).toHaveText('2')
  await expect(colBravo.getByTestId('column-count')).toHaveText('1')
  await expect(colAlpha.locator('[id^="task-"]')).toHaveCount(2)
  await expect(colBravo.locator('[id^="task-"]')).toHaveCount(1)

  // "(No section)" is hidden on a project whose top-level tasks are all in sections.
  const projectId2 = await createProject(page, `Board Proj2 ${tag}`)
  const alpha2 = await createSection(page, projectId2, `Only${tag}`)
  await createTask(page, { content: `${tag} only1`, project_id: projectId2, section_id: alpha2 })
  await setLayout(page, `project:${projectId2}`, BOARD_PREFS)
  await page.goto(`/project/${projectId2}`)
  await expect(column(page, `Only${tag}`)).toBeVisible()
  await expect(column(page, '(No section)')).toHaveCount(0)
})

test('adding a task through a section column tile lands it in that section (API-verified)', async ({
  page,
}) => {
  const tag = `badd${Date.now()}`
  const projectId = await createProject(page, `Board Add ${tag}`)
  const sectionId = await createSection(page, projectId, `Charlie${tag}`)
  await setLayout(page, `project:${projectId}`, BOARD_PREFS)

  await page.goto(`/project/${projectId}`)
  const col = column(page, `Charlie${tag}`)
  await expect(col).toBeVisible()

  // The column's "+ Add task" tile swaps in the shared inline composer, scoped to this section.
  await col.getByRole('button', { name: 'Add task' }).click()
  const input = col.getByRole('textbox', { name: 'Quick add task' })
  await expect(input).toBeVisible()
  const title = `${tag} composed`
  await input.fill(title)
  const created = page.waitForResponse(
    (r) => /\/api\/v1\/tasks(\/quick)?$/.test(r.url()) && r.request().method() === 'POST',
  )
  await page.keyboard.press('ControlOrMeta+Enter')
  await created

  // Server truth: the new task carries the column's section_id.
  await expect
    .poll(async () => {
      const tasks = await fetchTasks(page, projectId)
      return tasks.find((t) => t.content === title)?.section_id ?? null
    })
    .toBe(sectionId)
})

test('dragging a card to another section column persists the move across a reload (API-verified)', async ({
  page,
}) => {
  const tag = `bdrag${Date.now()}`
  const projectId = await createProject(page, `Board Drag ${tag}`)
  const src = await createSection(page, projectId, `Src${tag}`)
  const dst = await createSection(page, projectId, `Dst${tag}`)
  const movingId = await createTask(page, {
    content: `${tag} mover`,
    project_id: projectId,
    section_id: src,
  })
  // An anchor card in the destination gives the drag a solid target inside that column.
  await createTask(page, { content: `${tag} anchor`, project_id: projectId, section_id: dst })
  await setLayout(page, `project:${projectId}`, BOARD_PREFS)

  await page.goto(`/project/${projectId}`)
  const mover = card(column(page, `Src${tag}`), `${tag} mover`)
  const anchor = card(column(page, `Dst${tag}`), `${tag} anchor`)
  await expect(mover).toBeVisible()
  await expect(anchor).toBeVisible()

  // Cross-section drop fires `POST /tasks/{id}/move`; wait for it before asserting.
  await dragCardOnto(page, mover, anchor, /\/tasks\/[^/]+\/move$/, 'POST')

  // Server truth: the moved task now belongs to the destination section.
  await expect
    .poll(async () => {
      const tasks = await fetchTasks(page, projectId)
      return tasks.find((t) => t.id === movingId)?.section_id ?? null
    })
    .toBe(dst)

  // And it re-renders in the destination column after a fresh reload.
  await page.reload()
  await expect(card(column(page, `Dst${tag}`), `${tag} mover`)).toBeVisible()
})

test('the Today board shows Overdue + "· Today" columns, suppresses the redundant Today chip, and Reschedule empties Overdue into Today', async ({
  page,
}) => {
  const tag = `btoday${Date.now()}`
  // A deep-past due date is overdue in every timezone; the "today" card is created with `due.string:
  // 'today'` so the server resolves it against the USER's timezone (not a hardcoded ISO date).
  await createTask(page, { content: `${tag} late`, due: { date: '2020-01-01' } })
  await createTask(page, { content: `${tag} ontime`, due: { string: 'today' } })
  await setLayout(page, 'today', BOARD_PREFS)

  await page.goto('/today')
  await expect(page.getByRole('group', { name: 'Today' })).toBeVisible()
  const overdueCol = column(page, 'Overdue')
  const todayCol = page.getByRole('region', { name: /· Today$/ })
  await expect(overdueCol).toBeVisible()
  await expect(todayCol).toBeVisible()

  // The today card sits in the Today column and its redundant "Today" due chip is suppressed
  // (the column header still reads "· Today"; suppression is asserted on the CARD, not the region).
  const todayCard = card(todayCol, `${tag} ontime`)
  await expect(todayCard).toBeVisible()
  await expect(todayCard.getByText('Today', { exact: true })).toHaveCount(0)

  // Overdue starts non-empty.
  await expect(overdueCol.locator('[id^="task-"]')).toHaveCount(1)

  // Reschedule → "Today" bulk-moves every overdue card to today (one silent PATCH per task).
  await overdueCol.getByRole('button', { name: 'Reschedule all overdue tasks' }).click()
  const patched = page.waitForResponse(
    (r) => /\/tasks\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH',
  )
  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await patched

  // Overdue is now empty; the rescheduled card joined Today.
  await expect(overdueCol.locator('[id^="task-"]')).toHaveCount(0)
  await expect(card(page.getByRole('region', { name: /· Today$/ }), `${tag} late`)).toBeVisible()

  await setLayout(page, 'today', LIST_PREFS)
})

test('the Add section tile creates a live column, and the section menu renames and deletes (with confirm)', async ({
  page,
}) => {
  const tag = `bsec${Date.now()}`
  const projectId = await createProject(page, `Board Sec ${tag}`)
  await setLayout(page, `project:${projectId}`, BOARD_PREFS)
  await page.goto(`/project/${projectId}`)
  await expect(page.getByRole('group')).toBeVisible()

  // Add-section tile (scoped to the board rail — the project header carries the same-named button).
  const rail = page.getByRole('group')
  await rail.getByRole('button', { name: 'Add section' }).click()
  const nameInput = page.getByRole('textbox', { name: 'Section name' })
  await nameInput.fill(`Delta${tag}`)
  const sectionCreated = page.waitForResponse(
    (r) => /\/api\/v1\/sections$/.test(r.url()) && r.request().method() === 'POST',
  )
  await nameInput.press('Enter')
  await sectionCreated
  const delta = column(page, `Delta${tag}`)
  await expect(delta).toBeVisible()

  // Rename via the section ⋯ menu → EditableText input → PATCH /sections/{id}.
  await delta.getByRole('button', { name: 'Section actions' }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  const renameInput = page.getByRole('textbox', { name: 'Section name' })
  await renameInput.fill(`Echo${tag}`)
  const renamed = page.waitForResponse(
    (r) => /\/api\/v1\/sections\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH',
  )
  await renameInput.press('Enter')
  await renamed
  await expect(column(page, `Echo${tag}`)).toBeVisible()
  await expect(column(page, `Delta${tag}`)).toHaveCount(0)

  // Delete-with-confirm: the menu opens a confirm dialog before DELETE /sections/{id}.
  await column(page, `Echo${tag}`).getByRole('button', { name: 'Section actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete section' }).click()
  const confirm = page.getByRole('dialog')
  await expect(confirm.getByText(`Delete Echo${tag}?`)).toBeVisible()
  const deleted = page.waitForResponse(
    (r) => /\/api\/v1\/sections\/[^/]+$/.test(r.url()) && r.request().method() === 'DELETE',
  )
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
  await deleted
  await expect(column(page, `Echo${tag}`)).toHaveCount(0)
})

test('with Show completed on, a completed card renders greyed/struck at the bottom of its section column and can be reopened', async ({
  page,
}) => {
  const tag = `bdone${Date.now()}`
  const projectId = await createProject(page, `Board Done ${tag}`)
  const sectionId = await createSection(page, projectId, `Golf${tag}`)
  await createTask(page, { content: `${tag} keep`, project_id: projectId, section_id: sectionId })
  const doneId = await createTask(page, {
    content: `${tag} done`,
    project_id: projectId,
    section_id: sectionId,
  })
  await closeTask(page, doneId)
  await setLayout(page, `project:${projectId}`, { ...BOARD_PREFS, showCompleted: true })

  await page.goto(`/project/${projectId}`)
  const col = column(page, `Golf${tag}`)
  await expect(col).toBeVisible()

  // §Reference: the completed card sits greyed/struck at the BOTTOM of its column. It is not an
  // active card (no task- id, excluded from the header count) and renders below the active card.
  const struck = col.getByText(`${tag} done`)
  await expect(struck).toBeVisible()
  await expect(struck).toHaveCSS('text-decoration-line', 'line-through')
  await expect(col.locator('[id^="task-"]')).toHaveCount(1)
  await expect(col.getByTestId('column-count')).toHaveText('1')
  const activeBox = await card(col, `${tag} keep`).boundingBox()
  const struckBox = await struck.boundingBox()
  expect(struckBox?.y ?? 0).toBeGreaterThan(activeBox?.y ?? Number.POSITIVE_INFINITY)

  // Reopening from the card's checked circle fires POST /tasks/{id}/reopen and the card
  // rejoins the column as an active card (list CompletedSection parity).
  const reopened = page.waitForResponse(
    (r) => /\/tasks\/[^/]+\/reopen$/.test(r.url()) && r.request().method() === 'POST',
  )
  await col.getByRole('checkbox', { name: `Complete task: ${tag} done` }).click()
  await reopened
  await expect(col.locator('[id^="task-"]')).toHaveCount(2)
  await expect
    .poll(async () => {
      const tasks = await fetchTasks(page, projectId)
      return tasks.some((t) => t.id === doneId)
    })
    .toBe(true)
})

test('with Show completed on, the Today board shows tasks completed for today struck in the Today column (never in Overdue)', async ({
  page,
}) => {
  const tag = `bdt${Date.now()}`
  const openId = await createTask(page, { content: `${tag} open`, due: { string: 'today' } })
  const doneId = await createTask(page, { content: `${tag} done`, due: { string: 'today' } })
  await closeTask(page, doneId)
  await setLayout(page, 'today', { ...BOARD_PREFS, showCompleted: true })

  await page.goto('/today')
  const todayCol = page.getByRole('region', { name: /· Today$/ })
  await expect(todayCol).toBeVisible()
  const struck = todayCol.getByText(`${tag} done`)
  await expect(struck).toBeVisible()
  await expect(struck).toHaveCSS('text-decoration-line', 'line-through')
  // A completed task is no longer overdue — the Overdue column takes no completed cards.
  await expect(column(page, 'Overdue').getByText(`${tag} done`)).toHaveCount(0)

  await setLayout(page, 'today', LIST_PREFS)
  // These fixtures are due TODAY, so they land in the shared Today/Upcoming slices that later
  // specs (6-dot day_order drags) operate on — remove them instead of leaking suite-wide state.
  await deleteTask(page, openId)
  await deleteTask(page, doneId)
})

test('an open project board has zero serious/critical axe violations in light and dark', async ({
  page,
}) => {
  const tag = `baxe${Date.now()}`
  const projectId = await createProject(page, `Board A11y ${tag}`)
  const sectionId = await createSection(page, projectId, `Foxtrot${tag}`)
  await createTask(page, { content: `${tag} card`, project_id: projectId, section_id: sectionId })
  await createTask(page, { content: `${tag} root`, project_id: projectId })
  // Review-fix regression: the scanned board MUST contain an overdue card — its red date chip
  // (--od-date-overdue on the card's --od-surface bg) was the axe color-contrast failure the
  // original spec never exercised (it only scanned chips-without-dates boards).
  await createTask(page, {
    content: `${tag} late`,
    project_id: projectId,
    section_id: sectionId,
    due: { date: '2020-01-01' },
  })
  await setLayout(page, `project:${projectId}`, BOARD_PREFS)

  await page.goto(`/project/${projectId}`)
  await expect(column(page, `Foxtrot${tag}`)).toBeVisible()
  // The overdue chip is actually rendered before axe runs (Jan 1 2020 formats with its year).
  await expect(card(page, `${tag} late`).getByText(/Jan 1/)).toBeVisible()
  // Columns are labelled regions; cards are focusable (the title is a real <button>).
  await expect(column(page, `Foxtrot${tag}`).getByRole('region')).toHaveCount(0)
  await card(page, `${tag} card`).getByRole('button').first().focus()

  // Kill transitions so the dark-mode flip never leaves axe reading mid-crossfade colors.
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none !important}' })
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((t) => {
      if (t === 'dark') document.documentElement.setAttribute('data-mode', 'dark')
      else document.documentElement.removeAttribute('data-mode')
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
      `${theme}-theme board axe`,
    ).toEqual([])
  }
  await page.evaluate(() => document.documentElement.removeAttribute('data-mode'))
})
