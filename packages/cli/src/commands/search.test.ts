import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installMockFetch,
  page,
  runCli,
  sampleProject,
  sampleTask,
  stubAuthEnv,
} from '../test/harness'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('search', () => {
  it('joins the variadic query into the `q` param and prints hit content', async () => {
    stubAuthEnv()
    const calls = installMockFetch([
      {
        method: 'GET',
        path: '/api/v1/search',
        body: page([{ task: sampleTask({ content: 'Meeting notes draft' }), matched_in: 'task' }]),
      },
      { method: 'GET', path: '/api/v1/projects', body: page([sampleProject()]) },
    ])
    const run = await runCli(['search', 'meeting', 'notes'])
    expect(run.code).toBe(0)
    expect(run.stdout).toContain('Meeting notes draft')
    const searchCall = calls.find((call) => call.url.pathname === '/api/v1/search')
    expect(searchCall?.method).toBe('GET')
    expect(searchCall?.url.searchParams.get('q')).toBe('meeting notes')
  })

  it('slices to --limit and prints a truncation footer', async () => {
    stubAuthEnv()
    installMockFetch([
      {
        method: 'GET',
        path: '/api/v1/search',
        body: page([
          { task: sampleTask({ id: 'tsk_1', content: 'First hit' }), matched_in: 'task' },
          { task: sampleTask({ id: 'tsk_2', content: 'Second hit' }), matched_in: 'comment' },
        ]),
      },
      { method: 'GET', path: '/api/v1/projects', body: page([sampleProject()]) },
    ])
    const run = await runCli(['search', 'hit', '--limit', '1'])
    expect(run.code).toBe(0)
    expect(run.stdout).toContain('First hit')
    expect(run.stdout).not.toContain('Second hit')
    expect(run.stdout).toContain('1 of 2 results')
  })

  it('prints "no results" and exits 0 when nothing matches', async () => {
    stubAuthEnv()
    installMockFetch([{ method: 'GET', path: '/api/v1/search', body: page([]) }])
    const run = await runCli(['search', 'nothingmatches'])
    expect(run.code).toBe(0)
    expect(run.stdout).toContain('no results')
    expect(run.stdout).toContain('nothingmatches')
  })

  it('emits the sliced TaskDto[] as JSON under --json without launching project lookup', async () => {
    stubAuthEnv()
    installMockFetch([
      {
        method: 'GET',
        path: '/api/v1/search',
        body: page([
          { task: sampleTask({ id: 'tsk_1', content: 'First hit' }), matched_in: 'task' },
          { task: sampleTask({ id: 'tsk_2', content: 'Second hit' }), matched_in: 'comment' },
        ]),
      },
    ])
    const run = await runCli(['search', 'hit', '--limit', '1', '--json'])
    expect(run.code).toBe(0)
    const parsed = JSON.parse(run.stdout) as Array<{ id: string }>
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.id).toBe('tsk_1')
  })

  it('rejects a non-positive --limit with a usage error (exit 1) before any request', async () => {
    stubAuthEnv()
    const calls = installMockFetch([])
    const run = await runCli(['search', 'foo', '--limit', '0'])
    expect(run.code).toBe(1)
    expect(run.stderr).toContain('--limit')
    expect(calls).toHaveLength(0)
  })

  it('exits 2 when the search endpoint returns 401', async () => {
    stubAuthEnv()
    installMockFetch([
      { method: 'GET', path: '/api/v1/search', status: 401, body: { title: 'unauthorized' } },
    ])
    const run = await runCli(['search', 'anything'])
    expect(run.code).toBe(2)
  })
})
