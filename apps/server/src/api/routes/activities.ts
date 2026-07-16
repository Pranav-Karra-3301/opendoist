import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, desc, eq, gte, inArray, lt, lte, or, type SQL } from 'drizzle-orm'
import type { AppEnv } from '../../app'
import type { Db } from '../../db/db'
import { activityLog, comments, filters, labels, projects, sections, tasks } from '../../db/schema'
import { decodeCursor, encodeCursor } from '../../lib/pagination'
import { problem } from '../../lib/problem'
import { ActivityDtoSchema, IdSchema } from '../schemas'

const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }]

const ActivitiesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** single event type (phase-3 compat) */
  event_type: z.string().optional(),
  /** csv superset of event_type, e.g. `task_added,task_completed` */
  types: z.string().optional(),
  entity_type: z.string().optional(),
  project_id: IdSchema.optional(),
  since: z.string().optional(),
  until: z.string().optional(),
})

const ActivitiesListSchema = z.object({
  results: z.array(ActivityDtoSchema),
  next_cursor: z.string().nullable(),
})

type ActivityRow = typeof activityLog.$inferSelect
type ActivityPayload = z.infer<typeof ActivityDtoSchema>['payload']

/** Coerce a stored payload JSON string into the `meta` object. Phase-3 payloads are objects,
 *  but PATCH logs the changed-field names as an array — wrap those as `{ changed: [...] }`. */
function toMeta(payloadJson: string | null): Record<string, unknown> {
  if (payloadJson === null) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(payloadJson)
  } catch {
    return {}
  }
  if (parsed === null || typeof parsed !== 'object') return {}
  if (Array.isArray(parsed)) return { changed: parsed }
  return parsed as Record<string, unknown>
}

/**
 * Batch read-time denormalization: for a page of activity rows, resolve each entity's primary text
 * (`content`) and the `project_name` joined from `project_id`. Soft-deleted rows are still looked up
 * so the history keeps its content after a delete. Returns a builder keyed by `${entityType}:${id}`.
 */
function denormalize(
  db: Db,
  userId: string,
  rows: ActivityRow[],
): (row: ActivityRow) => ActivityPayload {
  const idsByType = new Map<string, Set<string>>()
  const projectIds = new Set<string>()
  for (const r of rows) {
    if (r.projectId !== null) projectIds.add(r.projectId)
    const set = idsByType.get(r.entityType)
    if (set === undefined) idsByType.set(r.entityType, new Set([r.entityId]))
    else set.add(r.entityId)
  }

  const content = new Map<string, string>()
  const put = (type: string, pairs: { id: string; text: string }[]): void => {
    for (const p of pairs) content.set(`${type}:${p.id}`, p.text)
  }
  const idsOf = (type: string): string[] => {
    const set = idsByType.get(type)
    return set === undefined ? [] : [...set]
  }
  const taskIds = idsOf('task')
  if (taskIds.length > 0) {
    put(
      'task',
      db
        .select({ id: tasks.id, text: tasks.content })
        .from(tasks)
        .where(and(eq(tasks.userId, userId), inArray(tasks.id, taskIds)))
        .all(),
    )
  }
  const projIds = idsOf('project')
  if (projIds.length > 0) {
    put(
      'project',
      db
        .select({ id: projects.id, text: projects.name })
        .from(projects)
        .where(and(eq(projects.userId, userId), inArray(projects.id, projIds)))
        .all(),
    )
  }
  const sectionIds = idsOf('section')
  if (sectionIds.length > 0) {
    put(
      'section',
      db
        .select({ id: sections.id, text: sections.name })
        .from(sections)
        .where(and(eq(sections.userId, userId), inArray(sections.id, sectionIds)))
        .all(),
    )
  }
  const labelIds = idsOf('label')
  if (labelIds.length > 0) {
    put(
      'label',
      db
        .select({ id: labels.id, text: labels.name })
        .from(labels)
        .where(and(eq(labels.userId, userId), inArray(labels.id, labelIds)))
        .all(),
    )
  }
  const filterIds = idsOf('filter')
  if (filterIds.length > 0) {
    put(
      'filter',
      db
        .select({ id: filters.id, text: filters.name })
        .from(filters)
        .where(and(eq(filters.userId, userId), inArray(filters.id, filterIds)))
        .all(),
    )
  }
  const commentIds = idsOf('comment')
  if (commentIds.length > 0) {
    put(
      'comment',
      db
        .select({ id: comments.id, text: comments.content })
        .from(comments)
        .where(and(eq(comments.userId, userId), inArray(comments.id, commentIds)))
        .all(),
    )
  }

  const projectName = new Map<string, string>()
  if (projectIds.size > 0) {
    for (const p of db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.userId, userId), inArray(projects.id, [...projectIds])))
      .all()) {
      projectName.set(p.id, p.name)
    }
  }

  return (row) => ({
    content: content.get(`${row.entityType}:${row.entityId}`) ?? '',
    project_name: row.projectId === null ? null : (projectName.get(row.projectId) ?? null),
    meta: toMeta(row.payload),
  })
}

const listActivitiesRoute = createRoute({
  method: 'get',
  path: '/activities',
  tags: ['Activities'],
  summary: 'Activity log (read-only)',
  description:
    'Newest-first, unlimited history. Each item carries a read-time-denormalized `payload` ' +
    '(`content`, `project_name`, and the stored event payload under `meta`). Filter by ' +
    '`types` (csv), `event_type` (single), `entity_type`, `project_id`, and `since`/`until`.',
  security,
  request: { query: ActivitiesQuerySchema },
  responses: {
    200: {
      description: 'Activity log',
      content: { 'application/json': { schema: ActivitiesListSchema } },
    },
    400: { description: 'Invalid cursor' },
    401: { description: 'Unauthorized' },
  },
})

export const activitiesRoutes = () => {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return problem(c, 400, 'validation failed', undefined, { errors: result.error.issues })
      }
    },
  })

  app.openapi(listActivitiesRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db } = c.get('deps')
    const { cursor, limit, event_type, types, entity_type, project_id, since, until } =
      c.req.valid('query')

    const conds: SQL[] = [eq(activityLog.userId, auth.userId)]
    if (event_type) conds.push(eq(activityLog.eventType, event_type))
    const typeList = (types ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
    if (typeList.length > 0) conds.push(inArray(activityLog.eventType, typeList))
    if (entity_type) conds.push(eq(activityLog.entityType, entity_type))
    if (project_id) conds.push(eq(activityLog.projectId, project_id))
    if (since) conds.push(gte(activityLog.at, since))
    if (until) conds.push(lte(activityLog.at, until))
    if (cursor !== undefined) {
      const decoded = decodeCursor(cursor)
      if (!decoded) return problem(c, 400, 'invalid cursor')
      const cAt = String(decoded.at)
      const cId = String(decoded.id)
      const keyset = or(
        lt(activityLog.at, cAt),
        and(eq(activityLog.at, cAt), lt(activityLog.id, cId)),
      )
      if (keyset) conds.push(keyset)
    }

    const rows = db
      .select()
      .from(activityLog)
      .where(and(...conds))
      .orderBy(desc(activityLog.at), desc(activityLog.id))
      .limit(limit + 1)
      .all()
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const last = page.at(-1)
    const nextCursor = hasMore && last ? encodeCursor({ at: last.at, id: last.id }) : null

    const payloadFor = denormalize(db, auth.userId, page)
    const results = page.map((row) => ({
      id: row.id,
      event_type: row.eventType,
      entity_type: row.entityType,
      entity_id: row.entityId,
      project_id: row.projectId,
      at: row.at,
      payload: payloadFor(row),
    }))
    return c.json({ results, next_cursor: nextCursor }, 200)
  })

  return app
}
