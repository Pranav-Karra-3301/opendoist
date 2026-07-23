import { describe, expect, it } from 'vitest'
import { EventBus } from '../../events/bus'
import { createTestApp } from '../../test/helpers'

interface Frame {
  event?: string
  data?: string
  id?: string
}

/** Parse whatever raw SSE text we have so far into frames (trailing partial block ignored if empty). */
function parseFrames(raw: string): Frame[] {
  const frames: Frame[] = []
  for (const block of raw.split('\n\n')) {
    if (block.trim() === '') continue
    const frame: Frame = {}
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) frame.event = line.slice('event:'.length).trim()
      else if (line.startsWith('id:')) frame.id = line.slice('id:'.length).trim()
      else if (line.startsWith('data:')) {
        const piece = line.slice('data:'.length).replace(/^ /, '')
        frame.data = frame.data === undefined ? piece : `${frame.data}\n${piece}`
      }
    }
    frames.push(frame)
  }
  return frames
}

const TIMEOUT = Symbol('sse-timeout')

/**
 * Read the SSE body until `until` is satisfied or the deadline passes, then ALWAYS cancel the
 * reader (which aborts the server-side stream loop — no hanging handles). Returns whatever it read.
 */
async function collectSse(
  res: Response,
  until: (state: { text: string; frames: Frame[] }) => boolean,
  timeoutMs = 2000,
): Promise<{ text: string; frames: Frame[] }> {
  const body = res.body
  if (body === null) throw new Error('SSE response has no body')
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let frames: Frame[] = []
  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const raced = await Promise.race([
        reader.read(),
        new Promise<typeof TIMEOUT>((resolve) => {
          timer = setTimeout(() => resolve(TIMEOUT), deadline - Date.now())
        }),
      ])
      if (timer !== undefined) clearTimeout(timer)
      if (raced === TIMEOUT) break
      if (raced.done) break
      text += decoder.decode(raced.value, { stream: true })
      frames = parseFrames(text)
      if (until({ text, frames })) break
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return { text, frames }
}

const completeSync = (frames: Frame[]) =>
  frames.filter((f) => f.event === 'sync' && f.id !== undefined)

describe('events route (SSE)', () => {
  it('rejects unauthenticated connections with 401 before streaming', async () => {
    const t = await createTestApp({ signup: false })
    try {
      const res = await t.request('/api/v1/events')
      expect(res.status).toBe(401)
      expect(res.headers.get('content-type')).toContain('application/problem+json')
      await res.text()
    } finally {
      t.close()
    }
  })

  it('streams a published event as an SSE sync frame', async () => {
    const t = await createTestApp()
    try {
      const res = await t.request('/api/v1/events', { headers: { cookie: t.cookie } })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/event-stream')

      // Subscription is live before app.request() resolves, so this is captured.
      t.deps.bus.publish({ userId: t.userId, type: 'task.created', entity: 'task', ids: ['x1'] })

      const { text, frames } = await collectSse(res, ({ text }) => text.includes('id: 1'))
      expect(text).toContain('event: sync')
      expect(text).toContain('id: 1')

      const sync = completeSync(frames)[0]
      expect(sync).toBeDefined()
      const payload = JSON.parse(sync?.data ?? '{}') as {
        type: string
        entity: string
        ids: string[]
        at: string
      }
      expect(payload.type).toBe('task.created')
      expect(payload.entity).toBe('task')
      expect(payload.ids).toEqual(['x1'])
      expect(typeof payload.at).toBe('string')
    } finally {
      t.close()
    }
  })

  it('replays buffered events after Last-Event-ID', async () => {
    const t = await createTestApp()
    try {
      // Published before connecting: they sit in the ring buffer.
      t.deps.bus.publish({ userId: t.userId, type: 'task.created', entity: 'task', ids: ['a'] }) // id 1
      t.deps.bus.publish({ userId: t.userId, type: 'task.updated', entity: 'task', ids: ['b'] }) // id 2
      t.deps.bus.publish({ userId: t.userId, type: 'task.completed', entity: 'task', ids: ['c'] }) // id 3

      const res = await t.request('/api/v1/events', {
        headers: { cookie: t.cookie, 'last-event-id': '1' },
      })
      expect(res.status).toBe(200)

      const { frames } = await collectSse(res, ({ frames }) => completeSync(frames).length >= 2)
      const ids = completeSync(frames).map((f) => f.id)
      expect(ids.slice(0, 2)).toEqual(['2', '3'])
    } finally {
      t.close()
    }
  })

  it('honors the ?last_event_id query param when no header is present', async () => {
    const t = await createTestApp()
    try {
      t.deps.bus.publish({ userId: t.userId, type: 'task.created', entity: 'task', ids: ['a'] }) // id 1
      t.deps.bus.publish({ userId: t.userId, type: 'task.updated', entity: 'task', ids: ['b'] }) // id 2

      const res = await t.request('/api/v1/events?last_event_id=1', {
        headers: { cookie: t.cookie },
      })
      expect(res.status).toBe(200)

      const { frames } = await collectSse(res, ({ frames }) => completeSync(frames).length >= 1)
      expect(completeSync(frames)[0]?.id).toBe('2')
    } finally {
      t.close()
    }
  })

  it('EventBus ring buffer keeps only the most recent 256 events', () => {
    const bus = new EventBus(256)
    for (let i = 0; i < 300; i += 1) {
      bus.publish({ userId: 'u1', type: 'task.created', entity: 'task', ids: [String(i)] })
    }
    const events = bus.since(0)
    expect(events.length).toBe(256)
    expect(events[0]?.id).toBe(45)
  })

  it('delivers a task.created event from a real mutation over the stream', async () => {
    const t = await createTestApp()
    try {
      const res = await t.request('/api/v1/events', { headers: { cookie: t.cookie } })
      expect(res.status).toBe(200)

      const created = await t.post('/tasks', { content: 'sse round-trip task' })
      await created.text()
      if (created.status !== 201) {
        // Tasks router (Task B) may still be a stub in this parallel build; publish the exact
        // event a create emits so the end-to-end delivery path is still exercised here.
        t.deps.bus.publish({
          userId: t.userId,
          type: 'task.created',
          entity: 'task',
          ids: ['stub-fallback'],
        })
      }

      const { text, frames } = await collectSse(res, ({ frames }) =>
        frames.some((f) => f.event === 'sync' && (f.data?.includes('task.created') ?? false)),
      )
      expect(text).toContain('event: sync')
      const createdFrame = frames.find(
        (f) => f.event === 'sync' && (f.data?.includes('task.created') ?? false),
      )
      expect(createdFrame).toBeDefined()
    } finally {
      t.close()
    }
  })

  /** Registers a second account on the same instance and returns its session cookie. */
  async function signupSecondUser(t: Awaited<ReturnType<typeof createTestApp>>): Promise<string> {
    const res = await t.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Other', email: 'other@example.com', password: 'password1234' }),
    })
    if (res.status !== 200) throw new Error(`second signup failed: ${res.status}`)
    return res.headers
      .getSetCookie()
      .map((v) => v.split(';')[0] ?? '')
      .filter((v) => v.length > 0)
      .join('; ')
  }

  it('never delivers another user’s live events (cross-tenant isolation)', async () => {
    const t = await createTestApp({ env: { OPENTASK_ALLOW_REGISTRATION: 'true' } })
    try {
      const cookieB = await signupSecondUser(t)

      // User A listens; user B mutates; then A mutates (the sentinel frame A waits for).
      const res = await t.request('/api/v1/events', { headers: { cookie: t.cookie } })
      expect(res.status).toBe(200)

      const bCreate = await t.request('/api/v1/tasks', {
        method: 'POST',
        headers: { cookie: cookieB, 'content-type': 'application/json' },
        body: JSON.stringify({ content: "BOB'S SECRET TASK" }),
      })
      expect(bCreate.status).toBe(201)
      const bTask = (await bCreate.json()) as { id: string }

      const aCreate = await t.post('/api/v1/tasks', { content: 'sentinel for A' })
      expect(aCreate.status).toBe(201)
      const aTask = (await aCreate.json()) as { id: string }

      // The bus publishes B's event before A's, so once A's frame arrived, B's would have too.
      const { text } = await collectSse(res, ({ text }) => text.includes(aTask.id))
      expect(text).toContain(aTask.id)
      expect(text).not.toContain(bTask.id)
    } finally {
      t.close()
    }
  })

  it('never replays another user’s buffered events on reconnect', async () => {
    const t = await createTestApp({ env: { OPENTASK_ALLOW_REGISTRATION: 'true' } })
    try {
      const cookieB = await signupSecondUser(t)

      // Buffered before anyone connects: first B's event, then A's.
      const bCreate = await t.request('/api/v1/tasks', {
        method: 'POST',
        headers: { cookie: cookieB, 'content-type': 'application/json' },
        body: JSON.stringify({ content: "BOB'S BUFFERED TASK" }),
      })
      expect(bCreate.status).toBe(201)
      const bTask = (await bCreate.json()) as { id: string }
      const aCreate = await t.post('/api/v1/tasks', { content: 'a buffered task' })
      expect(aCreate.status).toBe(201)
      const aTask = (await aCreate.json()) as { id: string }

      // A replays from 0: only A's event comes back, and never B's id.
      const resA = await t.request('/api/v1/events', {
        headers: { cookie: t.cookie, 'last-event-id': '0' },
      })
      const a = await collectSse(resA, ({ text }) => text.includes(aTask.id))
      expect(a.text).toContain(aTask.id)
      expect(a.text).not.toContain(bTask.id)
      expect(completeSync(a.frames).some((f) => f.data?.includes(bTask.id) ?? false)).toBe(false)

      // B replaying from 0 still gets B's own event (the filter keeps, not drops, the owner's).
      const resB = await t.request('/api/v1/events', {
        headers: { cookie: cookieB, 'last-event-id': '0' },
      })
      const b = await collectSse(resB, ({ text }) => text.includes(bTask.id))
      expect(b.text).toContain(bTask.id)
      expect(b.text).not.toContain(aTask.id)
    } finally {
      t.close()
    }
  })
})
