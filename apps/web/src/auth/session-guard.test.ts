/**
 * Regression tests for the offline-aware session guard (phase-10 review, HIGH):
 * a hard-offline reload used to crash into TanStack Router's default error screen
 * because the app-route `beforeLoad` let `authClient.getSession()`'s network-failure
 * rejection propagate — instead of rendering the precached shell + od-api cache.
 */
import { isRedirect } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { requireSessionOrOffline, type SessionProbeResult } from './session-guard'

/** Runs the guard and returns what it threw (null when it resolved). */
async function thrownBy(probe: () => Promise<SessionProbeResult>): Promise<unknown> {
  try {
    await requireSessionOrOffline(probe)
    return null
  } catch (err) {
    return err
  }
}

describe('requireSessionOrOffline', () => {
  it('lets a live session through', async () => {
    await expect(
      requireSessionOrOffline(async () => ({ data: { session: { id: 's1' } }, error: null })),
    ).resolves.toBeUndefined()
  })

  it('redirects to /login when the server answers with no session', async () => {
    const err = await thrownBy(async () => ({ data: null, error: null }))
    expect(isRedirect(err)).toBe(true)
    expect((err as { options: { to?: string } }).options.to).toBe('/login')
  })

  it('redirects to /login on a real auth error (401)', async () => {
    const err = await thrownBy(async () => ({ data: null, error: { status: 401 } }))
    expect(isRedirect(err)).toBe(true)
    expect((err as { options: { to?: string } }).options.to).toBe('/login')
  })

  it('keeps the cached shell when the session probe rejects (offline reload)', async () => {
    // Exactly what an offline reload produces: fetch rejects with a TypeError.
    await expect(
      requireSessionOrOffline(async () => {
        throw new TypeError('Failed to fetch')
      }),
    ).resolves.toBeUndefined()
  })

  it('keeps the cached shell on a network-shaped error result (status 0)', async () => {
    await expect(
      requireSessionOrOffline(async () => ({ data: null, error: { status: 0 } })),
    ).resolves.toBeUndefined()
  })
})
