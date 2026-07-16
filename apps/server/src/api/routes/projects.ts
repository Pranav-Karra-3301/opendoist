import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, eq, inArray, isNotNull, isNull, max } from 'drizzle-orm'
import type { AppEnv } from '../../app'
import type { Db } from '../../db/db'
import { projects, sections, tasks } from '../../db/schema'
import { logActivity } from '../../lib/activity'
import { newId, nowIso } from '../../lib/ids'
import { queryBool } from '../../lib/pagination'
import { problem } from '../../lib/problem'
import { ColorSchema, IdSchema, ProjectDtoSchema } from '../schemas'

type ProjectRow = typeof projects.$inferSelect
type ProjectDto = z.infer<typeof ProjectDtoSchema>

function projectToDto(row: ProjectRow): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color as ProjectDto['color'],
    parent_id: row.parentId,
    child_order: row.childOrder,
    is_favorite: row.isFavorite,
    is_archived: row.isArchived,
    is_collapsed: row.isCollapsed,
    is_inbox: row.isInbox,
    view_prefs: row.viewPrefs === null ? null : (JSON.parse(row.viewPrefs) as unknown),
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

/** The project if it exists, is owned by `userId`, and is not soft-deleted. */
function getOwnedProject(db: Db, userId: string, id: string): ProjectRow | undefined {
  return db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId), isNull(projects.deletedAt)))
    .get()
}

/** `rootId` plus every non-deleted descendant project id (BFS over parent links). */
function collectSubtree(db: Db, userId: string, rootId: string): string[] {
  const rows = db
    .select({ id: projects.id, parentId: projects.parentId })
    .from(projects)
    .where(and(eq(projects.userId, userId), isNull(projects.deletedAt)))
    .all()
  const childrenByParent = new Map<string, string[]>()
  for (const r of rows) {
    if (r.parentId === null) continue
    const list = childrenByParent.get(r.parentId)
    if (list === undefined) childrenByParent.set(r.parentId, [r.id])
    else list.push(r.id)
  }
  const result: string[] = []
  const stack: string[] = [rootId]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) break
    result.push(current)
    for (const child of childrenByParent.get(current) ?? []) stack.push(child)
  }
  return result
}

/** True if reparenting `id` under `newParentId` would create a cycle (self or descendant). */
function createsCycle(db: Db, userId: string, id: string, newParentId: string): boolean {
  let cursor: string | null = newParentId
  const seen = new Set<string>()
  while (cursor !== null) {
    if (cursor === id) return true
    if (seen.has(cursor)) return false
    seen.add(cursor)
    const row = db
      .select({ parentId: projects.parentId })
      .from(projects)
      .where(and(eq(projects.id, cursor), eq(projects.userId, userId)))
      .get()
    cursor = row?.parentId ?? null
  }
  return false
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
const withForbidden = {
  ...withNotFound,
  403: { description: 'Forbidden (application/problem+json)' },
}

const ProjectListSchema = z.object({
  results: z.array(ProjectDtoSchema),
  next_cursor: z.string().nullable(),
})
const OkSchema = z.object({ ok: z.boolean() })
const CreateProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  color: ColorSchema.optional(),
  parent_id: IdSchema.nullable().optional(),
  is_favorite: z.boolean().optional(),
})
const UpdateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  color: ColorSchema.optional(),
  parent_id: IdSchema.nullable().optional(),
  is_favorite: z.boolean().optional(),
  is_collapsed: z.boolean().optional(),
  view_prefs: z.unknown().optional(),
})
const ReorderSchema = z.object({
  items: z.array(z.object({ id: IdSchema, child_order: z.number().int() })).min(1),
})
const IdParam = z.object({ id: IdSchema })

const listRoute = createRoute({
  method: 'get',
  path: '/projects',
  tags: ['projects'],
  security,
  request: { query: z.object({ include_archived: queryBool(false) }) },
  responses: {
    200: {
      description: 'All projects (unpaginated envelope)',
      content: { 'application/json': { schema: ProjectListSchema } },
    },
    ...commonErrors,
  },
})
const createRouteDef = createRoute({
  method: 'post',
  path: '/projects',
  tags: ['projects'],
  security,
  request: {
    body: { content: { 'application/json': { schema: CreateProjectSchema } }, required: true },
  },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: ProjectDtoSchema } } },
    ...withNotFound,
  },
})
const reorderRoute = createRoute({
  method: 'post',
  path: '/projects/reorder',
  tags: ['projects'],
  security,
  request: { body: { content: { 'application/json': { schema: ReorderSchema } }, required: true } },
  responses: { 204: { description: 'Reordered' }, ...withNotFound },
})
const getRoute = createRoute({
  method: 'get',
  path: '/projects/{id}',
  tags: ['projects'],
  security,
  request: { params: IdParam },
  responses: {
    200: { description: 'Project', content: { 'application/json': { schema: ProjectDtoSchema } } },
    ...withNotFound,
  },
})
const patchRoute = createRoute({
  method: 'patch',
  path: '/projects/{id}',
  tags: ['projects'],
  security,
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: UpdateProjectSchema } }, required: true },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: ProjectDtoSchema } } },
    ...withNotFound,
  },
})
const deleteRoute = createRoute({
  method: 'delete',
  path: '/projects/{id}',
  tags: ['projects'],
  security,
  request: { params: IdParam },
  responses: { 204: { description: 'Deleted' }, ...withForbidden },
})
const archiveRoute = createRoute({
  method: 'post',
  path: '/projects/{id}/archive',
  tags: ['projects'],
  security,
  request: { params: IdParam },
  responses: {
    200: { description: 'Archived', content: { 'application/json': { schema: ProjectDtoSchema } } },
    ...withForbidden,
  },
})
const unarchiveRoute = createRoute({
  method: 'post',
  path: '/projects/{id}/unarchive',
  tags: ['projects'],
  security,
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Unarchived',
      content: { 'application/json': { schema: ProjectDtoSchema } },
    },
    ...withForbidden,
  },
})
const restoreRoute = createRoute({
  method: 'post',
  path: '/projects/{id}/restore',
  tags: ['projects'],
  summary: 'Restore a soft-deleted project and its cascade',
  description:
    'Clears `deleted_at` on the project and every section/task deleted in the same cascade ' +
    '(delete stamps an identical `deleted_at`). Powers the delete-project undo.',
  security,
  request: { params: IdParam },
  responses: {
    200: { description: 'Restored', content: { 'application/json': { schema: OkSchema } } },
    ...withNotFound,
  },
})

export const projectsRoutes = () => {
  const app = new OpenAPIHono<AppEnv>()

  app.openapi(listRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db } = c.get('deps')
    const { include_archived } = c.req.valid('query')
    const where = [eq(projects.userId, auth.userId), isNull(projects.deletedAt)]
    if (!include_archived) where.push(eq(projects.isArchived, false))
    const rows = db
      .select()
      .from(projects)
      .where(and(...where))
      .orderBy(projects.parentId, projects.childOrder)
      .all()
    return c.json({ results: rows.map(projectToDto), next_cursor: null }, 200)
  })

  app.openapi(createRouteDef, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus } = c.get('deps')
    const body = c.req.valid('json')
    const parentId = body.parent_id ?? null
    if (parentId !== null && getOwnedProject(db, auth.userId, parentId) === undefined) {
      return problem(c, 404, 'not found', 'parent project not found')
    }
    const maxOrder = db
      .select({ m: max(projects.childOrder) })
      .from(projects)
      .where(
        and(
          eq(projects.userId, auth.userId),
          parentId === null ? isNull(projects.parentId) : eq(projects.parentId, parentId),
          isNull(projects.deletedAt),
        ),
      )
      .get()
    const now = nowIso()
    const id = newId()
    const row = db
      .insert(projects)
      .values({
        id,
        userId: auth.userId,
        name: body.name,
        description: body.description ?? '',
        color: body.color ?? 'charcoal',
        parentId,
        childOrder: (maxOrder?.m ?? -1) + 1,
        isFavorite: body.is_favorite ?? false,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()
    logActivity(db, {
      userId: auth.userId,
      eventType: 'project_added',
      entityType: 'project',
      entityId: id,
      projectId: id,
    })
    bus.publish({ userId: auth.userId, type: 'project.created', entity: 'project', ids: [id] })
    return c.json(projectToDto(row), 201)
  })

  app.openapi(reorderRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus } = c.get('deps')
    const { items } = c.req.valid('json')
    const ids = items.map((i) => i.id)
    const owned = db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.userId, auth.userId),
          isNull(projects.deletedAt),
          inArray(projects.id, ids),
        ),
      )
      .all()
    if (owned.length !== new Set(ids).size) {
      return problem(c, 404, 'not found', 'one or more projects not found')
    }
    const now = nowIso()
    for (const item of items) {
      db.update(projects)
        .set({ childOrder: item.child_order, updatedAt: now })
        .where(and(eq(projects.id, item.id), eq(projects.userId, auth.userId)))
        .run()
    }
    bus.publish({ userId: auth.userId, type: 'project.updated', entity: 'project', ids })
    return c.body(null, 204)
  })

  app.openapi(getRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db } = c.get('deps')
    const { id } = c.req.valid('param')
    const project = getOwnedProject(db, auth.userId, id)
    if (project === undefined) return problem(c, 404, 'not found')
    return c.json(projectToDto(project), 200)
  })

  app.openapi(patchRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus } = c.get('deps')
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const project = getOwnedProject(db, auth.userId, id)
    if (project === undefined) return problem(c, 404, 'not found')

    const changed = Object.entries(body)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k)
    if (project.isInbox) {
      const allowed = new Set(['is_collapsed', 'view_prefs'])
      if (changed.some((k) => !allowed.has(k))) {
        return problem(
          c,
          400,
          'inbox is restricted',
          'only is_collapsed and view_prefs may be changed on the inbox project',
        )
      }
    }

    const now = nowIso()
    const updates: Partial<typeof projects.$inferInsert> = { updatedAt: now }
    if (body.name !== undefined) updates.name = body.name
    if (body.description !== undefined) updates.description = body.description
    if (body.color !== undefined) updates.color = body.color
    if (body.is_favorite !== undefined) updates.isFavorite = body.is_favorite
    if (body.is_collapsed !== undefined) updates.isCollapsed = body.is_collapsed
    if (body.view_prefs !== undefined) {
      updates.viewPrefs = body.view_prefs === null ? null : JSON.stringify(body.view_prefs)
    }
    if (body.parent_id !== undefined) {
      const parentId = body.parent_id
      if (parentId !== null) {
        if (getOwnedProject(db, auth.userId, parentId) === undefined) {
          return problem(c, 404, 'not found', 'parent project not found')
        }
        if (createsCycle(db, auth.userId, id, parentId)) {
          return problem(
            c,
            400,
            'invalid parent',
            'cannot reparent a project under itself or one of its descendants',
          )
        }
      }
      updates.parentId = parentId
    }

    db.update(projects)
      .set(updates)
      .where(and(eq(projects.id, id), eq(projects.userId, auth.userId)))
      .run()
    const updated = getOwnedProject(db, auth.userId, id)
    if (updated === undefined) return problem(c, 404, 'not found')
    logActivity(db, {
      userId: auth.userId,
      eventType: 'project_updated',
      entityType: 'project',
      entityId: id,
      projectId: id,
      payload: { changed },
    })
    bus.publish({ userId: auth.userId, type: 'project.updated', entity: 'project', ids: [id] })
    return c.json(projectToDto(updated), 200)
  })

  app.openapi(deleteRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus } = c.get('deps')
    const { id } = c.req.valid('param')
    const project = getOwnedProject(db, auth.userId, id)
    if (project === undefined) return problem(c, 404, 'not found')
    if (project.isInbox) return problem(c, 403, 'inbox is undeletable')

    const subtree = collectSubtree(db, auth.userId, id)
    const now = nowIso()
    db.update(projects)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(projects.userId, auth.userId), inArray(projects.id, subtree)))
      .run()
    db.update(sections)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(sections.userId, auth.userId), inArray(sections.projectId, subtree)))
      .run()
    db.update(tasks)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(tasks.userId, auth.userId), inArray(tasks.projectId, subtree)))
      .run()
    logActivity(db, {
      userId: auth.userId,
      eventType: 'project_deleted',
      entityType: 'project',
      entityId: id,
      projectId: id,
    })
    bus.publish({ userId: auth.userId, type: 'project.deleted', entity: 'project', ids: subtree })
    return c.body(null, 204)
  })

  app.openapi(archiveRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus } = c.get('deps')
    const { id } = c.req.valid('param')
    const project = getOwnedProject(db, auth.userId, id)
    if (project === undefined) return problem(c, 404, 'not found')
    if (project.isInbox) return problem(c, 403, 'inbox is undeletable')

    const subtree = collectSubtree(db, auth.userId, id)
    const now = nowIso()
    db.update(projects)
      .set({ isArchived: true, updatedAt: now })
      .where(and(eq(projects.userId, auth.userId), inArray(projects.id, subtree)))
      .run()
    logActivity(db, {
      userId: auth.userId,
      eventType: 'project_archived',
      entityType: 'project',
      entityId: id,
      projectId: id,
    })
    bus.publish({ userId: auth.userId, type: 'project.archived', entity: 'project', ids: subtree })
    const updated = getOwnedProject(db, auth.userId, id)
    if (updated === undefined) return problem(c, 404, 'not found')
    return c.json(projectToDto(updated), 200)
  })

  app.openapi(unarchiveRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus } = c.get('deps')
    const { id } = c.req.valid('param')
    const project = getOwnedProject(db, auth.userId, id)
    if (project === undefined) return problem(c, 404, 'not found')

    const subtree = collectSubtree(db, auth.userId, id)
    const now = nowIso()
    db.update(projects)
      .set({ isArchived: false, updatedAt: now })
      .where(and(eq(projects.userId, auth.userId), inArray(projects.id, subtree)))
      .run()
    logActivity(db, {
      userId: auth.userId,
      eventType: 'project_unarchived',
      entityType: 'project',
      entityId: id,
      projectId: id,
    })
    bus.publish({
      userId: auth.userId,
      type: 'project.unarchived',
      entity: 'project',
      ids: subtree,
    })
    const updated = getOwnedProject(db, auth.userId, id)
    if (updated === undefined) return problem(c, 404, 'not found')
    return c.json(projectToDto(updated), 200)
  })

  app.openapi(restoreRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus } = c.get('deps')
    const { id } = c.req.valid('param')
    const project = db
      .select()
      .from(projects)
      .where(
        and(eq(projects.id, id), eq(projects.userId, auth.userId), isNotNull(projects.deletedAt)),
      )
      .get()
    if (project === undefined || project.deletedAt === null) return problem(c, 404, 'not found')
    const marker = project.deletedAt

    // The delete handler stamps projects + their sections + their tasks with one identical
    // `deleted_at`, so the marker restores exactly that cascade.
    const now = nowIso()
    db.update(projects)
      .set({ deletedAt: null, updatedAt: now })
      .where(and(eq(projects.userId, auth.userId), eq(projects.deletedAt, marker)))
      .run()
    db.update(sections)
      .set({ deletedAt: null, updatedAt: now })
      .where(and(eq(sections.userId, auth.userId), eq(sections.deletedAt, marker)))
      .run()
    db.update(tasks)
      .set({ deletedAt: null, updatedAt: now })
      .where(and(eq(tasks.userId, auth.userId), eq(tasks.deletedAt, marker)))
      .run()
    logActivity(db, {
      userId: auth.userId,
      eventType: 'project_restored',
      entityType: 'project',
      entityId: id,
      projectId: id,
    })
    bus.publish({ userId: auth.userId, type: 'project.restored', entity: 'project', ids: [id] })
    return c.json({ ok: true }, 200)
  })

  return app
}
