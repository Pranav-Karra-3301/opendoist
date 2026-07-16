import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { tasks } from '../../db/schema'
import { newId } from '../../lib/ids'
import { createTestApp, json, type TestApp } from '../../test/helpers'

interface ProjectDto {
  id: string
  name: string
  description: string
  color: string
  parent_id: string | null
  child_order: number
  is_favorite: boolean
  is_archived: boolean
  is_collapsed: boolean
  is_inbox: boolean
  view_prefs: unknown
  created_at: string
  updated_at: string
}
interface Envelope<T> {
  results: T[]
  next_cursor: string | null
}

async function withApp(fn: (app: TestApp) => Promise<void>): Promise<void> {
  const app = await createTestApp()
  try {
    await fn(app)
  } finally {
    app.close()
  }
}

async function listProjects(app: TestApp, includeArchived = false): Promise<ProjectDto[]> {
  const res = await app.get(`/api/v1/projects${includeArchived ? '?include_archived=true' : ''}`)
  expect(res.status).toBe(200)
  const body = await json<Envelope<ProjectDto>>(res)
  return body.results
}

async function getInbox(app: TestApp): Promise<ProjectDto> {
  const inbox = (await listProjects(app)).find((p) => p.is_inbox)
  if (!inbox) throw new Error('inbox project not found')
  return inbox
}

async function createProject(app: TestApp, body: Record<string, unknown>): Promise<ProjectDto> {
  const res = await app.post('/api/v1/projects', body)
  expect(res.status).toBe(201)
  return json<ProjectDto>(res)
}

describe('projects router', () => {
  it('returns the seeded Inbox inside the {results, next_cursor} envelope', async () => {
    await withApp(async (app) => {
      const res = await app.get('/api/v1/projects')
      expect(res.status).toBe(200)
      const body = await json<Envelope<ProjectDto>>(res)
      expect(body).toHaveProperty('results')
      expect(Array.isArray(body.results)).toBe(true)
      expect(body.next_cursor).toBeNull()
      const inbox = body.results.filter((p) => p.is_inbox)
      expect(inbox).toHaveLength(1)
      expect(inbox[0]?.name).toBe('Inbox')
    })
  })

  it('creates projects appended after their siblings', async () => {
    await withApp(async (app) => {
      const first = await createProject(app, { name: 'Work' })
      const second = await createProject(app, { name: 'Personal' })
      expect(first.is_inbox).toBe(false)
      expect(first.color).toBe('charcoal')
      expect(first.parent_id).toBeNull()
      expect(second.child_order).toBeGreaterThan(first.child_order)
    })
  })

  it('honors optional create fields', async () => {
    await withApp(async (app) => {
      const p = await createProject(app, {
        name: 'Colored',
        description: 'notes',
        color: 'teal',
        is_favorite: true,
      })
      expect(p.color).toBe('teal')
      expect(p.description).toBe('notes')
      expect(p.is_favorite).toBe(true)
    })
  })

  it('refuses to delete or archive the Inbox', async () => {
    await withApp(async (app) => {
      const inbox = await getInbox(app)
      const delRes = await app.del(`/api/v1/projects/${inbox.id}`)
      expect(delRes.status).toBe(403)
      expect(delRes.headers.get('content-type')).toContain('application/problem+json')
      const archiveRes = await app.post(`/api/v1/projects/${inbox.id}/archive`)
      expect(archiveRes.status).toBe(403)
    })
  })

  it('restricts Inbox PATCH to is_collapsed / view_prefs', async () => {
    await withApp(async (app) => {
      const inbox = await getInbox(app)
      const ok = await app.patch(`/api/v1/projects/${inbox.id}`, { is_collapsed: true })
      expect(ok.status).toBe(200)
      const okBody = await json<ProjectDto>(ok)
      expect(okBody.is_collapsed).toBe(true)
      const bad = await app.patch(`/api/v1/projects/${inbox.id}`, { name: 'Renamed' })
      expect(bad.status).toBe(400)
    })
  })

  it('reparents projects and rejects cycles', async () => {
    await withApp(async (app) => {
      const a = await createProject(app, { name: 'A' })
      const b = await createProject(app, { name: 'B' })
      // B becomes a child of A.
      const reparent = await app.patch(`/api/v1/projects/${b.id}`, { parent_id: a.id })
      expect(reparent.status).toBe(200)
      expect((await json<ProjectDto>(reparent)).parent_id).toBe(a.id)
      // A under B would be a cycle (B is a descendant of A).
      const cycle = await app.patch(`/api/v1/projects/${a.id}`, { parent_id: b.id })
      expect(cycle.status).toBe(400)
      // A under itself is a cycle too.
      const self = await app.patch(`/api/v1/projects/${a.id}`, { parent_id: a.id })
      expect(self.status).toBe(400)
    })
  })

  it('archive cascades to child projects and unarchive reverses it', async () => {
    await withApp(async (app) => {
      const parent = await createProject(app, { name: 'Parent' })
      const child = await createProject(app, { name: 'Child', parent_id: parent.id })

      const archiveRes = await app.post(`/api/v1/projects/${parent.id}/archive`)
      expect(archiveRes.status).toBe(200)

      // Default listing hides archived projects.
      const visible = await listProjects(app)
      expect(visible.some((p) => p.id === parent.id)).toBe(false)
      expect(visible.some((p) => p.id === child.id)).toBe(false)

      // include_archived surfaces both, both archived.
      const all = await listProjects(app, true)
      expect(all.find((p) => p.id === parent.id)?.is_archived).toBe(true)
      expect(all.find((p) => p.id === child.id)?.is_archived).toBe(true)

      const unarchiveRes = await app.post(`/api/v1/projects/${parent.id}/unarchive`)
      expect(unarchiveRes.status).toBe(200)
      const afterUnarchive = await listProjects(app)
      expect(afterUnarchive.find((p) => p.id === parent.id)?.is_archived).toBe(false)
      expect(afterUnarchive.find((p) => p.id === child.id)?.is_archived).toBe(false)
    })
  })

  it('delete cascades to child projects, their sections, and their tasks', async () => {
    await withApp(async (app) => {
      const parent = await createProject(app, { name: 'Parent' })
      const child = await createProject(app, { name: 'Child', parent_id: parent.id })
      // Seed a task directly in the child project (tasks router is out of scope here).
      const taskId = newId()
      app.deps.db
        .insert(tasks)
        .values({ id: taskId, userId: app.userId, projectId: child.id, content: 'orphan me' })
        .run()

      const delRes = await app.del(`/api/v1/projects/${parent.id}`)
      expect(delRes.status).toBe(204)

      // Parent and child no longer listed.
      const remaining = await listProjects(app, true)
      expect(remaining.some((p) => p.id === parent.id)).toBe(false)
      expect(remaining.some((p) => p.id === child.id)).toBe(false)

      // GET on the child project 404s.
      expect((await app.get(`/api/v1/projects/${child.id}`)).status).toBe(404)

      // The child's task is soft-deleted (would 404 through the tasks router).
      const taskRow = app.deps.db.select().from(tasks).where(eq(tasks.id, taskId)).get()
      expect(taskRow?.deletedAt).not.toBeNull()
    })
  })

  it('persists reorder', async () => {
    await withApp(async (app) => {
      const a = await createProject(app, { name: 'A' })
      const b = await createProject(app, { name: 'B' })
      const res = await app.post('/api/v1/projects/reorder', {
        items: [
          { id: a.id, child_order: 5 },
          { id: b.id, child_order: 3 },
        ],
      })
      expect(res.status).toBe(204)
      const projects = await listProjects(app)
      expect(projects.find((p) => p.id === a.id)?.child_order).toBe(5)
      expect(projects.find((p) => p.id === b.id)?.child_order).toBe(3)
    })
  })

  it('rejects reorder that references an unknown project', async () => {
    await withApp(async (app) => {
      const a = await createProject(app, { name: 'A' })
      const res = await app.post('/api/v1/projects/reorder', {
        items: [
          { id: a.id, child_order: 1 },
          { id: 'missing', child_order: 2 },
        ],
      })
      expect(res.status).toBe(404)
    })
  })

  it('404s for unknown ids on read/update/delete/archive', async () => {
    await withApp(async (app) => {
      expect((await app.get('/api/v1/projects/missing')).status).toBe(404)
      expect((await app.patch('/api/v1/projects/missing', { name: 'x' })).status).toBe(404)
      expect((await app.del('/api/v1/projects/missing')).status).toBe(404)
      expect((await app.post('/api/v1/projects/missing/archive')).status).toBe(404)
    })
  })

  it('rejects unauthenticated access', async () => {
    await withApp(async (app) => {
      const res = await app.request('/api/v1/projects')
      expect(res.status).toBe(401)
      expect(res.headers.get('content-type')).toContain('application/problem+json')
    })
  })
})

describe('projects restore (undo)', () => {
  it('delete project with tasks → restore brings the project, sections and tasks back', async () => {
    await withApp(async (app) => {
      const proj = await json<ProjectDto>(await app.post('/api/v1/projects', { name: 'Trip' }))
      const section = await json<{ id: string }>(
        await app.post('/api/v1/sections', { project_id: proj.id, name: 'Todo' }),
      )
      const task = await json<{ id: string }>(
        await app.post('/api/v1/tasks', {
          content: 'Book flights',
          project_id: proj.id,
          section_id: section.id,
        }),
      )

      expect((await app.del(`/api/v1/projects/${proj.id}`)).status).toBe(204)
      expect((await listProjects(app)).some((p) => p.id === proj.id)).toBe(false)
      const goneTasks = await json<Envelope<{ id: string }>>(
        await app.get(`/api/v1/tasks?project_id=${proj.id}`),
      )
      expect(goneTasks.results.some((r) => r.id === task.id)).toBe(false)

      const restore = await app.post(`/api/v1/projects/${proj.id}/restore`)
      expect(restore.status).toBe(200)
      expect(await json<{ ok: boolean }>(restore)).toEqual({ ok: true })

      expect((await listProjects(app)).some((p) => p.id === proj.id)).toBe(true)
      const sections = await json<Envelope<{ id: string }>>(
        await app.get(`/api/v1/sections?project_id=${proj.id}`),
      )
      expect(sections.results.some((s) => s.id === section.id)).toBe(true)
      const backTasks = await json<Envelope<{ id: string }>>(
        await app.get(`/api/v1/tasks?project_id=${proj.id}`),
      )
      expect(backTasks.results.some((r) => r.id === task.id)).toBe(true)
    })
  })

  it('restoring a live (non-deleted) project id is a 404', async () => {
    await withApp(async (app) => {
      const proj = await json<ProjectDto>(await app.post('/api/v1/projects', { name: 'Live' }))
      expect((await app.post(`/api/v1/projects/${proj.id}/restore`)).status).toBe(404)
    })
  })
})
