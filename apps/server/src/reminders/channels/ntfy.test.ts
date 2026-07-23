import type { Priority } from '@opentask/core'
import { describe, expect, it, vi } from 'vitest'
import type { ChannelDeps, NtfyConfig, ReminderPayload } from '../contracts'
import { ntfyAdapter } from './ntfy'

/** Minimal fake of the fields the adapter reads off a fetch Response. */
function fakeResponse(status = 200): Response {
  return { ok: status >= 200 && status < 300, status } as unknown as Response
}

const basePayload: ReminderPayload = {
  title: 'Renew passport',
  body: 'Due today at 17:00',
  url: 'http://localhost:7968/task/t1',
  tag: 'reminder-r1',
  task_id: 't1',
  reminder_id: 'r1',
  fired_at: '2026-07-16T20:30:00.000Z',
  priority: 1,
  due: { date: '2026-07-16', time: '17:00' },
  test: false,
}

function makeDeps(fetchImpl: ChannelDeps['fetch']): {
  deps: ChannelDeps
  log: ReturnType<typeof vi.fn>
} {
  const log = vi.fn()
  return { deps: { fetch: fetchImpl, sleep: async () => {}, log }, log }
}

function resolvingFetch(status = 200) {
  return vi.fn((_input: unknown, _init?: RequestInit) => Promise.resolve(fakeResponse(status)))
}

/** Read the (url, init) of the first fetch call, asserting one happened. */
function firstFetchCall(mock: ReturnType<typeof resolvingFetch>): {
  url: unknown
  init: RequestInit | undefined
} {
  const call = mock.mock.calls[0]
  if (!call) throw new Error('fetch was not called')
  return { url: call[0], init: call[1] }
}

describe('ntfyAdapter', () => {
  it('is registered as the ntfy adapter', () => {
    expect(ntfyAdapter.type).toBe('ntfy')
  })

  it('POSTs the frozen JSON body to the server root with bearer auth (p1)', async () => {
    const fetchMock = resolvingFetch()
    const { deps } = makeDeps(fetchMock as unknown as ChannelDeps['fetch'])
    const config: NtfyConfig = {
      server: 'https://ntfy.example.com',
      topic: 'my-topic',
      token: 'tk_abc',
    }

    const outcome = await ntfyAdapter.send(basePayload, config, deps)

    expect(outcome).toBe('delivered')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const { url, init } = firstFetchCall(fetchMock)
    // server ROOT — topic travels in the JSON body, not the path
    expect(url).toBe('https://ntfy.example.com')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer tk_abc',
    })
    expect(init?.body).toBe(
      '{"topic":"my-topic","title":"Renew passport","message":"Due today at 17:00","priority":5,"click":"http://localhost:7968/task/t1","tags":["bell"]}',
    )
  })

  it('omits the authorization header when no token is configured', async () => {
    const fetchMock = resolvingFetch()
    const { deps } = makeDeps(fetchMock as unknown as ChannelDeps['fetch'])
    const config: NtfyConfig = { server: 'https://ntfy.sh', topic: 'secret-topic' }

    const outcome = await ntfyAdapter.send(basePayload, config, deps)

    expect(outcome).toBe('delivered')
    const { init } = firstFetchCall(fetchMock)
    expect(init?.headers).toEqual({ 'content-type': 'application/json' })
    expect(init?.headers).not.toHaveProperty('authorization')
  })

  const priorityCases: Array<[Priority, number]> = [
    [1, 5],
    [2, 4],
    [3, 3],
    [4, 3],
  ]
  it.each(priorityCases)('maps OpenTask priority p%i to ntfy priority %i', async (p, expected) => {
    const fetchMock = resolvingFetch()
    const { deps } = makeDeps(fetchMock as unknown as ChannelDeps['fetch'])
    const config: NtfyConfig = { server: 'https://ntfy.sh', topic: 't' }

    await ntfyAdapter.send({ ...basePayload, priority: p }, config, deps)

    const { init } = firstFetchCall(fetchMock)
    const parsed = JSON.parse(String(init?.body)) as { priority: number }
    expect(parsed.priority).toBe(expected)
  })

  it('attaches an abort signal so the request times out', async () => {
    const fetchMock = resolvingFetch()
    const { deps } = makeDeps(fetchMock as unknown as ChannelDeps['fetch'])
    const config: NtfyConfig = { server: 'https://ntfy.sh', topic: 't' }

    await ntfyAdapter.send(basePayload, config, deps)

    const { init } = firstFetchCall(fetchMock)
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('returns error and warns on a non-ok response (403)', async () => {
    const fetchMock = resolvingFetch(403)
    const { deps, log } = makeDeps(fetchMock as unknown as ChannelDeps['fetch'])
    const config: NtfyConfig = { server: 'https://ntfy.sh', topic: 't', token: 'bad' }

    const outcome = await ntfyAdapter.send(basePayload, config, deps)

    expect(outcome).toBe('error')
    expect(log).toHaveBeenCalledWith(
      'warn',
      expect.any(String),
      expect.objectContaining({ status: 403 }),
    )
  })

  it('returns error and warns when the request rejects', async () => {
    const fetchMock = vi.fn((_input: unknown, _init?: RequestInit) =>
      Promise.reject(new Error('network down')),
    )
    const { deps, log } = makeDeps(fetchMock as unknown as ChannelDeps['fetch'])
    const config: NtfyConfig = { server: 'https://ntfy.sh', topic: 't' }

    const outcome = await ntfyAdapter.send(basePayload, config, deps)

    expect(outcome).toBe('error')
    expect(log).toHaveBeenCalledWith('warn', expect.any(String), expect.anything())
  })

  it('does not retry on failure (single fetch call)', async () => {
    const fetchMock = resolvingFetch(500)
    const { deps } = makeDeps(fetchMock as unknown as ChannelDeps['fetch'])
    const config: NtfyConfig = { server: 'https://ntfy.sh', topic: 't' }

    await ntfyAdapter.send(basePayload, config, deps)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
