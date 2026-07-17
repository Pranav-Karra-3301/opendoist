import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installMockFetch, page, runCli, sampleTask, stubAuthEnv, TEST_URL } from '../test/harness'
import { launcher } from './open'

const notFound = { title: 'not found', detail: 'no such task' }

describe('open command', () => {
  let openSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stubAuthEnv()
    openSpy = vi.spyOn(launcher, 'open').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('opens the app home with no target and hits no API', async () => {
    const calls = installMockFetch([])
    const run = await runCli(['open'])
    expect(run.code).toBe(0)
    expect(openSpy).toHaveBeenCalledWith(`${TEST_URL}/`)
    expect(run.stdout).toContain(`opening ${TEST_URL}/`)
    expect(calls).toHaveLength(0)
  })

  it('maps view keywords to view paths without an API call', async () => {
    const calls = installMockFetch([])
    const run = await runCli(['open', 'today'])
    expect(run.code).toBe(0)
    expect(openSpy).toHaveBeenCalledWith(`${TEST_URL}/today`)
    expect(calls).toHaveLength(0)
  })

  it('is case-insensitive for view keywords', async () => {
    const calls = installMockFetch([])
    const run = await runCli(['open', 'Inbox'])
    expect(run.code).toBe(0)
    expect(openSpy).toHaveBeenCalledWith(`${TEST_URL}/inbox`)
    expect(calls).toHaveLength(0)
  })

  it('resolves an exact task id via getTask', async () => {
    installMockFetch([
      { method: 'GET', path: '/api/v1/tasks/tsk_1', body: sampleTask({ id: 'tsk_1' }) },
    ])
    const run = await runCli(['open', 'tsk_1'])
    expect(run.code).toBe(0)
    expect(openSpy).toHaveBeenCalledWith(`${TEST_URL}/task/tsk_1`)
  })

  it('falls back to a UNIQUE fuzzy content match when the id 404s', async () => {
    installMockFetch([
      { method: 'GET', path: '/api/v1/tasks/report', status: 404, body: notFound },
      {
        method: 'GET',
        path: '/api/v1/tasks',
        body: page([sampleTask({ id: 'tsk_9', content: 'Submit report' })]),
      },
    ])
    const run = await runCli(['open', 'report'])
    expect(run.code).toBe(0)
    expect(openSpy).toHaveBeenCalledWith(`${TEST_URL}/task/tsk_9`)
  })

  it('errors (exit 1) and does NOT launch on an ambiguous match', async () => {
    installMockFetch([
      { method: 'GET', path: '/api/v1/tasks/report', status: 404, body: notFound },
      {
        method: 'GET',
        path: '/api/v1/tasks',
        body: page([
          sampleTask({ id: 'tsk_1', content: 'Submit report' }),
          sampleTask({ id: 'tsk_2', content: 'Report to the board' }),
        ]),
      },
    ])
    const run = await runCli(['open', 'report'])
    expect(run.code).toBe(1)
    expect(openSpy).not.toHaveBeenCalled()
    expect(run.stderr).toContain('tsk_1')
    expect(run.stderr).toContain('tsk_2')
    expect(run.stderr).toContain('ambiguous')
  })

  it('errors (exit 1) when no task matches', async () => {
    installMockFetch([
      { method: 'GET', path: '/api/v1/tasks/zzz', status: 404, body: notFound },
      { method: 'GET', path: '/api/v1/tasks', body: page([sampleTask({ content: 'Buy milk' })]) },
    ])
    const run = await runCli(['open', 'zzz'])
    expect(run.code).toBe(1)
    expect(openSpy).not.toHaveBeenCalled()
    expect(run.stderr).toContain('no task matching "zzz"')
  })

  it('prints JSON and does NOT launch with --json', async () => {
    const calls = installMockFetch([])
    const run = await runCli(['open', 'today', '--json'])
    expect(run.code).toBe(0)
    expect(openSpy).not.toHaveBeenCalled()
    expect(JSON.parse(run.stdout)).toEqual({ url: `${TEST_URL}/today` })
    expect(calls).toHaveLength(0)
  })
})
