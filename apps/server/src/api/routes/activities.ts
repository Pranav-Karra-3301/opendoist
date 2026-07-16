import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, desc, eq, gte, lt, lte, or, type SQL } from 'drizzle-orm'
import type { AppEnv } from '../../app'
import { activityLog } from '../../db/schema'
import { ActivityEventTypes } from '../../lib/activity'
import { decodeCursor, encodeCursor } from '../../lib/pagination'
import { problem } from '../../lib/problem'
import { ActivityDtoSchema, IdSchema } from '../schemas'

const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }]

const ActivitiesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  event_type: z.enum(ActivityEventTypes).optional(),
  entity_type: z.string().optional(),
  project_id: IdSchema.optional(),
  since: z.string().optional(),
  until: z.string().optional(),
})

const ActivitiesListSchema = z.object({
  results: z.array(ActivityDtoSchema),
  next_cursor: z.string().nullable(),
})

function toActivityDto(row: typeof activityLog.$inferSelect) {
  return {
    id: row.id,
    event_type: row.eventType,
    entity_type: row.entityType,
    entity_id: row.entityId,
    project_id: row.projectId,
    payload: row.payload === null ? null : (JSON.parse(row.payload) as unknown),
    at: row.at,
  }
}

const listActivitiesRoute = createRoute({
  method: 'get',
  path: '/activities',
  tags: ['Activities'],
  summary: 'Activity log (read-only)',
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
    const { cursor, limit, event_type, entity_type, project_id, since, until } =
      c.req.valid('query')

    const conds: SQL[] = [eq(activityLog.userId, auth.userId)]
    if (event_type) conds.push(eq(activityLog.eventType, event_type))
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
    return c.json({ results: page.map(toActivityDto), next_cursor: nextCursor }, 200)
  })

  return app
}
