import { describe, expect, it, vi } from 'vitest'
import { fetchTodoistExport } from './todoist-api'
import { ImportPlanSchema, type ImportProgress } from './types'

const BASE = 'https://api.todoist.test/api/v1'
const TOKEN = 'test-token'

/** ---- Canonical Todoist API v1 fixture (dossier §1.9) ---------------------------------- */

// 2 projects, one is the Inbox, the other is shared (→ collaborators dropped).
const PROJECTS = [
  [{ id: 'inbox', name: 'Inbox', color: 'grey', parent_id: null, inbox_project: true }],
  [{ id: 'work', name: 'Work', color: 'blue', parent_id: null, shared: true }],
]
// 2 sections under Work.
const SECTIONS = [
  [
    { id: 'secA', name: 'Planning', project_id: 'work', section_order: 0 },
    { id: 'secB', name: 'Later', project_id: 'work', section_order: 1 },
  ],
]
// 2 labels, both lime_green.
const LABELS = [
  [
    { id: 'lblWork', name: 'work', color: 'lime_green' },
    { id: 'lblTravel', name: 'travel', color: 'lime_green' },
  ],
]
// 4 tasks split across two pages to exercise cursor pagination.
const TASKS = [
  [
    {
      id: 't1',
      project_id: 'work',
      section_id: 'secA',
      parent_id: null,
      content: 'Draft Q3 roadmap',
      description: 'Outline the big rocks',
      priority: 4, // API 4 = urgent → ours 1
      due: {
        date: '2026-08-01T09:00:00',
        string: 'every friday',
        is_recurring: true,
        timezone: null,
      },
      deadline: { date: '2026-08-15' },
      duration: { amount: 45, unit: 'minute' },
      labels: ['work'],
      child_order: 1,
      responsible_uid: null,
    },
    {
      id: 't2',
      project_id: 'work',
      section_id: null,
      parent_id: null,
      content: 'Book flights',
      priority: 3, // → ours 2
      due: { date: '2026-07-22', string: 'Jul 22', is_recurring: false },
      duration: { amount: 2, unit: 'day' }, // 2 days → 2880 → capped 1440
      labels: ['travel', 'work'],
      child_order: 5,
      responsible_uid: 'user-999', // → assignee dropped
    },
  ],
  [
    {
      id: 't3',
      project_id: 'work',
      section_id: 'secA',
      parent_id: 't1', // subtask
      content: '* Reference material',
      priority: 1, // → ours 4 (default)
      labels: [],
      child_order: 2,
    },
    {
      id: 't4',
      project_id: 'inbox',
      section_id: null,
      parent_id: null,
      content: 'Water plants',
      priority: 2, // → ours 3
      due: { date: '2026-07-18', string: 'every! 3 days', is_recurring: true },
      labels: [],
      child_order: 0,
    },
  ],
]
// Comments keyed by task_id. t1 has an attachment comment; t3 has a plain comment.
const COMMENTS: Record<string, unknown[][]> = {
  t1: [
    [
      {
        id: 'cm1',
        content: 'See the spec doc',
        posted_at: '2026-07-10T14:03:22Z',
        file_attachment: {
          file_name: 'spec.pdf',
          file_size: 1234,
          file_type: 'application/pdf',
          file_url: 'https://files.todoist.test/spec.pdf',
        },
      },
    ],
  ],
  t3: [[{ id: 'cm2', content: 'Use the office watering can', posted_at: '2026-07-11T09:00:00Z' }]],
}

interface Fixtures {
  projects: unknown[][]
  sections: unknown[][]
  labels: unknown[][]
  tasks: unknown[][]
  comments: Record<string, unknown[][]>
}

const FIXTURES: Fixtures = {
  projects: PROJECTS,
  sections: SECTIONS,
  labels: LABELS,
  tasks: TASKS,
  comments: COMMENTS,
}

interface RecordedCall {
  url: string
  init?: RequestInit
}

/**
 * A fake `fetchImpl` serving canned cursor pages keyed by resource path + `task_id`.
 * `next_cursor` encodes the next page index as `<resource>:<idx>`. Optional hooks inject a
 * one-shot 401 or a one-shot 429 (with `Retry-After`) on the first `/projects` request.
 */
function makeApi(fx: Fixtures, hooks: { on401?: boolean; on429Once?: boolean } = {}) {
  const calls: RecordedCall[] = []
  let did429 = false
  const mock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const raw = String(input)
    calls.push({ url: raw, init })
    const url = new URL(raw)
    if (hooks.on401) {
      return Promise.resolve(new Response('unauthorized', { status: 401 }))
    }
    const resource = url.pathname.split('/').pop() ?? ''
    const cursor = url.searchParams.get('cursor')
    if (resource === 'projects' && !cursor && hooks.on429Once && !did429) {
      did429 = true
      return Promise.resolve(
        new Response('slow down', { status: 429, headers: { 'Retry-After': '0' } }),
      )
    }
    let pages: unknown[][] | undefined
    if (resource === 'comments') {
      pages = fx.comments[url.searchParams.get('task_id') ?? ''] ?? [[]]
    } else if (resource === 'projects') pages = fx.projects
    else if (resource === 'sections') pages = fx.sections
    else if (resource === 'labels') pages = fx.labels
    else if (resource === 'tasks') pages = fx.tasks
    if (!pages) return Promise.resolve(new Response('not found', { status: 404 }))
    const idx = cursor ? Number(cursor.split(':')[1]) : 0
    const results = pages[idx] ?? []
    const nextCursor = idx < pages.length - 1 ? `${resource}:${idx + 1}` : null
    return Promise.resolve(
      new Response(JSON.stringify({ results, next_cursor: nextCursor }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  })
  return { mock: mock as unknown as typeof fetch, calls, getDid429: () => did429 }
}

function run(api: ReturnType<typeof makeApi>, onProgress?: (p: ImportProgress) => void) {
  return fetchTodoistExport(TOKEN, { baseUrl: BASE, fetchImpl: api.mock, onProgress })
}

describe('fetchTodoistExport', () => {
  it('produces a schema-valid todoist-api ImportPlan', async () => {
    const api = makeApi(FIXTURES)
    const plan = await run(api)
    expect(plan.source).toBe('todoist-api')
    expect(ImportPlanSchema.safeParse(plan).success).toBe(true)
  })

  it('sends Bearer auth on every request', async () => {
    const api = makeApi(FIXTURES)
    await run(api)
    for (const call of api.calls) {
      const headers = call.init?.headers as Record<string, string>
      expect(headers.Authorization).toBe(`Bearer ${TOKEN}`)
    }
  })

  it('follows cursor pagination for projects and tasks', async () => {
    const api = makeApi(FIXTURES)
    const plan = await run(api)

    const projectUrls = api.calls
      .map((c) => new URL(c.url))
      .filter((u) => u.pathname.endsWith('/projects'))
    expect(projectUrls).toHaveLength(2)
    expect(projectUrls[0]?.searchParams.get('cursor')).toBeNull()
    expect(projectUrls[0]?.searchParams.get('limit')).toBe('200')
    expect(projectUrls[1]?.searchParams.get('cursor')).toBe('projects:1')

    const taskUrls = api.calls
      .map((c) => new URL(c.url))
      .filter((u) => u.pathname.endsWith('/tasks'))
    expect(taskUrls).toHaveLength(2)
    expect(taskUrls[1]?.searchParams.get('cursor')).toBe('tasks:1')

    // both pages merged
    expect(plan.projects.map((p) => p.key)).toEqual(['inbox', 'work'])
    expect(plan.tasks.map((t) => t.key)).toEqual(['t1', 't2', 't3', 't4'])
  })

  it('fetches comments once per task via ?task_id, never filters or reminders', async () => {
    const api = makeApi(FIXTURES)
    await run(api)

    const commentTaskIds = api.calls
      .filter((c) => new URL(c.url).pathname.endsWith('/comments'))
      .map((c) => new URL(c.url).searchParams.get('task_id'))
    expect(new Set(commentTaskIds)).toEqual(new Set(['t1', 't2', 't3', 't4']))

    expect(api.calls.some((c) => c.url.includes('/filters'))).toBe(false)
    expect(api.calls.some((c) => c.url.includes('/reminders'))).toBe(false)
  })

  it('maps projects, sections and labels', async () => {
    const api = makeApi(FIXTURES)
    const plan = await run(api)

    expect(plan.projects).toEqual([
      { key: 'inbox', name: 'Inbox', color: 'grey', parentKey: null, isInbox: true },
      { key: 'work', name: 'Work', color: 'blue', parentKey: null, isInbox: false },
    ])
    expect(plan.sections).toEqual([
      { key: 'secA', projectKey: 'work', name: 'Planning', order: 0 },
      { key: 'secB', projectKey: 'work', name: 'Later', order: 1 },
    ])
    expect(plan.labels).toEqual([
      { key: 'lblWork', name: 'work', color: 'lime_green' },
      { key: 'lblTravel', name: 'travel', color: 'lime_green' },
    ])
  })

  it('inverts priority (API 4→1 … 1→4)', async () => {
    const api = makeApi(FIXTURES)
    const plan = await run(api)
    const byKey = Object.fromEntries(plan.tasks.map((t) => [t.key, t.priority]))
    expect(byKey).toEqual({ t1: 1, t2: 2, t3: 4, t4: 3 })
  })

  it('splits a timed due into date + HH:mm and keeps the recurring string', async () => {
    const api = makeApi(FIXTURES)
    const plan = await run(api)
    const t1 = plan.tasks.find((t) => t.key === 't1')
    expect(t1).toMatchObject({
      dueString: 'every friday',
      dueDate: '2026-08-01',
      dueTime: '09:00',
      deadline: '2026-08-15',
      durationMin: 45,
      labels: ['work'],
      projectKey: 'work',
      sectionKey: 'secA',
      parentKey: null,
      childOrder: 1,
      content: 'Draft Q3 roadmap',
      description: 'Outline the big rocks',
    })
  })

  it('maps a date-only due to date with null time and caps day-unit duration at 1440', async () => {
    const api = makeApi(FIXTURES)
    const plan = await run(api)
    const t2 = plan.tasks.find((t) => t.key === 't2')
    expect(t2).toMatchObject({
      dueString: 'Jul 22',
      dueDate: '2026-07-22',
      dueTime: null,
      durationMin: 1440,
      labels: ['travel', 'work'],
    })
  })

  it('leaves tasks with no due/deadline/duration null and keeps parent + uncompletable prefix', async () => {
    const api = makeApi(FIXTURES)
    const plan = await run(api)
    const t3 = plan.tasks.find((t) => t.key === 't3')
    expect(t3).toMatchObject({
      parentKey: 't1',
      content: '* Reference material',
      priority: 4,
      dueString: null,
      dueDate: null,
      dueTime: null,
      deadline: null,
      durationMin: null,
      childOrder: 2,
    })
  })

  it('keeps comment text and posted_at, dropping attachments with a skip note', async () => {
    const api = makeApi(FIXTURES)
    const plan = await run(api)

    const t1 = plan.tasks.find((t) => t.key === 't1')
    expect(t1?.comments).toEqual([
      { content: 'See the spec doc', postedAt: '2026-07-10T14:03:22Z' },
    ])
    const t3 = plan.tasks.find((t) => t.key === 't3')
    expect(t3?.comments).toEqual([
      { content: 'Use the office watering can', postedAt: '2026-07-11T09:00:00Z' },
    ])
    // tasks without comments carry an empty array
    expect(plan.tasks.find((t) => t.key === 't2')?.comments).toEqual([])
  })

  it('records collaborators, assignee and attachment skips', async () => {
    const api = makeApi(FIXTURES)
    const plan = await run(api)

    expect(plan.skips).toContainEqual({
      entity: 'project',
      ref: 'Work',
      reason: 'collaborators dropped',
    })
    expect(plan.skips).toContainEqual({
      entity: 'task',
      ref: 'Book flights',
      reason: 'assignee dropped',
    })
    expect(plan.skips).toContainEqual({
      entity: 'comment',
      ref: 'spec.pdf',
      reason: 'attachment dropped',
    })
    expect(plan.skips).toHaveLength(3)
  })

  it('reports fetching progress with growing counts', async () => {
    const api = makeApi(FIXTURES)
    const progress: ImportProgress[] = []
    await run(api, (p) => progress.push(structuredClone(p)))

    expect(progress.length).toBeGreaterThan(0)
    expect(progress.every((p) => p.phase === 'fetching')).toBe(true)

    // first emit is projects-only
    expect(progress[0]?.fetched).toEqual({ projects: 2 })
    // a later emit carries the full task count
    expect(progress.some((p) => p.fetched?.tasks === 4)).toBe(true)
    // final emit has all comments counted
    const last = progress.at(-1)
    expect(last?.fetched).toMatchObject({
      projects: 2,
      sections: 2,
      labels: 2,
      tasks: 4,
      comments: 2,
    })
  })

  it('throws a problem-style error on 401', async () => {
    const api = makeApi(FIXTURES, { on401: true })
    await expect(run(api)).rejects.toThrow('invalid Todoist token')
  })

  it('retries once after a 429 with Retry-After, then succeeds', async () => {
    const api = makeApi(FIXTURES, { on429Once: true })
    const plan = await run(api)

    expect(api.getDid429()).toBe(true)
    // the 429 was retried: /projects saw 3 hits (429, retried page 1, page 2)
    const projectCalls = api.calls.filter((c) => new URL(c.url).pathname.endsWith('/projects'))
    expect(projectCalls).toHaveLength(3)
    expect(plan.projects.map((p) => p.key)).toEqual(['inbox', 'work'])
  })

  it('defaults to the real Todoist base URL when none is given', async () => {
    const api = makeApi(FIXTURES)
    await fetchTodoistExport(TOKEN, { fetchImpl: api.mock })
    expect(api.calls[0]?.url.startsWith('https://api.todoist.com/api/v1/projects')).toBe(true)
  })
})
