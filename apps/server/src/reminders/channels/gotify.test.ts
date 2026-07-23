import type { Priority } from '@opentask/core'
import { describe, expect, type Mock, test, vi } from 'vitest'
import type { ChannelDeps, GotifyConfig, ReminderPayload } from '../contracts'
import { gotifyAdapter } from './gotify'

function makePayload(over: Partial<ReminderPayload> = {}): ReminderPayload {
  return {
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
    ...over,
  }
}

function makeDeps(fetch: ChannelDeps['fetch']): { deps: ChannelDeps; log: Mock } {
  const log = vi.fn()
  return { deps: { fetch, sleep: vi.fn(async () => undefined), log }, log }
}

const config: GotifyConfig = { server: 'https://gotify.example.com/', app_token: 'AbC123token' }

describe('gotifyAdapter', () => {
  test('type and configSchema are wired to the gotify contract', () => {
    expect(gotifyAdapter.type).toBe('gotify')
    expect(gotifyAdapter.configSchema.safeParse(config).success).toBe(true)
  })

  test('POSTs an exact /message request and returns delivered on ok', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('', { status: 200 }),
    )
    const { deps, log } = makeDeps(fetchMock as unknown as ChannelDeps['fetch'])

    const outcome = await gotifyAdapter.send(makePayload(), config, deps)

    expect(outcome).toBe('delivered')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? ['', undefined]
    // trailing slash on server is trimmed before joining /message
    expect(url).toBe('https://gotify.example.com/message')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({
      'content-type': 'application/json',
      'x-gotify-key': 'AbC123token',
    })
    expect(JSON.parse(init?.body as string)).toEqual({
      title: 'Renew passport',
      message: 'Due today at 17:00',
      priority: 8,
      extras: { 'client::notification': { click: { url: 'http://localhost:7968/task/t1' } } },
    })
    // 10 s timeout guard is attached
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(log).not.toHaveBeenCalled()
  })

  test('joins /message onto a server with no trailing slash', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('', { status: 200 }),
    )
    const { deps } = makeDeps(fetchMock as unknown as ChannelDeps['fetch'])

    await gotifyAdapter.send(
      makePayload(),
      { server: 'https://g.example.com', app_token: 't' },
      deps,
    )

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://g.example.com/message')
  })

  test('maps every OpenTask priority to the frozen Gotify importance', async () => {
    const cases: Array<[Priority, number]> = [
      [1, 8],
      [2, 6],
      [3, 4],
      [4, 2],
    ]
    for (const [priority, expected] of cases) {
      const fetchMock = vi.fn(
        async (_url: string, _init?: RequestInit) => new Response('', { status: 200 }),
      )
      const { deps } = makeDeps(fetchMock as unknown as ChannelDeps['fetch'])
      await gotifyAdapter.send(makePayload({ priority }), config, deps)
      const body = fetchMock.mock.calls[0]?.[1]?.body
      expect(JSON.parse(body as string).priority).toBe(expected)
    }
  })

  test('returns error and logs on a non-ok response (401)', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('unauthorized', { status: 401 }),
    )
    const { deps, log } = makeDeps(fetchMock as unknown as ChannelDeps['fetch'])

    const outcome = await gotifyAdapter.send(makePayload(), config, deps)

    expect(outcome).toBe('error')
    expect(log).toHaveBeenCalledWith(
      'warn',
      expect.any(String),
      expect.objectContaining({ status: 401 }),
    )
  })

  test('returns error and logs when fetch rejects (network failure)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    const { deps, log } = makeDeps(fetchMock as unknown as ChannelDeps['fetch'])

    const outcome = await gotifyAdapter.send(makePayload(), config, deps)

    expect(outcome).toBe('error')
    expect(log).toHaveBeenCalledWith(
      'warn',
      expect.any(String),
      expect.objectContaining({ error: expect.stringContaining('ECONNREFUSED') }),
    )
    // single attempt, no retries
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
