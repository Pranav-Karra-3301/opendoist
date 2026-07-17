import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FilterDto, LabelDto } from '../lib/api'
import { installMockFetch, page, runCli, stubAuthEnv } from '../test/harness'

function sampleLabel(overrides: Partial<LabelDto> = {}): LabelDto {
  return {
    id: 'lbl_1',
    name: 'errands',
    color: 'blue',
    item_order: 1,
    is_favorite: false,
    ...overrides,
  }
}
function sampleFilter(overrides: Partial<FilterDto> = {}): FilterDto {
  return {
    id: 'flt_1',
    name: 'Urgent',
    query: 'p1',
    color: 'red',
    item_order: 1,
    is_favorite: false,
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('labels', () => {
  it('lists labels ordered by item_order', async () => {
    stubAuthEnv()
    installMockFetch([
      {
        method: 'GET',
        path: '/api/v1/labels',
        body: page([
          sampleLabel({ id: 'lbl_2', name: 'waiting', item_order: 2 }),
          sampleLabel({ id: 'lbl_1', name: 'errands', item_order: 1 }),
        ]),
      },
    ])
    const run = await runCli(['labels'])
    expect(run.code).toBe(0)
    expect(run.stdout).toContain('errands')
    expect(run.stdout).toContain('waiting')
    // item_order 1 (errands) must render before item_order 2 (waiting)
    expect(run.stdout.indexOf('errands')).toBeLessThan(run.stdout.indexOf('waiting'))
  })

  it('emits raw LabelDto[] with --json', async () => {
    stubAuthEnv()
    installMockFetch([
      {
        method: 'GET',
        path: '/api/v1/labels',
        body: page([
          sampleLabel({ id: 'lbl_2', name: 'waiting', item_order: 2 }),
          sampleLabel({ id: 'lbl_1', name: 'errands', item_order: 1 }),
        ]),
      },
    ])
    const run = await runCli(['labels', '--json'])
    expect(run.code).toBe(0)
    const parsed = JSON.parse(run.stdout) as LabelDto[]
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.map((l) => l.name)).toEqual(['errands', 'waiting'])
  })

  it('creates a label with the exact POST body', async () => {
    stubAuthEnv()
    const calls = installMockFetch([
      {
        method: 'POST',
        path: '/api/v1/labels',
        body: sampleLabel({ name: 'errands', color: 'yellow' }),
      },
    ])
    const run = await runCli(['labels', 'add', 'errands', '--color', 'yellow'])
    expect(run.code).toBe(0)
    const posts = calls.filter((c) => c.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0]?.body).toEqual({ name: 'errands', color: 'yellow' })
    expect(run.stdout).toContain('created label @errands')
    expect(run.stdout).toContain('lbl_1')
  })

  it('omits color from the POST body when --color is absent', async () => {
    stubAuthEnv()
    const calls = installMockFetch([
      { method: 'POST', path: '/api/v1/labels', body: sampleLabel({ name: 'home' }) },
    ])
    const run = await runCli(['labels', 'add', 'home'])
    expect(run.code).toBe(0)
    const posts = calls.filter((c) => c.method === 'POST')
    expect(posts[0]?.body).toEqual({ name: 'home' })
  })
})

describe('filters', () => {
  it('lists filters ordered by item_order', async () => {
    stubAuthEnv()
    installMockFetch([
      {
        method: 'GET',
        path: '/api/v1/filters',
        body: page([
          sampleFilter({ id: 'flt_2', name: 'Later', query: 'no date', item_order: 2 }),
          sampleFilter({ id: 'flt_1', name: 'Urgent', query: 'p1', item_order: 1 }),
        ]),
      },
    ])
    const run = await runCli(['filters'])
    expect(run.code).toBe(0)
    expect(run.stdout).toContain('Urgent')
    expect(run.stdout).toContain('Later')
    expect(run.stdout.indexOf('Urgent')).toBeLessThan(run.stdout.indexOf('Later'))
  })

  it('creates a filter and posts the raw query verbatim', async () => {
    stubAuthEnv()
    const query = '(p1 | p2) & 14 days'
    const calls = installMockFetch([
      { method: 'POST', path: '/api/v1/filters', body: sampleFilter({ name: 'Urgent', query }) },
    ])
    const run = await runCli(['filters', 'add', 'Urgent', query])
    expect(run.code).toBe(0)
    const posts = calls.filter((c) => c.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0]?.body).toEqual({ name: 'Urgent', query })
    expect(run.stdout).toContain('created filter Urgent')
  })

  it('accepts a multi-pane filter query', async () => {
    stubAuthEnv()
    const query = '#Inbox & no date, view all'
    const calls = installMockFetch([
      {
        method: 'POST',
        path: '/api/v1/filters',
        body: sampleFilter({ id: 'flt_3', name: 'Split', query }),
      },
    ])
    const run = await runCli(['filters', 'add', 'Split', query])
    expect(run.code).toBe(0)
    const posts = calls.filter((c) => c.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0]?.body).toEqual({ name: 'Split', query })
  })

  it('emits the created FilterDto with --json', async () => {
    stubAuthEnv()
    const calls = installMockFetch([
      {
        method: 'POST',
        path: '/api/v1/filters',
        body: sampleFilter({ id: 'flt_9', name: 'Q', query: 'p1' }),
      },
    ])
    const run = await runCli(['filters', 'add', 'Q', 'p1', '--json'])
    expect(run.code).toBe(0)
    const parsed = JSON.parse(run.stdout) as FilterDto
    expect(parsed.id).toBe('flt_9')
    expect(parsed.name).toBe('Q')
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  })

  it('rejects an invalid filter query before any request', async () => {
    stubAuthEnv()
    const calls = installMockFetch([
      { method: 'POST', path: '/api/v1/filters', body: sampleFilter() },
    ])
    const run = await runCli(['filters', 'add', 'Bad', 'today &'])
    expect(run.code).toBe(1)
    expect(calls).toHaveLength(0)
    expect(run.stderr).toContain('position')
  })

  it('reports the invalid filter query as a JSON error with --json', async () => {
    stubAuthEnv()
    const calls = installMockFetch([
      { method: 'POST', path: '/api/v1/filters', body: sampleFilter() },
    ])
    const run = await runCli(['filters', 'add', 'Bad', 'today &', '--json'])
    expect(run.code).toBe(1)
    expect(calls).toHaveLength(0)
    const parsed = JSON.parse(run.stdout) as {
      ok: boolean
      error: { code: string; message: string }
    }
    expect(parsed.ok).toBe(false)
    expect(parsed.error.code).toBe('usage')
    expect(parsed.error.message).toContain('position')
  })
})
