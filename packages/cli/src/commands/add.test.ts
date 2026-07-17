import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { installMockFetch, runCli, sampleTask, stubAuthEnv } from '../test/harness'

const QUICK = '/api/v1/tasks/quick'

describe('opendoist add', () => {
  beforeEach(() => {
    stubAuthEnv()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  test('submits the raw joined text unchanged as a single POST /tasks/quick', async () => {
    const created = sampleTask({
      content: 'Submit report',
      priority: 1,
      project_id: 'prj_work',
      due: { date: '2026-07-16', time: '16:00', string: 'tom 4pm', is_recurring: false },
    })
    const calls = installMockFetch([{ method: 'POST', path: QUICK, body: created }])

    const run = await runCli(['add', 'Submit', 'report', 'tom', '4pm', 'p1', '#Work'])

    expect(run.code).toBe(0)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.url.pathname).toBe(QUICK)
    // raw, unmodified — the CLI never sends parsed fields
    expect(calls[0]?.body).toEqual({ text: 'Submit report tom 4pm p1 #Work' })
    expect(calls[0]?.headers.authorization).toBe('Bearer od_testtoken123')
  })

  test('prints ✓ added with the created content', async () => {
    const created = sampleTask({ content: 'Submit report' })
    installMockFetch([{ method: 'POST', path: QUICK, body: created }])

    const run = await runCli(['add', 'Submit', 'report'])

    expect(run.code).toBe(0)
    expect(run.stdout).toContain('✓ added')
    expect(run.stdout).toContain('Submit report')
  })

  test('echoes a parsed summary merging server fields with the local preview', async () => {
    const created = sampleTask({
      content: 'Submit report',
      priority: 1,
      project_id: 'prj_work',
      due: { date: '2026-07-16', time: '16:00', string: 'tom 4pm', is_recurring: false },
      labels: ['urgent'],
    })
    installMockFetch([{ method: 'POST', path: QUICK, body: created }])

    const run = await runCli(['add', 'Submit', 'report', 'tom', '4pm', 'p1', '#Work', '@urgent'])

    expect(run.code).toBe(0)
    // p1/due/labels come from the server DTO; #Work (project name) comes from the local preview.
    expect(run.stdout).toContain('parsed: p1 · due tom 4pm · #Work · @urgent')
  })

  test('--json emits the created TaskDto verbatim', async () => {
    const created = sampleTask({ id: 'tsk_9', content: 'Buy milk', priority: 2 })
    installMockFetch([{ method: 'POST', path: QUICK, body: created }])

    const run = await runCli(['--json', 'add', 'Buy', 'milk', 'p2'])

    expect(run.code).toBe(0)
    expect(JSON.parse(run.stdout)).toEqual(created)
  })

  test('empty title after token extraction → exit 1 with no network call', async () => {
    const calls = installMockFetch([{ method: 'POST', path: QUICK, body: sampleTask() }])

    const run = await runCli(['add', 'p1', '#Work'])

    expect(run.code).toBe(1)
    expect(calls).toHaveLength(0)
    expect(run.stderr).toContain('title is empty')
  })

  test('server 400 problem-json surfaces the detail in stderr, exit 1', async () => {
    installMockFetch([
      { method: 'POST', path: QUICK, status: 400, body: { title: 'invalid', detail: 'blah' } },
    ])

    const run = await runCli(['add', 'buy', 'milk'])

    expect(run.code).toBe(1)
    expect(run.stderr).toContain('blah')
  })

  test('401 → exit 2', async () => {
    installMockFetch([
      { method: 'POST', path: QUICK, status: 401, body: { title: 'unauthorized' } },
    ])

    const run = await runCli(['add', 'buy', 'milk'])

    expect(run.code).toBe(2)
  })
})
