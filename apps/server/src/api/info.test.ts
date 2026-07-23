import { afterEach, expect, it } from 'vitest'
import { createTestApp, json, type TestApp } from '../test/helpers'
import { InfoDtoSchema } from './schemas'

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

it('GET /api/v1/info matches InfoDtoSchema on a fresh instance', async () => {
  const t = await make({ signup: false })
  const res = await t.request('/api/v1/info')
  expect(res.status).toBe(200)
  const info = InfoDtoSchema.parse(await json<unknown>(res))
  expect(info.first_run).toBe(true)
  expect(info.registration_open).toBe(true)
  expect(info.auth_providers.password).toBe(true)
  expect(info.auth_providers.oidc).toBeNull()
  expect(info.features).toEqual({ stt: false, llm: false, push: true })
  expect(info.available_importers).toEqual(['todoist-csv', 'todoist-api'])
  expect(info.update).toBeNull()
  expect(info.version.length).toBeGreaterThan(0)
})

it('GET /api/v1/info matches InfoDtoSchema after signup with registration locked', async () => {
  const t = await make()
  const res = await t.request('/api/v1/info')
  expect(res.status).toBe(200)
  const info = InfoDtoSchema.parse(await json<unknown>(res))
  expect(info.first_run).toBe(false)
  expect(info.registration_open).toBe(false)
  expect(info.features).toEqual({ stt: false, llm: false, push: true })
})

it('reports the OPENTASK_VERSION override verbatim', async () => {
  const t = await make({ signup: false, env: { OPENTASK_VERSION: '9.9.9' } })
  const res = await t.request('/api/v1/info')
  const info = InfoDtoSchema.parse(await json<unknown>(res))
  expect(info.version).toBe('9.9.9')
})

it('serves the API description without auth: /api/v1/docs (Scalar) and /api/v1/openapi.json', async () => {
  const t = await make({ signup: false })
  const docs = await t.request('/api/v1/docs')
  expect(docs.status).toBe(200)
  expect(await docs.text()).toContain('OpenTask')
  const spec = await t.request('/api/v1/openapi.json')
  expect(spec.status).toBe(200)
  const doc = await json<{ info: { title: string } }>(spec)
  expect(doc.info.title).toBe('OpenTask API')
})
