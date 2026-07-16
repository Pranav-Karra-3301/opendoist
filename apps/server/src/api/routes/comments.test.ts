import { eq } from 'drizzle-orm'
import { afterEach, expect, it } from 'vitest'
import { attachments, tasks } from '../../db/schema'
import { newId, nowIso } from '../../lib/ids'
import { createTask } from '../../services/task-write'
import { createTestApp, json, type TestApp } from '../../test/helpers'

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

interface AttachmentDto {
  id: string
  file_name: string
  file_size: number
  file_type: string
  file_url: string
}
interface CommentDto {
  id: string
  task_id: string
  content: string
  attachment: AttachmentDto | null
  created_at: string
  updated_at: string
}
interface CommentList {
  results: CommentDto[]
  next_cursor: string | null
}

/** Insert a task straight through the frozen service (no dependency on the tasks router). */
function seedTask(t: TestApp, userId: string = t.userId): typeof tasks.$inferSelect {
  return createTask(t.deps.db, userId, {
    content: 'Task',
    description: '',
    projectId: null,
    sectionId: null,
    parentId: null,
    childOrder: null,
    priority: 4,
    dueDate: null,
    dueTime: null,
    dueString: null,
    recurrence: null,
    deadlineDate: null,
    durationMin: null,
    labels: [],
    uncompletable: null,
  })
}

async function signupUser(t: TestApp, email: string): Promise<{ cookie: string; userId: string }> {
  const res = await t.app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Other', email, password: 'password1234' }),
  })
  if (!res.ok) throw new Error(`signup failed: ${res.status}`)
  const cookie = res.headers
    .getSetCookie()
    .map((v) => v.split(';')[0] ?? '')
    .filter((v) => v.length > 0)
    .join('; ')
  const sessionRes = await t.app.request('/api/auth/get-session', { headers: { cookie } })
  const session = (await sessionRes.json()) as { user: { id: string } } | null
  if (session === null) throw new Error('no session for new user')
  return { cookie, userId: session.user.id }
}

it('round-trips a comment through create, list, patch, and delete', async () => {
  const t = await make()
  const task = seedTask(t)

  const created = await t.post('/api/v1/comments', { task_id: task.id, content: 'first note' })
  expect(created.status).toBe(201)
  const dto = await json<CommentDto>(created)
  expect(dto.content).toBe('first note')
  expect(dto.task_id).toBe(task.id)
  expect(dto.attachment).toBeNull()

  const listed = await json<CommentList>(await t.get(`/api/v1/comments?task_id=${task.id}`))
  expect(listed.results.map((cmt) => cmt.id)).toContain(dto.id)
  expect(listed.next_cursor).toBeNull()

  const patched = await json<CommentDto>(
    await t.patch(`/api/v1/comments/${dto.id}`, { content: 'edited' }),
  )
  expect(patched.content).toBe('edited')

  const del = await t.del(`/api/v1/comments/${dto.id}`)
  expect(del.status).toBe(204)

  const after = await json<CommentList>(await t.get(`/api/v1/comments?task_id=${task.id}`))
  expect(after.results).toHaveLength(0)
})

it('joins an attached file into the comment DTO', async () => {
  const t = await make()
  const task = seedTask(t)
  const attId = newId()
  t.deps.db
    .insert(attachments)
    .values({
      id: attId,
      userId: t.userId,
      fileName: 'a.txt',
      fileSize: 3,
      fileType: 'text/plain',
      filePath: `${attId}/a.txt`,
      createdAt: nowIso(),
    })
    .run()

  const dto = await json<CommentDto>(
    await t.post('/api/v1/comments', {
      task_id: task.id,
      content: 'see file',
      attachment_id: attId,
    }),
  )
  expect(dto.attachment?.file_name).toBe('a.txt')
  expect(dto.attachment?.file_url).toBe(`/api/v1/attachments/${attId}/a.txt`)

  const listed = await json<CommentList>(await t.get(`/api/v1/comments?task_id=${task.id}`))
  expect(listed.results[0]?.attachment?.file_name).toBe('a.txt')
})

it('rejects an unknown attachment_id with 400', async () => {
  const t = await make()
  const task = seedTask(t)
  const res = await t.post('/api/v1/comments', {
    task_id: task.id,
    content: 'x',
    attachment_id: 'nope',
  })
  expect(res.status).toBe(400)
})

it('paginates comments oldest-first with a keyset cursor', async () => {
  const t = await make()
  const task = seedTask(t)
  for (let i = 0; i < 3; i++) {
    const r = await t.post('/api/v1/comments', { task_id: task.id, content: `c${i}` })
    expect(r.status).toBe(201)
  }

  const page1 = await json<CommentList>(await t.get(`/api/v1/comments?task_id=${task.id}&limit=2`))
  expect(page1.results).toHaveLength(2)
  expect(page1.next_cursor).not.toBeNull()

  const page2 = await json<CommentList>(
    await t.get(
      `/api/v1/comments?task_id=${task.id}&limit=2&cursor=${encodeURIComponent(page1.next_cursor ?? '')}`,
    ),
  )
  expect(page2.results).toHaveLength(1)
  expect(page2.next_cursor).toBeNull()

  const ids = new Set([...page1.results, ...page2.results].map((cmt) => cmt.id))
  expect(ids.size).toBe(3)
})

it('rejects a malformed cursor with 400', async () => {
  const t = await make()
  const task = seedTask(t)
  const res = await t.get(`/api/v1/comments?task_id=${task.id}&cursor=%21%21%21`)
  expect(res.status).toBe(400)
})

it('404s a comment on an unknown task', async () => {
  const t = await make()
  const res = await t.post('/api/v1/comments', { task_id: 'ghost', content: 'x' })
  expect(res.status).toBe(404)
})

it("404s a comment on another user's task", async () => {
  const t = await make({ env: { OPENDOIST_ALLOW_REGISTRATION: 'true' } })
  const other = await signupUser(t, 'other@example.com')
  const foreignTask = seedTask(t, other.userId)
  const res = await t.post('/api/v1/comments', { task_id: foreignTask.id, content: 'x' })
  expect(res.status).toBe(404)
})

it('404s a comment on a soft-deleted task', async () => {
  const t = await make()
  const task = seedTask(t)
  t.deps.db.update(tasks).set({ deletedAt: nowIso() }).where(eq(tasks.id, task.id)).run()
  const res = await t.post('/api/v1/comments', { task_id: task.id, content: 'x' })
  expect(res.status).toBe(404)
})

it('404s patch/delete on an unknown comment', async () => {
  const t = await make()
  expect((await t.patch('/api/v1/comments/ghost', { content: 'x' })).status).toBe(404)
  expect((await t.del('/api/v1/comments/ghost')).status).toBe(404)
})

it('rejects empty comment content with 400', async () => {
  const t = await make()
  const task = seedTask(t)
  const res = await t.post('/api/v1/comments', { task_id: task.id, content: '' })
  expect(res.status).toBe(400)
})

it('publishes comment.created carrying [commentId, taskId]', async () => {
  const t = await make()
  const task = seedTask(t)
  const events: { type: string; ids: string[] }[] = []
  const unsub = t.deps.bus.subscribe((e) => events.push({ type: e.type, ids: e.ids }))
  const dto = await json<CommentDto>(
    await t.post('/api/v1/comments', { task_id: task.id, content: 'x' }),
  )
  unsub()
  const created = events.find((e) => e.type === 'comment.created')
  expect(created?.ids).toEqual([dto.id, task.id])
})

it('exposes comment routes in the OpenAPI document', async () => {
  const t = await make()
  const res = await t.get('/api/v1/openapi.json')
  expect(res.status).toBe(200)
  const doc = await json<{ paths: Record<string, unknown> }>(res)
  expect(doc.paths['/api/v1/comments']).toBeDefined()
  expect(doc.paths['/api/v1/comments/{id}']).toBeDefined()
})
