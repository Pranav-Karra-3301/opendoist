import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, eq, inArray, isNull, max } from 'drizzle-orm'
import type { AppEnv } from '../../app'
import type { Db } from '../../db/db'
import { projects, sections, tasks } from '../../db/schema'
import { logActivity } from '../../lib/activity'
import { newId, nowIso } from '../../lib/ids'
import { problem } from '../../lib/problem'
import { IdSchema, SectionDtoSchema } from '../schemas'

type SectionRow = typeof sections.$inferSelect
type SectionDto = z.infer<typeof SectionDtoSchema>

function sectionToDto(row: SectionRow): SectionDto {
  return {
    id: row.id,
    project_id: row.projectId,
    name: row.name,
    section_order: row.sectionOrder,
    is_archived: row.isArchived,
    is_collapsed: row.isCollapsed,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

function getOwnedSection(db: Db, userId: string, id: string): SectionRow | undefined {
  return db
    .select()
    .from(sections)
    .where(and(eq(sections.id, id), eq(sections.userId, userId), isNull(sections.deletedAt)))
    .get()
}

function ownsProject(db: Db, userId: string, projectId: string): boolean {
  const row = db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId), isNull(projects.deletedAt)))
    .get()
  return row !== undefined
}

const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }]
const commonErrors = {
  400: { description: 'Bad request (application/problem+json)' },
  401: { description: 'Unauthorized (application/problem+json)' },
}
const withNotFound = {
  ...commonErrors,
  404: { description: 'Not found (application/problem+json)' },
}

const SectionListSchema = z.object({
  results: z.array(SectionDtoSchema),
  next_cursor: z.string().nullable(),
})
const CreateSectionSchema = z.object({ project_id: IdSchema, name: z.string().min(1) })
const UpdateSectionSchema = z.object({
  name: z.string().min(1).optional(),
  section_order: z.number().int().optional(),
  is_archived: z.boolean().optional(),
  is_collapsed: z.boolean().optional(),
})
const ReorderSchema = z.object({
  items: z.array(z.object({ id: IdSchema, section_order: z.number().int() })).min(1),
})
const IdParam = z.object({ id: IdSchema })

const listRoute = createRoute({
  method: 'get',
  path: '/sections',
  tags: ['sections'],
  security,
  request: { query: z.object({ project_id: IdSchema.optional() }) },
  responses: {
    200: {
      description: 'Sections (unpaginated envelope); all of the user, or one project when filtered',
      content: { 'application/json': { schema: SectionListSchema } },
    },
    ...commonErrors,
  },
})
const createRouteDef = createRoute({
  method: 'post',
  path: '/sections',
  tags: ['sections'],
  security,
  request: {
    body: { content: { 'application/json': { schema: CreateSectionSchema } }, required: true },
  },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: SectionDtoSchema } } },
    ...withNotFound,
  },
})
const reorderRoute = createRoute({
  method: 'post',
  path: '/sections/reorder',
  tags: ['sections'],
  security,
  request: { body: { content: { 'application/json': { schema: ReorderSchema } }, required: true } },
  responses: { 204: { description: 'Reordered' }, ...withNotFound },
})
const patchRoute = createRoute({
  method: 'patch',
  path: '/sections/{id}',
  tags: ['sections'],
  security,
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: UpdateSectionSchema } }, required: true },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: SectionDtoSchema } } },
    ...withNotFound,
  },
})
const deleteRoute = createRoute({
  method: 'delete',
  path: '/sections/{id}',
  tags: ['sections'],
  security,
  request: { params: IdParam },
  responses: { 204: { description: 'Deleted' }, ...withNotFound },
})

export const sectionsRoutes = () => {
  const app = new OpenAPIHono<AppEnv>()

  app.openapi(listRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db } = c.get('deps')
    const { project_id } = c.req.valid('query')
    const where = [eq(sections.userId, auth.userId), isNull(sections.deletedAt)]
    if (project_id !== undefined) where.push(eq(sections.projectId, project_id))
    const base = db
      .select()
      .from(sections)
      .where(and(...where))
    const rows =
      project_id !== undefined
        ? base.orderBy(sections.sectionOrder).all()
        : base.orderBy(sections.projectId, sections.sectionOrder).all()
    return c.json({ results: rows.map(sectionToDto), next_cursor: null }, 200)
  })

  app.openapi(createRouteDef, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus } = c.get('deps')
    const body = c.req.valid('json')
    if (!ownsProject(db, auth.userId, body.project_id)) {
      return problem(c, 404, 'not found', 'project not found')
    }
    const maxOrder = db
      .select({ m: max(sections.sectionOrder) })
      .from(sections)
      .where(
        and(
          eq(sections.userId, auth.userId),
          eq(sections.projectId, body.project_id),
          isNull(sections.deletedAt),
        ),
      )
      .get()
    const now = nowIso()
    const id = newId()
    const row = db
      .insert(sections)
      .values({
        id,
        userId: auth.userId,
        projectId: body.project_id,
        name: body.name,
        sectionOrder: (maxOrder?.m ?? -1) + 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()
    logActivity(db, {
      userId: auth.userId,
      eventType: 'section_added',
      entityType: 'section',
      entityId: id,
      projectId: body.project_id,
    })
    bus.publish({ userId: auth.userId, type: 'section.created', entity: 'section', ids: [id] })
    return c.json(sectionToDto(row), 201)
  })

  app.openapi(reorderRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus } = c.get('deps')
    const { items } = c.req.valid('json')
    const ids = items.map((i) => i.id)
    const owned = db
      .select({ id: sections.id })
      .from(sections)
      .where(
        and(
          eq(sections.userId, auth.userId),
          isNull(sections.deletedAt),
          inArray(sections.id, ids),
        ),
      )
      .all()
    if (owned.length !== new Set(ids).size) {
      return problem(c, 404, 'not found', 'one or more sections not found')
    }
    const now = nowIso()
    for (const item of items) {
      db.update(sections)
        .set({ sectionOrder: item.section_order, updatedAt: now })
        .where(and(eq(sections.id, item.id), eq(sections.userId, auth.userId)))
        .run()
    }
    bus.publish({ userId: auth.userId, type: 'section.updated', entity: 'section', ids })
    return c.body(null, 204)
  })

  app.openapi(patchRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus } = c.get('deps')
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const section = getOwnedSection(db, auth.userId, id)
    if (section === undefined) return problem(c, 404, 'not found')
    const now = nowIso()
    const updates: Partial<typeof sections.$inferInsert> = { updatedAt: now }
    if (body.name !== undefined) updates.name = body.name
    if (body.section_order !== undefined) updates.sectionOrder = body.section_order
    if (body.is_archived !== undefined) updates.isArchived = body.is_archived
    if (body.is_collapsed !== undefined) updates.isCollapsed = body.is_collapsed
    db.update(sections)
      .set(updates)
      .where(and(eq(sections.id, id), eq(sections.userId, auth.userId)))
      .run()
    const updated = getOwnedSection(db, auth.userId, id)
    if (updated === undefined) return problem(c, 404, 'not found')
    logActivity(db, {
      userId: auth.userId,
      eventType: 'section_updated',
      entityType: 'section',
      entityId: id,
      projectId: section.projectId,
    })
    bus.publish({ userId: auth.userId, type: 'section.updated', entity: 'section', ids: [id] })
    return c.json(sectionToDto(updated), 200)
  })

  app.openapi(deleteRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus } = c.get('deps')
    const { id } = c.req.valid('param')
    const section = getOwnedSection(db, auth.userId, id)
    if (section === undefined) return problem(c, 404, 'not found')
    const now = nowIso()
    db.update(sections)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(sections.id, id), eq(sections.userId, auth.userId)))
      .run()
    // Tasks in the deleted section stay in the project; they just lose their section.
    db.update(tasks)
      .set({ sectionId: null, updatedAt: now })
      .where(and(eq(tasks.userId, auth.userId), eq(tasks.sectionId, id)))
      .run()
    logActivity(db, {
      userId: auth.userId,
      eventType: 'section_deleted',
      entityType: 'section',
      entityId: id,
      projectId: section.projectId,
    })
    bus.publish({ userId: auth.userId, type: 'section.deleted', entity: 'section', ids: [id] })
    return c.body(null, 204)
  })

  return app
}
