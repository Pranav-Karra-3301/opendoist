import { and, eq } from 'drizzle-orm'
import { afterEach, expect, it } from 'vitest'
import { SettingsSchema } from './api/schemas'
import { account } from './db/auth-schema'
import { projects, userSettings } from './db/schema'
import { createTestApp, json, type TestApp } from './test/helpers'

let apps: TestApp[] = []
async function make(opts?: Parameters<typeof createTestApp>[0]): Promise<TestApp> {
  const t = await createTestApp(opts)
  apps.push(t)
  return t
}
afterEach(() => {
  for (const t of apps) t.close()
  apps = []
})

const SIGNUP = { name: 'Test', email: 'test@example.com', password: 'password1234' }
const signUp = (t: TestApp, body: Record<string, string>) =>
  t.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

it('signup issues a better-auth session cookie that get-session resolves', async () => {
  const t = await make({ signup: false })
  const res = await signUp(t, SIGNUP)
  expect(res.status).toBe(200)
  const setCookies = res.headers.getSetCookie()
  expect(setCookies.join('; ')).toContain('better-auth.session_token')

  const cookie = setCookies.map((v) => v.split(';')[0] ?? '').join('; ')
  const sessionRes = await t.request('/api/auth/get-session', { headers: { cookie } })
  expect(sessionRes.status).toBe(200)
  const session = await json<{ user: { email: string } } | null>(sessionRes)
  expect(session?.user.email).toBe('test@example.com')
})

it('stores the password as an argon2id hash', async () => {
  const t = await make()
  const rows = await t.deps.db.select().from(account).where(eq(account.userId, t.userId))
  const credential = rows.find((r) => r.password !== null)
  expect(credential?.password?.startsWith('$argon2id$')).toBe(true)
})

it('sign-in rejects a wrong password and accepts the correct one', async () => {
  const t = await make()
  const wrong = await t.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: SIGNUP.email, password: 'not-the-password' }),
  })
  expect(wrong.status).toBeGreaterThanOrEqual(400)
  expect(wrong.status).toBeLessThan(500)

  const ok = await t.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: SIGNUP.email, password: SIGNUP.password }),
  })
  expect(ok.status).toBe(200)
  const cookie = ok.headers
    .getSetCookie()
    .map((v) => v.split(';')[0] ?? '')
    .join('; ')
  const sessionRes = await t.request('/api/auth/get-session', { headers: { cookie } })
  const session = await json<{ user: { email: string } } | null>(sessionRes)
  expect(session?.user.email).toBe('test@example.com')
})

it('guard: an authenticated request to an unknown /api/v1 path is a 404 problem', async () => {
  const t = await make()
  const res = await t.get('/api/v1/__nonexistent')
  expect(res.status).toBe(404)
  expect(res.headers.get('content-type')).toContain('application/problem+json')
  const body = await json<{ title: string; status: number }>(res)
  expect(body.title).toBe('not found')
  expect(body.status).toBe(404)
})

it('guard: an unauthenticated request to an unknown /api/v1 path is a 401 problem', async () => {
  const t = await make({ signup: false })
  const res = await t.request('/api/v1/__nonexistent')
  expect(res.status).toBe(401)
  expect(res.headers.get('content-type')).toContain('application/problem+json')
  const body = await json<{ title: string; status: number }>(res)
  expect(body.title).toBe('unauthorized')
  expect(body.status).toBe(401)
})

it('locks registration after the first user by default', async () => {
  const t = await make()
  const res = await signUp(t, {
    name: 'Second',
    email: 'second@example.com',
    password: 'password1234',
  })
  expect(res.status).toBeGreaterThanOrEqual(400)
  expect(res.status).toBeLessThan(500)
})

it('allows registration when OPENDOIST_ALLOW_REGISTRATION is set', async () => {
  const t = await make({ env: { OPENDOIST_ALLOW_REGISTRATION: 'true' } })
  const res = await signUp(t, {
    name: 'Second',
    email: 'second@example.com',
    password: 'password1234',
  })
  expect(res.status).toBe(200)
})

it('seeds the first user with a single Inbox project and default settings', async () => {
  const t = await make()

  const inbox = await t.deps.db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, t.userId), eq(projects.isInbox, true)))
  expect(inbox).toHaveLength(1)
  expect(inbox[0]?.name).toBe('Inbox')

  const settingsRows = await t.deps.db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, t.userId))
  expect(settingsRows).toHaveLength(1)
  const stored: unknown = JSON.parse(settingsRows[0]?.settings ?? '{}')
  expect(stored).toEqual(SettingsSchema.parse({}))
})

it('mints od_ API keys whose scope gates writes through the guard', async () => {
  const t = await make()

  // Setting `permissions` server-side requires the server-only `userId` param, NOT `headers`:
  // better-auth 1.6's api-key plugin rejects `permissions` when it detects a client request
  // (any call carrying `headers`). Same behavior as the plan's headers call, installed signature.
  const readKey = await t.deps.auth.api.createApiKey({
    body: { name: 'cli', userId: t.userId, permissions: { opendoist: ['read'] } },
  })
  expect(readKey.key.startsWith('od_')).toBe(true)

  // Read scope authenticates: GET falls through to the not-found handler.
  const readGet = await t.request('/api/v1/__x', {
    headers: { authorization: `Bearer ${readKey.key}` },
  })
  expect(readGet.status).toBe(404)

  // Read scope may not write: POST is stopped by the guard with a scope problem.
  const readPost = await t.request('/api/v1/__x', {
    method: 'POST',
    headers: { authorization: `Bearer ${readKey.key}` },
  })
  expect(readPost.status).toBe(403)
  expect(readPost.headers.get('content-type')).toContain('application/problem+json')
  expect((await json<{ title: string }>(readPost)).title).toBe('insufficient scope')

  // Read-write scope passes the guard on writes: POST falls through to not-found.
  const rwKey = await t.deps.auth.api.createApiKey({
    body: { name: 'cli-rw', userId: t.userId, permissions: { opendoist: ['read', 'read_write'] } },
  })
  const rwPost = await t.request('/api/v1/__x', {
    method: 'POST',
    headers: { authorization: `Bearer ${rwKey.key}` },
  })
  expect(rwPost.status).toBe(404)
})

it('od_ keys keep authenticating past 10 requests (plugin default rate limit disabled)', async () => {
  const t = await make()
  // better-auth's api-key plugin defaults to rateLimit {enabled, 10 requests/day}; the 11th
  // verifyApiKey would throw RATE_LIMITED, which the bearer middleware reads as 401. Regression
  // for the phase-9 gate fix (`rateLimit: {enabled: false}` in auth.ts).
  const key = await t.deps.auth.api.createApiKey({
    body: { name: 'cli-busy', userId: t.userId, permissions: { opendoist: ['read'] } },
  })
  for (let i = 0; i < 12; i++) {
    const res = await t.request('/api/v1/tasks', {
      headers: { authorization: `Bearer ${key.key}` },
    })
    expect(res.status, `request ${i + 1} of 12`).toBe(200)
  }
})

it('HTTP-created API keys default to the explicit read-only permission shape', async () => {
  const t = await make()

  // Over the wire, better-auth rejects a client-supplied `permissions` (server-only property),
  // so the plugin's defaultPermissions must stamp the least-privilege contract shape instead.
  // better-auth CSRF checks demand a trusted Origin on cookie-authed POSTs.
  const created = await t.request('/api/auth/api-key/create', {
    method: 'POST',
    headers: {
      cookie: t.cookie,
      'content-type': 'application/json',
      origin: 'http://localhost:7968',
    },
    body: JSON.stringify({ name: 'cli-over-http' }),
  })
  expect(created.status).toBe(200)
  const key = await json<{ key: string; permissions: unknown }>(created)
  expect(key.key.startsWith('od_')).toBe(true)

  const verified = await t.deps.auth.api.verifyApiKey({ body: { key: key.key } })
  expect(verified.valid).toBe(true)
  const permissions =
    typeof verified.key?.permissions === 'string'
      ? (JSON.parse(verified.key.permissions) as unknown)
      : verified.key?.permissions
  expect(permissions).toEqual({ opendoist: ['read'] })

  // Scope gating over the wire: reads pass, writes are refused.
  const bearer = { authorization: `Bearer ${key.key}` }
  expect((await t.request('/api/v1/tasks', { headers: bearer })).status).toBe(200)
  const write = await t.request('/api/v1/tasks', {
    method: 'POST',
    headers: { ...bearer, 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'nope' }),
  })
  expect(write.status).toBe(403)
  expect((await json<{ title: string }>(write)).title).toBe('insufficient scope')
})

it('rejects a garbage od_ bearer token with 401', async () => {
  const t = await make()
  const res = await t.request('/api/v1/__x', {
    headers: { authorization: 'Bearer od_nope' },
  })
  expect(res.status).toBe(401)
  expect((await json<{ title: string }>(res)).title).toBe('unauthorized')
})

it('mounts the TOTP plugin: two-factor enable returns an otpauth URI', async () => {
  const t = await make()
  const res = await t.request('/api/auth/two-factor/enable', {
    method: 'POST',
    headers: { cookie: t.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ password: SIGNUP.password }),
  })
  expect(res.status).toBe(200)
  const body = await json<{ totpURI: string }>(res)
  expect(body.totpURI).toContain('otpauth://')
})

it('advertises the env-configured OIDC provider through /api/v1/info', async () => {
  const t = await make({
    signup: false,
    env: {
      OPENDOIST_OIDC_ISSUER: 'https://id.example.com',
      OPENDOIST_OIDC_CLIENT_ID: 'x',
      OPENDOIST_OIDC_CLIENT_SECRET: 'y',
      OPENDOIST_OIDC_NAME: 'Example',
    },
  })
  const res = await t.request('/api/v1/info')
  expect(res.status).toBe(200)
  const info = await json<{ auth_providers: { oidc: { name: string } | null } }>(res)
  expect(info.auth_providers.oidc?.name).toBe('Example')
})
