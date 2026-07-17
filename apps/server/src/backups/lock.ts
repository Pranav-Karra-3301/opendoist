/**
 * App-level maintenance lock (phase 9 Task A — REAL, not a stub). A restore swaps the live
 * database file out from under every other request, so while `withMaintenanceLock` runs the
 * whole API (except /api/health) answers 503 via `maintenanceGuard`.
 */
import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from '../app'
import { problem } from '../lib/problem'

let locked = false

export function isMaintenanceLocked(): boolean {
  return locked
}

/**
 * Run `fn` holding the exclusive maintenance lock. Throws a 409 HTTPException (the app's onError
 * turns it into problem JSON) when the lock is already held; always unlocks in `finally`.
 */
export async function withMaintenanceLock<T>(fn: () => Promise<T>): Promise<T> {
  if (locked) {
    throw new HTTPException(409, { message: 'a restore is already in progress' })
  }
  locked = true
  try {
    return await fn()
  } finally {
    locked = false
  }
}

/**
 * While the lock is held every path except /api/health answers 503 problem JSON. Mounted in
 * app.ts after the health route and before better-auth/api routes/static SPA.
 */
export const maintenanceGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (locked && c.req.path !== '/api/health') {
    return problem(c, 503, 'Maintenance in progress', 'A backup restore is running; retry shortly.')
  }
  return next()
}
