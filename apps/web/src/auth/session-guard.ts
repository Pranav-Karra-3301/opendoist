/**
 * Offline-aware session guard for the app layout route (router.tsx `beforeLoad`).
 *
 * `/api/auth/get-session` is deliberately excluded from the service worker's runtime
 * cache (sw.ts caches only GET /api/v1/* reads), so when the server is unreachable the
 * probe FAILS instead of answering stale. That failure means "can't reach the server",
 * NOT "logged out": the session cookie may still be perfectly valid, and the precached
 * app shell plus the od-api cache can render the last-seen data (spec §3.3 offline
 * read). So a network-level failure lets the navigation through; redirecting to /login
 * would strand the user on a useless login form, and rethrowing would surface TanStack
 * Router's raw error screen over a fully renderable cached view (the phase-10 review
 * finding this file exists to prevent).
 *
 * Only a real server answer without a session redirects to /login. Network failures
 * appear either as a rejected promise (fetch `TypeError`) or, from better-fetch, as a
 * resolved result whose error carries `status: 0` — both are treated as offline.
 */
import { redirect } from '@tanstack/react-router'

/** Structural subset of `authClient.getSession()`'s resolved value. */
export interface SessionProbeResult {
  data: { session: unknown } | null
  error: { status: number } | null
}

export async function requireSessionOrOffline(
  probe: () => Promise<SessionProbeResult>,
): Promise<void> {
  let result: SessionProbeResult
  try {
    result = await probe()
  } catch {
    // Network failure (e.g. offline reload): keep the cached shell.
    return
  }
  if (result.data?.session) return
  // better-fetch reports "no HTTP response at all" as status 0 — same offline treatment.
  if (result.error !== null && result.error.status === 0) return
  throw redirect({ to: '/login' })
}
