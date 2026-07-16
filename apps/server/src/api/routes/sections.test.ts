import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { tasks } from '../../db/schema'
import { newId } from '../../lib/ids'
import { createTestApp, json, type TestApp } from '../../test/helpers'

interface SectionDto {
  id: string
  project_id: string
  name: string
  section_order: number
  is_archived: boolean
  is_collapsed: boolean
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

async function createProject(app: TestApp, name: string): Promise<string> {
  const res = await app.post('/api/v1/projects', { name })
  expect(res.status).toBe(201)
  return (await json<{ id: string }>(res)).id
}

async function createSection(app: TestApp, projectId: string, name: string): Promise<SectionDto> {
  const res = await app.post('/api/v1/sections', { project_id: projectId, name })
  expect(res.status).toBe(201)
  return json<SectionDto>(res)
}

async function listSections(app: TestApp, projectId?: string): Promise<SectionDto[]> {
  const res = await app.get(
    `/api/v1/sections${projectId === undefined ? '' : `?project_id=${projectId}`}`,
  )
  expect(res.status).toBe(200)
  return (await json<Envelope<SectionDto>>(res)).results
}

describe('sections router', () => {
  it('lists all sections across projects and narrows with project_id', async () => {
    await withApp(async (app) => {
      const projectA = await createProject(app, 'A')
      const projectB = await createProject(app, 'B')
      const a1 = await createSection(app, projectA, 'A1')
      const b1 = await createSection(app, projectB, 'B1')

      const bare = await app.get('/api/v1/sections')
      expect(bare.status).toBe(200)
      const bareBody = await json<Envelope<SectionDto>>(bare)
      expect(bareBody.next_cursor).toBeNull()
      expect(bareBody.results.some((s) => s.id === a1.id)).toBe(true)
      expect(bareBody.results.some((s) => s.id === b1.id)).toBe(true)

      const narrowed = await listSections(app, projectA)
      expect(narrowed.map((s) => s.id)).toEqual([a1.id])
    })
  })

  it('appends section_order on create', async () => {
    await withApp(async (app) => {
      const project = await createProject(app, 'P')
      const s1 = await createSection(app, project, 'S1')
      const s2 = await createSection(app, project, 'S2')
      expect(s1.section_order).toBe(0)
      expect(s2.section_order).toBeGreaterThan(s1.section_order)
    })
  })

  it('nulls a task section on delete but keeps the task in its project', async () => {
    await withApp(async (app) => {
      const project = await createProject(app, 'P')
      const section = await createSection(app, project, 'S')
      const taskId = newId()
      app.deps.db
        .insert(tasks)
        .values({
          id: taskId,
          userId: app.userId,
          projectId: project,
          sectionId: section.id,
          content: 'in section',
        })
        .run()

      const res = await app.del(`/api/v1/sections/${section.id}`)
      expect(res.status).toBe(204)

      const row = app.deps.db.select().from(tasks).where(eq(tasks.id, taskId)).get()
      expect(row?.sectionId).toBeNull()
      expect(row?.projectId).toBe(project)
      expect(row?.deletedAt).toBeNull()

      // The section itself no longer lists.
      expect((await listSections(app, project)).some((s) => s.id === section.id)).toBe(false)
    })
  })

  it('patches section fields', async () => {
    await withApp(async (app) => {
      const project = await createProject(app, 'P')
      const section = await createSection(app, project, 'S')
      const res = await app.patch(`/api/v1/sections/${section.id}`, {
        name: 'Renamed',
        is_collapsed: true,
      })
      expect(res.status).toBe(200)
      const body = await json<SectionDto>(res)
      expect(body.name).toBe('Renamed')
      expect(body.is_collapsed).toBe(true)
    })
  })

  it('persists reorder', async () => {
    await withApp(async (app) => {
      const project = await createProject(app, 'P')
      const s1 = await createSection(app, project, 'S1')
      const s2 = await createSection(app, project, 'S2')
      const res = await app.post('/api/v1/sections/reorder', {
        items: [
          { id: s1.id, section_order: 9 },
          { id: s2.id, section_order: 4 },
        ],
      })
      expect(res.status).toBe(204)
      const sections = await listSections(app, project)
      expect(sections.find((s) => s.id === s1.id)?.section_order).toBe(9)
      expect(sections.find((s) => s.id === s2.id)?.section_order).toBe(4)
    })
  })

  it('404s on create against an unknown project and on unknown section ids', async () => {
    await withApp(async (app) => {
      const create = await app.post('/api/v1/sections', { project_id: 'missing', name: 'x' })
      expect(create.status).toBe(404)
      expect((await app.patch('/api/v1/sections/missing', { name: 'x' })).status).toBe(404)
      expect((await app.del('/api/v1/sections/missing')).status).toBe(404)
    })
  })

  it('rejects unauthenticated access', async () => {
    await withApp(async (app) => {
      const res = await app.request('/api/v1/sections')
      expect(res.status).toBe(401)
    })
  })
})
