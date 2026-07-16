import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OpenAPIHono } from '@hono/zod-openapi'
import { type AppDeps, type AppEnv, createApp } from '../app'
import { createAuth } from '../auth'
import { loadConfig } from '../config'
import { openDb } from '../db/db'
import { EventBus } from '../events/bus'
import { createLogger } from '../logger'
import { ensureDataDirAndSecrets } from '../secrets'

export interface TestApp {
  app: OpenAPIHono<AppEnv>
  deps: AppDeps
  dataDir: string
  cookie: string
  userId: string
  /** raw, no auth header */
  request(path: string, init?: RequestInit): Promise<Response>
  /** cookie-authed */
  get(path: string): Promise<Response>
  post(path: string, body?: unknown): Promise<Response>
  patch(path: string, body?: unknown): Promise<Response>
  del(path: string): Promise<Response>
  /** sqlite.close() + rmSync(dataDir) */
  close(): void
}

export async function createTestApp(opts?: {
  env?: Record<string, string>
  signup?: boolean
}): Promise<TestApp> {
  const dataDir = mkdtempSync(join(tmpdir(), 'opendoist-'))
  const config = loadConfig({
    OPENDOIST_DATA_DIR: dataDir,
    OPENDOIST_LOG_LEVEL: 'silent',
    ...opts?.env,
  })
  const secrets = ensureDataDirAndSecrets(config.dataDir)
  const { db, sqlite } = openDb(join(config.dataDir, 'opendoist.db'))
  const auth = createAuth(db, config, secrets.sessionSecret)
  const bus = new EventBus()
  const logger = createLogger(config)
  const deps: AppDeps = { config, db, sqlite, secrets, bus, auth, logger }
  const app = createApp(deps)

  let cookie = ''
  let userId = ''
  if (opts?.signup !== false) {
    const res = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test', email: 'test@example.com', password: 'password1234' }),
    })
    if (!res.ok) throw new Error(`test signup failed: ${res.status} ${await res.text()}`)
    cookie = res.headers
      .getSetCookie()
      .map((v) => v.split(';')[0] ?? '')
      .filter((v) => v.length > 0)
      .join('; ')
    const sessionRes = await app.request('/api/auth/get-session', { headers: { cookie } })
    const session = (await sessionRes.json()) as { user: { id: string } } | null
    if (!session) throw new Error('test signup produced no session')
    userId = session.user.id
  }

  const authed = (method: string) => async (path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  return {
    app,
    deps,
    dataDir,
    cookie,
    userId,
    request: async (path, init) => app.request(path, init),
    get: async (path) =>
      app.request(path, { headers: { cookie, 'content-type': 'application/json' } }),
    post: authed('POST'),
    patch: authed('PATCH'),
    del: authed('DELETE'),
    close: () => {
      sqlite.close()
      rmSync(dataDir, { recursive: true, force: true })
    },
  }
}

export async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}
