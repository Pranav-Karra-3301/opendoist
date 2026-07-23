import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
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

it('GET /api/health returns ok', async () => {
  const t = await make({ signup: false })
  const res = await t.request('/api/health')
  expect(res.status).toBe(200)
  expect(await json(res)).toEqual({ status: 'ok' })
})

it('fresh instance: /api/v1/info reports first_run and open registration', async () => {
  const t = await make({ signup: false })
  const res = await t.request('/api/v1/info')
  expect(res.status).toBe(200)
  const info = await json<{
    first_run: boolean
    registration_open: boolean
    available_importers: string[]
  }>(res)
  expect(info.first_run).toBe(true)
  expect(info.registration_open).toBe(true)
  expect(info.available_importers).toEqual(['todoist-csv', 'todoist-api'])
})

it('after signup: first_run false and registration locked by default', async () => {
  const t = await make()
  const res = await t.request('/api/v1/info')
  const info = await json<{ first_run: boolean; registration_open: boolean }>(res)
  expect(info.first_run).toBe(false)
  expect(info.registration_open).toBe(false)
})

it('GET /api/v1/openapi.json serves the OpenAPI document', async () => {
  const t = await make()
  const res = await t.get('/api/v1/openapi.json')
  expect(res.status).toBe(200)
  const doc = await json<{ info: { title: string } }>(res)
  expect(doc.info.title).toBe('OpenTask API')
})

it('GET /api/v1/docs serves Scalar HTML', async () => {
  const t = await make()
  const res = await t.get('/api/v1/docs')
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/html')
  expect(await res.text()).toContain('/api/v1/openapi.json')
})

it('unauthenticated /api/v1/tasks is a 401 problem', async () => {
  const t = await make({ signup: false })
  const res = await t.request('/api/v1/tasks')
  expect(res.status).toBe(401)
  expect(res.headers.get('content-type')).toContain('application/problem+json')
  const body = await json<{ title: string; status: number }>(res)
  expect(body.title).toBe('unauthorized')
  expect(body.status).toBe(401)
})

it('unhandled route errors surface as RFC 9457 problem JSON, not a bare 500', async () => {
  const t = await make({ signup: false })
  // Register a throwing route AFTER createApp: outside /api it dodges the /api/* 404 catch-all.
  t.app.get('/boom', () => {
    throw new Error('sqlite exploded (secret detail)')
  })
  const res = await t.request('/boom')
  expect(res.status).toBe(500)
  expect(res.headers.get('content-type')).toContain('application/problem+json')
  const body = await json<{ title: string; detail?: string }>(res)
  expect(body.title).toBe('internal error')
  // Driver/internal error messages must not leak to clients.
  expect(JSON.stringify(body)).not.toContain('secret detail')
})

it('secrets.json is created with all four keys', async () => {
  const t = await make({ signup: false })
  const secrets = JSON.parse(readFileSync(join(t.dataDir, 'secrets.json'), 'utf8')) as Record<
    string,
    string
  >
  expect(Object.keys(secrets).sort()).toEqual([
    'encryptionKey',
    'sessionSecret',
    'vapidPrivateKey',
    'vapidPublicKey',
  ])
})
