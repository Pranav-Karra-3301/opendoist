import { OpenAPIHono } from '@hono/zod-openapi'
import { eq } from 'drizzle-orm'
import { afterEach, expect, it } from 'vitest'
import type { AppEnv } from '../app'
import { providerSettings } from '../db/schema'
import { decryptSecret } from '../lib/secret-crypto'
import { createTestApp, type TestApp } from '../test/helpers'
import { type IntegrationsRoutesDeps, integrationsRoutes } from './integrations-routes'
import type { FetchLike } from './providers/types'
import { IntegrationsGetSchema } from './schemas'

// secret-crypto's getEncryptionKey() resolves the data dir from the environment (boot path); each
// test points OPENTASK_DATA_DIR at its temp dir so encryption uses the same secrets.json the app
// deps loaded, and restores the original afterwards.
const ORIGINAL_DATA_DIR = process.env.OPENTASK_DATA_DIR

let apps: TestApp[] = []
async function make(env?: Record<string, string>): Promise<TestApp> {
  const t = await createTestApp(env ? { env } : undefined)
  apps.push(t)
  process.env.OPENTASK_DATA_DIR = t.dataDir
  return t
}
afterEach(() => {
  for (const t of apps) t.close()
  apps = []
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.OPENTASK_DATA_DIR
  else process.env.OPENTASK_DATA_DIR = ORIGINAL_DATA_DIR
})

/**
 * Mount the integrations routes on a minimal app that injects the real test deps + a fixed authed
 * user (Task N wires the real /api/v1 stack; here we exercise the route module in isolation with an
 * injectable mock fetch). No cookie needed — auth is set directly in middleware.
 */
function mountApp(t: TestApp, routeDeps?: IntegrationsRoutesDeps): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('deps', t.deps)
    c.set('auth', { userId: t.userId, via: 'session', scope: 'read_write' })
    await next()
  })
  app.route('/api/v1', integrationsRoutes(routeDeps))
  return app
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

it('GET /settings/integrations returns the all-none default for a fresh user', async () => {
  const t = await make()
  const app = mountApp(t)
  const res = await app.request('/api/v1/settings/integrations')
  expect(res.status).toBe(200)
  const body = IntegrationsGetSchema.parse(await res.json())
  const none = { provider: null, baseUrl: null, model: null, hasApiKey: false, source: 'none' }
  expect(body.stt).toEqual(none)
  expect(body.llm).toEqual(none)
})

it('PUT stores an encrypted key; GET reports it without ever exposing key material', async () => {
  const t = await make()
  const app = mountApp(t)
  const plaintext = 'sk-super-secret-key-1234567890'

  const putRes = await app.request(
    '/api/v1/settings/integrations',
    jsonInit('PUT', {
      stt: {
        provider: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-4o-mini-transcribe',
        apiKey: plaintext,
      },
    }),
  )
  expect(putRes.status).toBe(204)

  // The stored column is a crypto envelope, never the plaintext, and round-trips back.
  const row = t.deps.db
    .select()
    .from(providerSettings)
    .where(eq(providerSettings.userId, t.userId))
    .get()
  const envelope = row?.sttApiKeyEnc
  expect(typeof envelope).toBe('string')
  expect(envelope).not.toContain(plaintext)
  const key = Buffer.from(t.deps.secrets.encryptionKey, 'base64url')
  expect(decryptSecret(envelope as string, key)).toBe(plaintext)

  // GET reflects the saved slot; the response body leaks neither the plaintext nor the envelope.
  const getRes = await app.request('/api/v1/settings/integrations')
  const raw = await getRes.text()
  expect(raw).not.toContain(plaintext)
  expect(raw).not.toContain(envelope as string)
  const body = IntegrationsGetSchema.parse(JSON.parse(raw))
  expect(body.stt.provider).toBe('openai-compatible')
  expect(body.stt.baseUrl).toBe('https://api.example.com/v1')
  expect(body.stt.model).toBe('gpt-4o-mini-transcribe')
  expect(body.stt.hasApiKey).toBe(true)
  expect(body.stt.source).toBe('user')
})

it('POST stt/test runs the candidate config through the injected fetch and reports success', async () => {
  const t = await make()
  const calls: { url: string; hasAuth: boolean }[] = []
  const mockFetch: FetchLike = async (input, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    calls.push({
      url: typeof input === 'string' ? input : input.toString(),
      hasAuth: typeof headers.Authorization === 'string',
    })
    return new Response(JSON.stringify({ text: '' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  const app = mountApp(t, { fetchImpl: mockFetch })

  const res = await app.request(
    '/api/v1/settings/integrations/stt/test',
    jsonInit('POST', {
      candidate: {
        provider: 'openai-compatible',
        baseUrl: 'https://stt.example.com/v1',
        model: 'gpt-4o-mini-transcribe',
        apiKey: 'sk-test',
      },
    }),
  )
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true, detail: '(empty transcript — connection OK)' })
  expect(calls).toHaveLength(1)
  expect(calls[0]?.url).toBe('https://stt.example.com/v1/audio/transcriptions')
  expect(calls[0]?.hasAuth).toBe(true)
})

it('POST stt/test returns the provider error as data with HTTP 200', async () => {
  const t = await make()
  const mockFetch: FetchLike = async () => new Response('nope', { status: 401 })
  const app = mountApp(t, { fetchImpl: mockFetch })

  const res = await app.request(
    '/api/v1/settings/integrations/stt/test',
    jsonInit('POST', {
      candidate: {
        provider: 'openai-compatible',
        baseUrl: 'https://stt.example.com/v1',
        model: 'gpt-4o-mini-transcribe',
        apiKey: 'sk-test',
      },
    }),
  )
  expect(res.status).toBe(200)
  const body = (await res.json()) as { ok: boolean; detail: string }
  expect(body.ok).toBe(false)
  expect(body.detail).toContain('401')
})

it('POST llm/test with the `none` provider reports extraction disabled (no network)', async () => {
  const t = await make()
  let called = false
  const app = mountApp(t, {
    fetchImpl: async () => {
      called = true
      return new Response('{}', { status: 200 })
    },
  })

  const res = await app.request(
    '/api/v1/settings/integrations/llm/test',
    jsonInit('POST', { candidate: { provider: 'none', baseUrl: null, model: null } }),
  )
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    ok: true,
    detail: 'Extraction disabled — rambles become a single task',
  })
  expect(called).toBe(false)
})

it('POST llm/test with no candidate and no configured provider reports disabled', async () => {
  const t = await make()
  const app = mountApp(t)
  const res = await app.request('/api/v1/settings/integrations/llm/test', jsonInit('POST', {}))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    ok: true,
    detail: 'Extraction disabled — rambles become a single task',
  })
})

it('PUT rejects an invalid provider id with an RFC 9457 problem (400)', async () => {
  const t = await make()
  const app = mountApp(t)
  const res = await app.request(
    '/api/v1/settings/integrations',
    jsonInit('PUT', { stt: { provider: 'not-a-provider', baseUrl: null, model: null } }),
  )
  expect(res.status).toBe(400)
  expect(res.headers.get('content-type')).toContain('application/problem+json')
  const body = (await res.json()) as { title: string }
  expect(body.title).toBe('validation failed')
})
