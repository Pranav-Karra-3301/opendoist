/**
 * Phase 7 Task F — ramble routes integration test.
 *
 * Boots the phase-3 test harness (temp SQLite + real migrations + signed-up user) and mounts
 * the ramble routes on a thin app that reproduces the app's deps/auth middleware (the harness
 * app's `createApp` builds routes without the test seam, so we mount our own copy with
 * injected provider overrides). Providers are injected fakes with `autoRun: false`; the real
 * `createTask` port is kept so confirm creates genuine tasks.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { OpenAPIHono } from '@hono/zod-openapi'
import { parseQuickAdd } from '@opendoist/core'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AppDeps, AppEnv } from '../app'
import { tasks } from '../db/schema'
import { parseContextFor } from '../lib/parse-context'
import { problem } from '../lib/problem'
import { getSettings } from '../services/task-write'
import { createTestApp, type TestApp } from '../test/helpers'
import type { SttProvider, TaskExtractor } from './providers/types'
import { ProviderError } from './providers/types'
import { type RambleRoutesOverrides, rambleRoutes } from './routes'
import type { RambleDto } from './schemas'

type SttMode = 'ok' | 'fail' | 'unconfigured'
let sttMode: SttMode = 'ok'

const sttStub: SttProvider = {
  id: 'openai-compatible',
  transcribe: async () => {
    if (sttMode === 'fail') throw new ProviderError('stt provider exploded', 500)
    return { text: 'buy milk tomorrow and email sam on friday' }
  },
}

const extractorStub: TaskExtractor = {
  id: 'openai-compatible',
  extract: async () => ({
    tasks: [
      { title: 'Buy milk', notes: null, due: 'tomorrow', priority: null, labels: [] },
      {
        title: 'Email Sam',
        notes: 'about the quarterly report',
        due: null,
        priority: 1,
        labels: [],
      },
    ],
  }),
}

const overrides: RambleRoutesOverrides = {
  resolveStt: async () => (sttMode === 'unconfigured' ? null : sttStub),
  resolveExtractor: async () => extractorStub,
  autoRun: false,
}

/** Minimal app: deps + auth resolver + guard + ramble routes (no `/api/*` catch-all to shadow). */
function mountRambleApp(deps: AppDeps): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return problem(c, 400, 'validation failed', undefined, { errors: result.error.issues })
      }
    },
  })
  app.use('*', async (c, next) => {
    c.set('requestId', 'test')
    c.set('deps', deps)
    c.set('auth', null)
    await next()
  })
  app.use('/api/v1/*', async (c, next) => {
    const session = await deps.auth.api.getSession({ headers: c.req.raw.headers })
    if (session) c.set('auth', { userId: session.user.id, via: 'session', scope: 'read_write' })
    return next()
  })
  app.use('/api/v1/*', async (c, next) => {
    if (!c.get('auth')) return problem(c, 401, 'unauthorized')
    return next()
  })
  app.route('/api/v1', rambleRoutes(overrides))
  return app
}

describe('ramble routes integration', () => {
  let t: TestApp
  let app: OpenAPIHono<AppEnv>
  let cookie: string
  let pipelineId = ''

  beforeAll(async () => {
    // 1 MB cap so the oversized-upload case can send 1.5 MB without a huge fixture.
    t = await createTestApp({ env: { OPENDOIST_UPLOAD_MAX_MB: '1' } })
    app = mountRambleApp(t.deps)
    cookie = t.cookie
    sttMode = 'ok'
  })
  afterAll(() => t.close())

  const upload = (buf: Buffer, mime = 'audio/webm', name = 'ramble.webm', ck = cookie) => {
    const fd = new FormData()
    fd.append('audio', new File([buf], name, { type: mime }))
    return app.request('/api/v1/rambles', { method: 'POST', headers: { cookie: ck }, body: fd })
  }
  const post = (path: string, body?: unknown, ck = cookie) =>
    app.request(path, {
      method: 'POST',
      headers:
        body === undefined ? { cookie: ck } : { cookie: ck, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const get = (path: string, ck = cookie) => app.request(path, { headers: { cookie: ck } })
  const del = (path: string, ck = cookie) =>
    app.request(path, { method: 'DELETE', headers: { cookie: ck } })
  const audioFileFor = (id: string, ext = 'webm') => join(t.dataDir, 'rambles', `${id}.${ext}`)

  it('(1) uploads audio → 201 uploaded, audio file on disk', async () => {
    sttMode = 'ok'
    const res = await upload(Buffer.from('tiny-audio-bytes'))
    expect(res.status).toBe(201)
    const dto = (await res.json()) as RambleDto
    expect(dto.status).toBe('uploaded')
    expect(dto.audioMime).toBe('audio/webm')
    expect(dto.transcript).toBeNull()
    expect(dto.extractedTasks).toBeNull()
    pipelineId = dto.id
    expect(existsSync(audioFileFor(dto.id))).toBe(true)
  })

  it('(2) transcribe → transcribed + transcript', async () => {
    const res = await post(`/api/v1/rambles/${pipelineId}/transcribe`)
    expect(res.status).toBe(200)
    const dto = (await res.json()) as RambleDto
    expect(dto.status).toBe('transcribed')
    expect(dto.transcript).toContain('buy milk')
    expect(dto.failedStage).toBeNull()
  })

  it('(3) extract → extracted + 2 tasks', async () => {
    const res = await post(`/api/v1/rambles/${pipelineId}/extract`)
    expect(res.status).toBe(200)
    const dto = (await res.json()) as RambleDto
    expect(dto.status).toBe('extracted')
    expect(dto.extractedTasks).toHaveLength(2)
    expect(dto.extractedTasks?.[1]?.priority).toBe(1)
  })

  // (4) confirm calls buildTaskDrafts (Task G) — un-skipped at Task N.
  describe('(4) confirm flow', () => {
    it('confirm with edited items creates 2 tasks and deletes the audio', async () => {
      sttMode = 'ok'
      const up = await upload(Buffer.from('tiny'))
      const r = (await up.json()) as RambleDto
      await post(`/api/v1/rambles/${r.id}/transcribe`)
      await post(`/api/v1/rambles/${r.id}/extract`)
      expect(existsSync(audioFileFor(r.id))).toBe(true)

      const ctx = parseContextFor(getSettings(t.deps.db, t.userId))
      const expectedDue = parseQuickAdd('tomorrow', ctx).due?.date ?? null
      expect(expectedDue).not.toBeNull()

      const confirmRes = await post(`/api/v1/rambles/${r.id}/confirm`, {
        tasks: [
          { title: 'Buy oat milk', notes: null, due: 'tomorrow', priority: null, labels: [] },
          {
            title: 'Email Sam',
            notes: 'about the quarterly report',
            due: null,
            priority: 1,
            labels: [],
          },
        ],
      })
      expect(confirmRes.status).toBe(200)
      const { createdTaskIds } = (await confirmRes.json()) as { createdTaskIds: string[] }
      expect(createdTaskIds).toHaveLength(2)

      const rows = createdTaskIds.map((id) =>
        t.deps.db
          .select()
          .from(tasks)
          .where(and(eq(tasks.id, id), eq(tasks.userId, t.userId)))
          .get(),
      )
      const buy = rows.find((x) => x?.content === 'Buy oat milk')
      const email = rows.find((x) => x?.content === 'Email Sam')
      expect(buy).toBeDefined()
      expect(buy?.priority).toBe(4)
      expect(buy?.dueDate).toBe(expectedDue)
      expect(email).toBeDefined()
      expect(email?.priority).toBe(1)
      expect(email?.dueDate).toBeNull()

      const after = (await (await get(`/api/v1/rambles/${r.id}`)).json()) as RambleDto
      expect(after.status).toBe('confirmed')
      expect(existsSync(audioFileFor(r.id))).toBe(false)
    })
  })

  it('(5) STT failure → failed@transcribe with error, then retry succeeds', async () => {
    sttMode = 'fail'
    const up = await upload(Buffer.from('tiny'))
    const r = (await up.json()) as RambleDto
    expect(r.status).toBe('uploaded')

    const failRes = await post(`/api/v1/rambles/${r.id}/transcribe`)
    expect(failRes.status).toBe(200)
    const failed = (await failRes.json()) as RambleDto
    expect(failed.status).toBe('failed')
    expect(failed.failedStage).toBe('transcribe')
    expect(failed.error).toBeTruthy()

    sttMode = 'ok'
    const retryRes = await post(`/api/v1/rambles/${r.id}/transcribe`)
    const retried = (await retryRes.json()) as RambleDto
    expect(retried.status).toBe('transcribed')
    expect(retried.failedStage).toBeNull()
    expect(retried.error).toBeNull()
  })

  it('(6a) extract while uploaded → 409', async () => {
    sttMode = 'ok'
    const up = await upload(Buffer.from('tiny'))
    const r = (await up.json()) as RambleDto
    const res = await post(`/api/v1/rambles/${r.id}/extract`)
    expect(res.status).toBe(409)
  })

  it('(6b) confirm while transcribed → 409', async () => {
    sttMode = 'ok'
    const up = await upload(Buffer.from('tiny'))
    const r = (await up.json()) as RambleDto
    await post(`/api/v1/rambles/${r.id}/transcribe`)
    const res = await post(`/api/v1/rambles/${r.id}/confirm`, {
      tasks: [{ title: 'x', notes: null, due: null, priority: null, labels: [] }],
    })
    expect(res.status).toBe(409)
  })

  it('(7) upload with STT unconfigured → 409 problem-JSON', async () => {
    sttMode = 'unconfigured'
    const res = await upload(Buffer.from('tiny'))
    expect(res.status).toBe(409)
    const body = (await res.json()) as Record<string, unknown>
    expect(JSON.stringify(body)).toContain('No speech-to-text provider is configured')
    sttMode = 'ok'
  })

  it('(8) oversized upload → 413', async () => {
    sttMode = 'ok'
    const res = await upload(Buffer.alloc(1_500_000, 1))
    expect(res.status).toBe(413)
  })

  it('(9a) GET unknown id → 404', async () => {
    const res = await get('/api/v1/rambles/does-not-exist')
    expect(res.status).toBe(404)
  })

  it('(9b) GET a foreign user’s ramble → 404', async () => {
    sttMode = 'ok'
    const signup = await t.app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Two', email: 'two@example.com', password: 'password1234' }),
    })
    const cookie2 = signup.headers
      .getSetCookie()
      .map((v) => v.split(';')[0] ?? '')
      .filter((v) => v.length > 0)
      .join('; ')
    const up = await upload(Buffer.from('tiny'), 'audio/webm', 'ramble.webm', cookie2)
    const foreign = (await up.json()) as RambleDto
    const res = await get(`/api/v1/rambles/${foreign.id}`) // as user 1
    expect(res.status).toBe(404)
  })

  it('(10) DELETE → 204, audio gone, subsequent GET → 404', async () => {
    sttMode = 'ok'
    const up = await upload(Buffer.from('tiny'))
    const r = (await up.json()) as RambleDto
    expect(existsSync(audioFileFor(r.id))).toBe(true)

    const res = await del(`/api/v1/rambles/${r.id}`)
    expect(res.status).toBe(204)
    expect(existsSync(audioFileFor(r.id))).toBe(false)

    const after = await get(`/api/v1/rambles/${r.id}`)
    expect(after.status).toBe(404)
  })
})
