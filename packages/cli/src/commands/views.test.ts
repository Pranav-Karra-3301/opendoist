import { addDaysIso, dateInTz } from '@opentask/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DueDto, TaskDto } from '../lib/api'
import {
  installMockFetch,
  page,
  runCli,
  sampleProject,
  sampleTask,
  stubAuthEnv,
} from '../test/harness'

// Compute fixture dates EXACTLY as the CLI does so tests are immune to UTC-vs-local drift.
const TODAY = dateInTz(new Date().toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone)
const rel = (days: number): string => addDaysIso(TODAY, days)
const dueOn = (date: string): DueDto => ({ date, time: null, string: date, is_recurring: false })

const PROJECTS = { method: 'GET' as const, path: '/api/v1/projects' }
const SECTIONS = { method: 'GET' as const, path: '/api/v1/sections' }
const TASKS = { method: 'GET' as const, path: '/api/v1/tasks' }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('opentask today', () => {
  it('groups Overdue before Today, excludes future tasks, and fetches only tasks/projects/sections', async () => {
    stubAuthEnv()
    const tasks: TaskDto[] = [
      sampleTask({ id: 'over', content: 'Ship the invoice', due: dueOn('2026-01-01') }),
      sampleTask({ id: 'now', content: 'Call the dentist', due: dueOn(TODAY) }),
      sampleTask({ id: 'fut', content: 'Plan the offsite', due: dueOn(rel(10)) }),
    ]
    const calls = installMockFetch([
      { ...TASKS, body: page(tasks) },
      { ...PROJECTS, body: page([sampleProject()]) },
      { ...SECTIONS, body: page([]) },
    ])

    const res = await runCli(['today'])

    expect(res.code).toBe(0)
    // Exactly the three endpoints, all GET, and nothing else (no /tasks/filter exists).
    expect(calls).toHaveLength(3)
    expect(calls.map((c) => c.url.pathname).sort()).toEqual([
      '/api/v1/projects',
      '/api/v1/sections',
      '/api/v1/tasks',
    ])
    expect(calls.every((c) => c.method === 'GET')).toBe(true)
    // Overdue section renders before the Today section.
    expect(res.stdout).toContain('Overdue')
    expect(res.stdout).toContain('Today')
    expect(res.stdout.indexOf('Overdue')).toBeLessThan(res.stdout.indexOf('Today'))
    // Filter actually ran: the +10d task is gone; the overdue + today ones remain.
    expect(res.stdout).toContain('Ship the invoice')
    expect(res.stdout).toContain('Call the dentist')
    expect(res.stdout).not.toContain('Plan the offsite')
  })

  it('--json emits a flat array with overdue first', async () => {
    stubAuthEnv()
    const tasks: TaskDto[] = [
      sampleTask({ id: 'now', content: 'C', due: dueOn(TODAY) }),
      sampleTask({ id: 'over', content: 'O', due: dueOn('2026-01-01') }),
    ]
    installMockFetch([
      { ...TASKS, body: page(tasks) },
      { ...PROJECTS, body: page([sampleProject()]) },
      { ...SECTIONS, body: page([]) },
    ])

    const res = await runCli(['today', '--json'])

    expect(res.code).toBe(0)
    const parsed = JSON.parse(res.stdout) as Array<{ id: string }>
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.map((t) => t.id)).toEqual(['over', 'now'])
  })

  it('prints "No tasks due today." when nothing is due', async () => {
    stubAuthEnv()
    installMockFetch([
      { ...TASKS, body: page([sampleTask({ due: null })]) },
      { ...PROJECTS, body: page([sampleProject()]) },
      { ...SECTIONS, body: page([]) },
    ])

    const res = await runCli(['today'])

    expect(res.code).toBe(0)
    expect(res.stdout).toContain('No tasks due today.')
  })
})

describe('opentask upcoming', () => {
  it('--days 3 includes a today+2 task and excludes a today+10 task', async () => {
    stubAuthEnv()
    const tasks: TaskDto[] = [
      sampleTask({ id: 'soon', content: 'Renew passport', due: dueOn(rel(2)) }),
      sampleTask({ id: 'far', content: 'Book flights', due: dueOn(rel(10)) }),
    ]
    installMockFetch([
      { ...TASKS, body: page(tasks) },
      { ...PROJECTS, body: page([sampleProject()]) },
      { ...SECTIONS, body: page([]) },
    ])

    const res = await runCli(['upcoming', '--days', '3'])

    expect(res.code).toBe(0)
    expect(res.stdout).toContain('Renew passport')
    expect(res.stdout).not.toContain('Book flights')
    // The day header carries the raw ISO date after the middot, regardless of relativeDate styling.
    expect(res.stdout).toContain(`· ${rel(2)}`)
  })

  it('--days 0 exits 1 and never fetches', async () => {
    stubAuthEnv()
    const calls = installMockFetch([])

    const res = await runCli(['upcoming', '--days', '0'])

    expect(res.code).toBe(1)
    expect(calls).toHaveLength(0)
  })

  it('--days 99 (out of range) exits 1 and never fetches', async () => {
    stubAuthEnv()
    const calls = installMockFetch([])

    const res = await runCli(['upcoming', '--days', '99'])

    expect(res.code).toBe(1)
    expect(calls).toHaveLength(0)
  })
})

describe('opentask list', () => {
  it('groups by project with the inbox first', async () => {
    stubAuthEnv()
    const projects = [
      sampleProject({ id: 'prj_work', name: 'Work', child_order: 1, is_inbox: false }),
      sampleProject({ id: 'prj_inbox', name: 'Inbox', child_order: 0, is_inbox: true }),
    ]
    const tasks: TaskDto[] = [
      sampleTask({ id: 't_work', content: 'Work task', project_id: 'prj_work' }),
      sampleTask({ id: 't_inbox', content: 'Inbox task', project_id: 'prj_inbox' }),
    ]
    const calls = installMockFetch([
      { ...TASKS, body: page(tasks) },
      { ...PROJECTS, body: page(projects) },
    ])

    const res = await runCli(['list'])

    expect(res.code).toBe(0)
    // Plain list touches only tasks + projects (no sections, no filter endpoint).
    expect(calls).toHaveLength(2)
    expect(res.stdout).toContain('#Inbox')
    expect(res.stdout).toContain('#Work')
    expect(res.stdout.indexOf('#Inbox')).toBeLessThan(res.stdout.indexOf('#Work'))
  })

  it('--json emits a flat array in the frozen sort order (due asc, nulls last)', async () => {
    stubAuthEnv()
    const tasks: TaskDto[] = [
      sampleTask({ id: 'later', content: 'Later', due: dueOn(rel(5)) }),
      sampleTask({ id: 'nodue', content: 'No due', due: null }),
      sampleTask({ id: 'earlier', content: 'Earlier', due: dueOn(rel(1)) }),
    ]
    installMockFetch([
      { ...TASKS, body: page(tasks) },
      { ...PROJECTS, body: page([sampleProject()]) },
    ])

    const res = await runCli(['list', '--json'])

    expect(res.code).toBe(0)
    const parsed = JSON.parse(res.stdout) as Array<{ id: string }>
    expect(parsed.map((t) => t.id)).toEqual(['earlier', 'later', 'nodue'])
  })

  it('<query> evaluates the filter locally over tasks/projects/sections (fetched once each)', async () => {
    stubAuthEnv()
    const tasks: TaskDto[] = [
      sampleTask({ id: 'over', content: 'Overdue one', due: dueOn('2026-01-01') }),
      sampleTask({ id: 'fine', content: 'Not due', due: null }),
    ]
    const calls = installMockFetch([
      { ...TASKS, body: page(tasks) },
      { ...PROJECTS, body: page([sampleProject({ name: 'Inbox' })]) },
      { ...SECTIONS, body: page([]) },
    ])

    const res = await runCli(['list', 'overdue'])

    expect(res.code).toBe(0)
    expect(calls).toHaveLength(3)
    expect(calls.map((c) => c.url.pathname).sort()).toEqual([
      '/api/v1/projects',
      '/api/v1/sections',
      '/api/v1/tasks',
    ])
    expect(res.stdout).toContain('Overdue one')
    expect(res.stdout).not.toContain('Not due')
  })

  it('rejects a syntactically invalid filter (exit 1, position, zero fetches)', async () => {
    stubAuthEnv()
    const calls = installMockFetch([])

    const res = await runCli(['list', 'today &'])

    expect(res.code).toBe(1)
    expect(res.stderr).toContain('position')
    expect(calls).toHaveLength(0)
  })

  it('rejects a comma multi-pane filter (exit 1, no fetch)', async () => {
    stubAuthEnv()
    const calls = installMockFetch([])

    const res = await runCli(['list', 'today, tomorrow'])

    expect(res.code).toBe(1)
    expect(res.stderr).toContain('multi-pane')
    expect(calls).toHaveLength(0)
  })
})
