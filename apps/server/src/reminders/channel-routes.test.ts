import { eq } from 'drizzle-orm'
import { afterEach, expect, it, vi } from 'vitest'
import { notificationChannels } from '../db/schema'
import { sendToChannel } from './channels/index'
import type { ChannelDto } from './contracts'
import { createTestApp, json, type TestApp } from './test-helpers'

// Mock ONLY the registry send-fn so this task stays independent of the F/G/H adapters; keep
// defaultChannelDeps real so the route wires them exactly as production does.
vi.mock('./channels/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./channels/index')>()
  return { ...actual, sendToChannel: vi.fn() }
})

type ListDto = { results: ChannelDto[] }

const ntfyBody = { type: 'ntfy', name: 'phone', config: { topic: 'alerts' } }
const gotifyBody = {
  type: 'gotify',
  name: 'home',
  config: { server: 'https://gotify.example.com', app_token: 'AzTok123' },
}
const webhookBody = {
  type: 'webhook',
  name: 'HA',
  config: { url: 'https://ha.example.com/hook', secret: 'supersecret' },
}

let apps: TestApp[] = []
async function make(): Promise<TestApp> {
  const t = await createTestApp()
  apps.push(t)
  return t
}
afterEach(() => {
  for (const t of apps) t.close()
  apps = []
  vi.clearAllMocks()
})

it('GET /channels returns an empty {results} envelope initially', async () => {
  const t = await make()
  const res = await t.get('/api/v1/channels')
  expect(res.status).toBe(200)
  const body = await json<ListDto>(res)
  expect(body.results).toEqual([])
})

it('POST /channels creates an ntfy channel and applies the ntfy.sh server default', async () => {
  const t = await make()
  const res = await t.post('/api/v1/channels', ntfyBody)
  expect(res.status).toBe(201)
  const ch = await json<ChannelDto>(res)
  expect(ch.id).toBeTruthy()
  expect(ch.type).toBe('ntfy')
  expect(ch.name).toBe('phone')
  expect(ch.enabled).toBe(true)
  expect(ch.consecutive_failures).toBe(0)
  expect(ch.disabled_reason).toBeNull()
  expect(ch.config).toEqual({ server: 'https://ntfy.sh', topic: 'alerts' })

  const list = await json<ListDto>(await t.get('/api/v1/channels'))
  expect(list.results).toHaveLength(1)
  expect(list.results[0]?.id).toBe(ch.id)
})

it('POST /channels round-trips gotify and webhook configs verbatim', async () => {
  const t = await make()
  const gotify = await json<ChannelDto>(await t.post('/api/v1/channels', gotifyBody))
  expect(gotify.type).toBe('gotify')
  expect(gotify.config).toEqual({ server: 'https://gotify.example.com', app_token: 'AzTok123' })

  const webhook = await json<ChannelDto>(await t.post('/api/v1/channels', webhookBody))
  expect(webhook.type).toBe('webhook')
  expect(webhook.config).toEqual({ url: 'https://ha.example.com/hook', secret: 'supersecret' })

  const list = await json<ListDto>(await t.get('/api/v1/channels'))
  expect(list.results).toHaveLength(2)
})

it('POST /channels rejects a mismatched discriminated-union body (gotify type + ntfy config)', async () => {
  const t = await make()
  const res = await t.post('/api/v1/channels', {
    type: 'gotify',
    name: 'oops',
    config: { server: 'https://ntfy.sh', topic: 'alerts' },
  })
  expect(res.status).toBe(400)
})

it('POST /channels rejects a webhook secret shorter than 8 chars', async () => {
  const t = await make()
  const res = await t.post('/api/v1/channels', {
    type: 'webhook',
    name: 'HA',
    config: { url: 'https://ha.example.com/hook', secret: 'short' },
  })
  expect(res.status).toBe(400)
})

it('PATCH /channels/:id renames and toggles enabled', async () => {
  const t = await make()
  const ch = await json<ChannelDto>(await t.post('/api/v1/channels', ntfyBody))
  const res = await t.patch(`/api/v1/channels/${ch.id}`, { name: 'work phone', enabled: false })
  expect(res.status).toBe(200)
  const updated = await json<ChannelDto>(res)
  expect(updated.name).toBe('work phone')
  expect(updated.enabled).toBe(false)
})

it('PATCH /channels/:id rejects a config that does not match the row type', async () => {
  const t = await make()
  const ch = await json<ChannelDto>(await t.post('/api/v1/channels', ntfyBody))
  // gotify-shaped config onto an ntfy channel → 400
  const res = await t.patch(`/api/v1/channels/${ch.id}`, {
    config: { server: 'https://gotify.example.com', app_token: 'AzTok123' },
  })
  expect(res.status).toBe(400)
})

it('PATCH enabled:true resets the failure counter and clears the disabled reason', async () => {
  const t = await make()
  const ch = await json<ChannelDto>(await t.post('/api/v1/channels', webhookBody))
  t.deps.db
    .update(notificationChannels)
    .set({
      consecutiveFailures: 9,
      disabledReason: 'Disabled automatically after 10 consecutive delivery failures',
      enabled: false,
    })
    .where(eq(notificationChannels.id, ch.id))
    .run()

  const updated = await json<ChannelDto>(
    await t.patch(`/api/v1/channels/${ch.id}`, { enabled: true }),
  )
  expect(updated.enabled).toBe(true)
  expect(updated.consecutive_failures).toBe(0)
  expect(updated.disabled_reason).toBeNull()
})

it('PATCH with a config change resets the failure counter', async () => {
  const t = await make()
  const ch = await json<ChannelDto>(await t.post('/api/v1/channels', ntfyBody))
  t.deps.db
    .update(notificationChannels)
    .set({ consecutiveFailures: 4 })
    .where(eq(notificationChannels.id, ch.id))
    .run()

  const updated = await json<ChannelDto>(
    await t.patch(`/api/v1/channels/${ch.id}`, { config: { topic: 'newtopic' } }),
  )
  expect(updated.config).toEqual({ server: 'https://ntfy.sh', topic: 'newtopic' })
  expect(updated.consecutive_failures).toBe(0)
})

it('PATCH that only renames leaves the failure counter untouched', async () => {
  const t = await make()
  const ch = await json<ChannelDto>(await t.post('/api/v1/channels', webhookBody))
  t.deps.db
    .update(notificationChannels)
    .set({ consecutiveFailures: 3 })
    .where(eq(notificationChannels.id, ch.id))
    .run()

  const updated = await json<ChannelDto>(
    await t.patch(`/api/v1/channels/${ch.id}`, { name: 'renamed' }),
  )
  expect(updated.name).toBe('renamed')
  expect(updated.consecutive_failures).toBe(3)
})

it('DELETE /channels/:id removes the row (second delete → 404)', async () => {
  const t = await make()
  const ch = await json<ChannelDto>(await t.post('/api/v1/channels', ntfyBody))
  expect((await t.del(`/api/v1/channels/${ch.id}`)).status).toBe(204)
  const list = await json<ListDto>(await t.get('/api/v1/channels'))
  expect(list.results).toEqual([])
  expect((await t.del(`/api/v1/channels/${ch.id}`)).status).toBe(404)
})

it('unknown channel id → 404 on PATCH, DELETE, and test', async () => {
  const t = await make()
  expect((await t.patch('/api/v1/channels/nope', { name: 'x' })).status).toBe(404)
  expect((await t.del('/api/v1/channels/nope')).status).toBe(404)
  expect((await t.post('/api/v1/channels/nope/test')).status).toBe(404)
})

it('GET /channels without auth → 401', async () => {
  const t = await make()
  const res = await t.request('/api/v1/channels')
  expect(res.status).toBe(401)
})

it('POST /channels/:id/test dispatches the standard test payload and returns the outcome', async () => {
  const t = await make()
  vi.mocked(sendToChannel).mockResolvedValue('delivered')
  const ch = await json<ChannelDto>(await t.post('/api/v1/channels', webhookBody))

  const res = await t.post(`/api/v1/channels/${ch.id}/test`)
  expect(res.status).toBe(200)
  expect(await json<{ outcome: string }>(res)).toEqual({ outcome: 'delivered' })

  expect(vi.mocked(sendToChannel)).toHaveBeenCalledTimes(1)
  const args = vi.mocked(sendToChannel).mock.calls[0]
  if (!args) throw new Error('sendToChannel was not called')
  const [type, configJson, payload] = args
  expect(type).toBe('webhook')
  expect(JSON.parse(configJson)).toEqual(webhookBody.config)
  expect(payload.test).toBe(true)
  expect(payload.title).toBe('Test notification from OpenDoist')
  expect(payload.body).toBe('Your HA channel works.')
})

it('POST /channels/:id/test does NOT touch the failure counter, whatever the outcome', async () => {
  const t = await make()
  vi.mocked(sendToChannel).mockResolvedValue('error')
  const ch = await json<ChannelDto>(await t.post('/api/v1/channels', webhookBody))

  const res = await t.post(`/api/v1/channels/${ch.id}/test`)
  expect(await json<{ outcome: string }>(res)).toEqual({ outcome: 'error' })

  const list = await json<ListDto>(await t.get('/api/v1/channels'))
  expect(list.results[0]?.consecutive_failures).toBe(0)
  expect(list.results[0]?.enabled).toBe(true)
})
