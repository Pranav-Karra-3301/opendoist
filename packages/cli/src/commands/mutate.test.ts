import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DueDto } from '../lib/api'
import { prompter } from '../lib/prompt'
import { installMockFetch, page, runCli, sampleTask, stubAuthEnv } from '../test/harness'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const recurringDue: DueDto = {
  date: '2026-07-16',
  time: null,
  string: 'every day',
  is_recurring: true,
}
const advancedDue: DueDto = {
  date: '2026-07-17',
  time: null,
  string: 'every day',
  is_recurring: true,
}

describe('done', () => {
  it('closes an exact-id task without confirming', async () => {
    stubAuthEnv()
    const confirm = vi.spyOn(prompter, 'confirm')
    const calls = installMockFetch([
      { method: 'GET', path: '/api/v1/tasks/tsk_1', body: sampleTask() },
      { method: 'POST', path: '/api/v1/tasks/tsk_1/close', status: 204 },
    ])
    const res = await runCli(['done', 'tsk_1'])
    expect(res.code).toBe(0)
    expect(confirm).not.toHaveBeenCalled()
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      'GET /api/v1/tasks/tsk_1',
      'POST /api/v1/tasks/tsk_1/close',
    ])
    expect(res.stdout).toContain('✓ completed')
    expect(res.stdout).toContain('tsk_1')
  })

  it('fuzzy-matches on content, confirms, then closes', async () => {
    stubAuthEnv()
    const confirm = vi.spyOn(prompter, 'confirm').mockResolvedValue(true)
    const calls = installMockFetch([
      {
        method: 'GET',
        path: '/api/v1/tasks',
        body: page([sampleTask({ id: 'tsk_1', content: 'Submit report' })]),
      },
      { method: 'POST', path: '/api/v1/tasks/tsk_1/close', status: 204 },
    ])
    const res = await runCli(['done', 'report'])
    expect(res.code).toBe(0)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(
      calls.some((c) => c.method === 'POST' && c.url.pathname === '/api/v1/tasks/tsk_1/close'),
    ).toBe(true)
  })

  it('aborts (exit 1, no mutation) when the fuzzy confirmation is declined', async () => {
    stubAuthEnv()
    vi.spyOn(prompter, 'confirm').mockResolvedValue(false)
    const calls = installMockFetch([
      {
        method: 'GET',
        path: '/api/v1/tasks',
        body: page([sampleTask({ id: 'tsk_1', content: 'Submit report' })]),
      },
      { method: 'POST', path: '/api/v1/tasks/tsk_1/close', status: 204 },
    ])
    const res = await runCli(['done', 'report'])
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('aborted')
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('lists candidate ids and aborts on an ambiguous match', async () => {
    stubAuthEnv()
    const confirm = vi.spyOn(prompter, 'confirm')
    const calls = installMockFetch([
      {
        method: 'GET',
        path: '/api/v1/tasks',
        body: page([
          sampleTask({ id: 'tsk_1', content: 'Submit report' }),
          sampleTask({ id: 'tsk_2', content: 'Review report' }),
        ]),
      },
    ])
    const res = await runCli(['done', 'report'])
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('tsk_1')
    expect(res.stderr).toContain('tsk_2')
    expect(res.stderr).toContain('ambiguous')
    expect(confirm).not.toHaveBeenCalled()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('reports no match when the ref resolves to nothing (404 on both paths)', async () => {
    stubAuthEnv()
    const calls = installMockFetch([
      {
        method: 'GET',
        path: '/api/v1/tasks',
        body: page([sampleTask({ content: 'Submit report' })]),
      },
    ])
    const res = await runCli(['done', 'zzz'])
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('no task matching')
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('--json emits the closed action payload', async () => {
    stubAuthEnv()
    installMockFetch([
      { method: 'GET', path: '/api/v1/tasks/tsk_1', body: sampleTask() },
      { method: 'POST', path: '/api/v1/tasks/tsk_1/close', status: 204 },
    ])
    const res = await runCli(['--json', 'done', 'tsk_1'])
    expect(res.code).toBe(0)
    expect(JSON.parse(res.stdout)).toEqual({ ok: true, id: 'tsk_1', action: 'closed' })
  })

  it('re-fetches a recurring task and shows the next occurrence', async () => {
    stubAuthEnv()
    installMockFetch([
      {
        method: 'GET',
        path: '/api/v1/tasks/tsk_1',
        body: sampleTask({ due: recurringDue }),
        once: true,
      },
      { method: 'POST', path: '/api/v1/tasks/tsk_1/close', status: 204 },
      {
        method: 'GET',
        path: '/api/v1/tasks/tsk_1',
        body: sampleTask({ due: advancedDue }),
        once: true,
      },
    ])
    const res = await runCli(['done', 'tsk_1'])
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('next occurrence')
  })

  it('--json on a recurring task includes next_due', async () => {
    stubAuthEnv()
    installMockFetch([
      {
        method: 'GET',
        path: '/api/v1/tasks/tsk_1',
        body: sampleTask({ due: recurringDue }),
        once: true,
      },
      { method: 'POST', path: '/api/v1/tasks/tsk_1/close', status: 204 },
      {
        method: 'GET',
        path: '/api/v1/tasks/tsk_1',
        body: sampleTask({ due: advancedDue }),
        once: true,
      },
    ])
    const res = await runCli(['--json', 'done', 'tsk_1'])
    expect(res.code).toBe(0)
    expect(JSON.parse(res.stdout)).toEqual({
      ok: true,
      id: 'tsk_1',
      action: 'closed',
      next_due: advancedDue,
    })
  })
})

describe('reopen', () => {
  it('fuzzy-matches against the completed pool (no completed= param)', async () => {
    stubAuthEnv()
    vi.spyOn(prompter, 'confirm').mockResolvedValue(true)
    const calls = installMockFetch([
      {
        method: 'GET',
        path: '/api/v1/tasks/completed',
        body: page([sampleTask({ id: 'tsk_9', content: 'foobar task' })]),
      },
      { method: 'POST', path: '/api/v1/tasks/tsk_9/reopen', status: 204 },
    ])
    const res = await runCli(['reopen', 'foo'])
    expect(res.code).toBe(0)
    const completed = calls.find((c) => c.url.pathname === '/api/v1/tasks/completed')
    expect(completed).toBeDefined()
    expect(completed?.url.searchParams.get('completed')).toBeNull()
    expect(
      calls.some((c) => c.method === 'POST' && c.url.pathname === '/api/v1/tasks/tsk_9/reopen'),
    ).toBe(true)
    expect(res.stdout).toContain('✓ reopened')
  })

  it('--json emits the reopened action payload for an exact id (no confirm)', async () => {
    stubAuthEnv()
    const confirm = vi.spyOn(prompter, 'confirm')
    installMockFetch([
      {
        method: 'GET',
        path: '/api/v1/tasks/tsk_1',
        body: sampleTask({ completed_at: '2026-07-15T10:00:00Z' }),
      },
      { method: 'POST', path: '/api/v1/tasks/tsk_1/reopen', status: 204 },
    ])
    const res = await runCli(['--json', 'reopen', 'tsk_1'])
    expect(res.code).toBe(0)
    expect(confirm).not.toHaveBeenCalled()
    expect(JSON.parse(res.stdout)).toEqual({ ok: true, id: 'tsk_1', action: 'reopened' })
  })
})

describe('rm', () => {
  it('confirms even for an exact id, then deletes', async () => {
    stubAuthEnv()
    const confirm = vi.spyOn(prompter, 'confirm').mockResolvedValue(true)
    const calls = installMockFetch([
      { method: 'GET', path: '/api/v1/tasks/tsk_1', body: sampleTask() },
      { method: 'DELETE', path: '/api/v1/tasks/tsk_1', status: 204 },
    ])
    const res = await runCli(['rm', 'tsk_1'])
    expect(res.code).toBe(0)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(
      calls.some((c) => c.method === 'DELETE' && c.url.pathname === '/api/v1/tasks/tsk_1'),
    ).toBe(true)
    expect(res.stdout).toContain('✓ deleted')
  })

  it('--yes skips the prompt and deletes', async () => {
    stubAuthEnv()
    const confirm = vi.spyOn(prompter, 'confirm')
    const calls = installMockFetch([
      { method: 'GET', path: '/api/v1/tasks/tsk_1', body: sampleTask() },
      { method: 'DELETE', path: '/api/v1/tasks/tsk_1', status: 204 },
    ])
    const res = await runCli(['rm', 'tsk_1', '--yes'])
    expect(res.code).toBe(0)
    expect(confirm).not.toHaveBeenCalled()
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true)
  })

  it('--json --yes emits the deleted action payload', async () => {
    stubAuthEnv()
    installMockFetch([
      { method: 'GET', path: '/api/v1/tasks/tsk_1', body: sampleTask() },
      { method: 'DELETE', path: '/api/v1/tasks/tsk_1', status: 204 },
    ])
    const res = await runCli(['--json', 'rm', 'tsk_1', '--yes'])
    expect(res.code).toBe(0)
    expect(JSON.parse(res.stdout)).toEqual({ ok: true, id: 'tsk_1', action: 'deleted' })
  })

  it('declined confirmation aborts without a DELETE', async () => {
    stubAuthEnv()
    vi.spyOn(prompter, 'confirm').mockResolvedValue(false)
    const calls = installMockFetch([
      { method: 'GET', path: '/api/v1/tasks/tsk_1', body: sampleTask() },
      { method: 'DELETE', path: '/api/v1/tasks/tsk_1', status: 204 },
    ])
    const res = await runCli(['rm', 'tsk_1'])
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('aborted')
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })
})
