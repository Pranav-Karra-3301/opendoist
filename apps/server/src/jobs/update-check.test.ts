import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compareSemver } from './update-check'

/** Minimal `Response` stand-in — checkForUpdate only reads `ok`, `status`, and `json()`. */
function fakeFetch(spec: {
  ok?: boolean
  status?: number
  body?: unknown
  throws?: boolean
  onCall?: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => void
}): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    spec.onCall?.(input, init)
    if (spec.throws) throw new Error('network down')
    return {
      ok: spec.ok ?? true,
      status: spec.status ?? 200,
      json: async () => spec.body,
    } as Response
  }) as unknown as typeof fetch
}

describe('compareSemver', () => {
  it.each<[string, string, -1 | 0 | 1]>([
    ['0.2.0', '0.1.9', 1],
    ['0.1.9', '0.2.0', -1],
    ['1.0.0', '0.9.9', 1],
    ['v1.2', '1.2.0', 0],
    ['1.2.0', 'v1.2', 0],
    ['1.2.3', '1.2.3', 0],
    ['1.2.3-dev', '1.2.3', 0], // prerelease suffix ignored
    ['2.0.0', '1.9.9', 1],
    ['0.1.0', '0.1.0-dev', 0], // release vs -dev build of the same version
  ])('compareSemver(%s, %s) === %i', (a, b, expected) => {
    expect(compareSemver(a, b)).toBe(expected)
  })
})

describe('checkForUpdate', () => {
  // Fresh module (fresh cached state) per test so the "state unchanged" assertions are isolated.
  beforeEach(() => {
    vi.resetModules()
  })

  it('requests the releases endpoint with the documented headers', async () => {
    const { checkForUpdate } = await import('./update-check')
    let seenUrl: unknown
    let seenInit: RequestInit | undefined
    await checkForUpdate(
      '0.1.0',
      fakeFetch({
        body: { tag_name: 'v0.2.0', html_url: 'https://example/rel' },
        onCall: (u, i) => {
          seenUrl = u
          seenInit = i
        },
      }),
    )
    expect(seenUrl).toBe('https://api.github.com/repos/pranav-karra-3301/opentask/releases/latest')
    const headers = seenInit?.headers as Record<string, string>
    expect(headers.Accept).toBe('application/vnd.github+json')
    expect(headers['User-Agent']).toBe('opentask/0.1.0')
  })

  it('flags an available update for a newer tag (strips the v prefix)', async () => {
    const { checkForUpdate, getUpdateState } = await import('./update-check')
    const state = await checkForUpdate(
      '0.1.0',
      fakeFetch({ body: { tag_name: 'v0.2.0', html_url: 'https://example/rel/0.2.0' } }),
    )
    expect(state).not.toBeNull()
    expect(state?.updateAvailable).toBe(true)
    expect(state?.latestVersion).toBe('0.2.0')
    expect(state?.url).toBe('https://example/rel/0.2.0')
    expect(typeof state?.checkedAt).toBe('string')
    expect(getUpdateState()).toEqual(state)
  })

  it('reports no update when the latest tag equals the current version', async () => {
    const { checkForUpdate } = await import('./update-check')
    const state = await checkForUpdate(
      '0.2.0',
      fakeFetch({ body: { tag_name: '0.2.0', html_url: 'u' } }),
    )
    expect(state?.updateAvailable).toBe(false)
    expect(state?.latestVersion).toBe('0.2.0')
  })

  it('reports no update when the latest tag is older than the current version', async () => {
    const { checkForUpdate } = await import('./update-check')
    const state = await checkForUpdate(
      '0.3.0',
      fakeFetch({ body: { tag_name: 'v0.2.0', html_url: 'u' } }),
    )
    expect(state?.updateAvailable).toBe(false)
  })

  it('keeps the previous state on a non-200 response', async () => {
    const { checkForUpdate, getUpdateState } = await import('./update-check')
    const good = await checkForUpdate(
      '0.1.0',
      fakeFetch({ body: { tag_name: 'v0.2.0', html_url: 'u' } }),
    )
    const after = await checkForUpdate('0.1.0', fakeFetch({ ok: false, status: 500 }))
    expect(after).toEqual(good)
    expect(getUpdateState()).toEqual(good)
  })

  it('keeps the previous state on a network error', async () => {
    const { checkForUpdate, getUpdateState } = await import('./update-check')
    const good = await checkForUpdate(
      '0.1.0',
      fakeFetch({ body: { tag_name: 'v0.2.0', html_url: 'u' } }),
    )
    const after = await checkForUpdate('0.1.0', fakeFetch({ throws: true }))
    expect(after).toEqual(good)
    expect(getUpdateState()).toEqual(good)
  })

  it('returns null (no crash) when the first-ever check fails and there is no prior state', async () => {
    const { checkForUpdate, getUpdateState } = await import('./update-check')
    const state = await checkForUpdate('0.1.0', fakeFetch({ ok: false, status: 503 }))
    expect(state).toBeNull()
    expect(getUpdateState()).toBeNull()
  })
})
