import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectDto, SectionDto } from '../lib/api'
import { installMockFetch, page, runCli, sampleProject, stubAuthEnv } from '../test/harness'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

// Distinctive names so substring/order assertions can't collide.
const inbox = sampleProject() // prj_inbox · Inbox · is_inbox · child_order 0
const eng = sampleProject({ id: 'prj_eng', name: 'Engineering', is_inbox: false, child_order: 1 })
const backend = sampleProject({
  id: 'prj_be',
  name: 'Backend',
  parent_id: 'prj_eng',
  is_inbox: false,
  child_order: 0,
})
const legacy = sampleProject({
  id: 'prj_old',
  name: 'Legacy',
  is_inbox: false,
  is_archived: true,
  child_order: 2,
})

function section(overrides: Partial<SectionDto> = {}): SectionDto {
  return { id: 'sec_1', project_id: 'prj_eng', name: 'Sprint', section_order: 1, ...overrides }
}

describe('projects', () => {
  it('lists projects with inbox first and children after their parent, excluding archived', async () => {
    stubAuthEnv()
    installMockFetch([
      { method: 'GET', path: '/api/v1/projects', body: page([eng, backend, inbox, legacy]) },
    ])
    const run = await runCli(['projects'])
    expect(run.code).toBe(0)
    // inbox before other roots
    expect(run.stdout.indexOf('Inbox')).toBeGreaterThanOrEqual(0)
    expect(run.stdout.indexOf('Inbox')).toBeLessThan(run.stdout.indexOf('Engineering'))
    // parent before its child
    expect(run.stdout.indexOf('Engineering')).toBeLessThan(run.stdout.indexOf('Backend'))
    // archived project absent
    expect(run.stdout).not.toContain('Legacy')
  })

  it('emits archived-excluded tree order as JSON under --json', async () => {
    stubAuthEnv()
    installMockFetch([
      { method: 'GET', path: '/api/v1/projects', body: page([eng, backend, inbox, legacy]) },
    ])
    const run = await runCli(['projects', '--json'])
    expect(run.code).toBe(0)
    const data = JSON.parse(run.stdout) as ProjectDto[]
    expect(data.map((p) => p.id)).toEqual(['prj_inbox', 'prj_eng', 'prj_be'])
  })

  it('projects add posts name + color and does not fetch the project list', async () => {
    stubAuthEnv()
    const calls = installMockFetch([
      {
        method: 'POST',
        path: '/api/v1/projects',
        body: sampleProject({ id: 'prj_new', name: 'Groceries', is_inbox: false }),
      },
    ])
    const run = await runCli(['projects', 'add', 'Groceries', '--color', 'green'])
    expect(run.code).toBe(0)
    const post = calls.find((c) => c.method === 'POST')
    expect(post?.body).toEqual({ name: 'Groceries', color: 'green' })
    expect(calls.some((c) => c.method === 'GET')).toBe(false)
    expect(run.stdout).toContain('created project')
    expect(run.stdout).toContain('Groceries')
    expect(run.stdout).toContain('prj_new')
  })

  it('projects add resolves --parent by name and posts parent_id', async () => {
    stubAuthEnv()
    const calls = installMockFetch([
      { method: 'GET', path: '/api/v1/projects', body: page([inbox, eng]) },
      {
        method: 'POST',
        path: '/api/v1/projects',
        body: sampleProject({ id: 'prj_sub', name: 'Sub', is_inbox: false, parent_id: 'prj_eng' }),
      },
    ])
    const run = await runCli(['projects', 'add', 'Sub', '--parent', 'Engineering'])
    expect(run.code).toBe(0)
    const post = calls.find((c) => c.method === 'POST')
    expect(post?.body).toEqual({ name: 'Sub', parent_id: 'prj_eng' })
  })

  it('projects add resolves --parent by exact id', async () => {
    stubAuthEnv()
    const calls = installMockFetch([
      { method: 'GET', path: '/api/v1/projects', body: page([inbox, eng]) },
      {
        method: 'POST',
        path: '/api/v1/projects',
        body: sampleProject({ id: 'prj_x', name: 'Child', is_inbox: false, parent_id: 'prj_eng' }),
      },
    ])
    const run = await runCli(['projects', 'add', 'Child', '--parent', 'prj_eng'])
    expect(run.code).toBe(0)
    const post = calls.find((c) => c.method === 'POST')
    expect(post?.body).toEqual({ name: 'Child', parent_id: 'prj_eng' })
  })

  it('projects add with an unknown --parent errors (exit 1) and never POSTs', async () => {
    stubAuthEnv()
    const calls = installMockFetch([
      { method: 'GET', path: '/api/v1/projects', body: page([inbox, eng]) },
      { method: 'POST', path: '/api/v1/projects', body: sampleProject() },
    ])
    const run = await runCli(['projects', 'add', 'Sub', '--parent', 'Nope'])
    expect(run.code).toBe(1)
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
    expect(run.stderr).toContain('no project named')
  })

  it('projects add with an ambiguous --parent name errors (exit 1) and never POSTs', async () => {
    stubAuthEnv()
    const dupA = sampleProject({ id: 'prj_a', name: 'Team', is_inbox: false })
    const dupB = sampleProject({ id: 'prj_b', name: 'Team', is_inbox: false, child_order: 1 })
    const calls = installMockFetch([
      { method: 'GET', path: '/api/v1/projects', body: page([inbox, dupA, dupB]) },
      { method: 'POST', path: '/api/v1/projects', body: sampleProject() },
    ])
    const run = await runCli(['projects', 'add', 'Child', '--parent', 'Team'])
    expect(run.code).toBe(1)
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
    expect(run.stderr).toContain('multiple projects named')
  })

  it('projects add --json emits the created project object', async () => {
    stubAuthEnv()
    installMockFetch([
      {
        method: 'POST',
        path: '/api/v1/projects',
        body: sampleProject({ id: 'prj_new', name: 'Groceries', is_inbox: false }),
      },
    ])
    const run = await runCli(['projects', 'add', 'Groceries', '--json'])
    expect(run.code).toBe(0)
    const data = JSON.parse(run.stdout) as ProjectDto
    expect(data.id).toBe('prj_new')
    expect(data.name).toBe('Groceries')
  })
})

describe('sections', () => {
  it('sections --project sends the project_id query param', async () => {
    stubAuthEnv()
    const calls = installMockFetch([
      { method: 'GET', path: '/api/v1/projects', body: page([inbox, eng]) },
      {
        method: 'GET',
        path: '/api/v1/sections',
        query: { project_id: 'prj_eng' },
        body: page([section()]),
      },
    ])
    const run = await runCli(['sections', '--project', 'Engineering'])
    expect(run.code).toBe(0)
    const sectionsCall = calls.find((c) => c.url.pathname === '/api/v1/sections')
    expect(sectionsCall?.url.searchParams.get('project_id')).toBe('prj_eng')
    expect(run.stdout).toContain('Sprint')
  })

  it('sections --project --json emits a SectionDto array', async () => {
    stubAuthEnv()
    installMockFetch([
      { method: 'GET', path: '/api/v1/projects', body: page([inbox, eng]) },
      { method: 'GET', path: '/api/v1/sections', body: page([section()]) },
    ])
    const run = await runCli(['sections', '--project', 'Engineering', '--json'])
    expect(run.code).toBe(0)
    const data = JSON.parse(run.stdout) as SectionDto[]
    expect(data).toHaveLength(1)
    expect(data[0]?.name).toBe('Sprint')
  })

  it('sections add posts name + resolved project_id', async () => {
    stubAuthEnv()
    const calls = installMockFetch([
      { method: 'GET', path: '/api/v1/projects', body: page([inbox, eng]) },
      {
        method: 'POST',
        path: '/api/v1/sections',
        body: section({ id: 'sec_9', name: 'Admin' }),
      },
    ])
    const run = await runCli(['sections', 'add', 'Admin', '--project', 'Engineering'])
    expect(run.code).toBe(0)
    const post = calls.find((c) => c.method === 'POST')
    expect(post?.body).toEqual({ name: 'Admin', project_id: 'prj_eng' })
    expect(run.stdout).toContain('created section')
    expect(run.stdout).toContain('Admin')
  })

  it('sections add without --project fails as a usage error (exit 1) before any request', async () => {
    stubAuthEnv()
    const calls = installMockFetch([])
    const run = await runCli(['sections', 'add', 'Admin'])
    expect(run.code).toBe(1)
    expect(calls).toHaveLength(0)
  })
})
