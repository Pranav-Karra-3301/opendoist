import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { FilterSyntaxError, parseFilter } from '@opendoist/core'
import { and, eq, isNull, max } from 'drizzle-orm'
import type { Context } from 'hono'
import type { AppEnv } from '../../app'
import { filters } from '../../db/schema'
import { logActivity } from '../../lib/activity'
import { newId, nowIso } from '../../lib/ids'
import { problem } from '../../lib/problem'
import { ColorSchema, FilterDtoSchema, IdSchema } from '../schemas'

type FilterRow = typeof filters.$inferSelect
type FilterDto = z.infer<typeof FilterDtoSchema>

function filterToDto(row: FilterRow): FilterDto {
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    color: row.color as FilterDto['color'],
    item_order: row.itemOrder,
    is_favorite: row.isFavorite,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

/**
 * Validate a filter query against the core grammar. Returns a 400 problem
 * (`invalid filter query`, with the numeric `position`) when it fails to parse,
 * or `null` when the query is valid. Re-throws non-syntax errors.
 */
function validateQuery(c: Context, query: string): Response | null {
  try {
    parseFilter(query)
    return null
  } catch (err) {
    if (err instanceof FilterSyntaxError) {
      return problem(c, 400, 'invalid filter query', err.message, { position: err.position })
    }
    throw err
  }
}

const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }]
const tags = ['filters']

const FilterListSchema = z.object({
  results: z.array(FilterDtoSchema),
  next_cursor: z.string().nullable(),
})
const CreateFilterSchema = z.object({
  name: z.string().min(1),
  query: z.string().min(1),
  color: ColorSchema.optional(),
  is_favorite: z.boolean().optional(),
})
const UpdateFilterSchema = z.object({
  name: z.string().min(1).optional(),
  query: z.string().min(1).optional(),
  color: ColorSchema.optional(),
  is_favorite: z.boolean().optional(),
})
const ReorderSchema = z.object({
  items: z.array(z.object({ id: IdSchema, item_order: z.number().int() })).min(1),
})
const ParamSchema = z.object({ id: IdSchema })

export const filtersRoutes = () => {
  const app = new OpenAPIHono<AppEnv>()

  // GET /filters — all of the user's filters, ordered by item_order (no pagination).
  app.openapi(
    createRoute({
      method: 'get',
      path: '/filters',
      tags,
      security,
      responses: {
        200: {
          content: { 'application/json': { schema: FilterListSchema } },
          description: 'filters',
        },
        401: { description: 'unauthorized' },
      },
    }),
    (c) => {
      const { db } = c.get('deps')
      const auth = c.get('auth')
      if (!auth) return problem(c, 401, 'unauthorized')
      const rows = db
        .select()
        .from(filters)
        .where(and(eq(filters.userId, auth.userId), isNull(filters.deletedAt)))
        .orderBy(filters.itemOrder, filters.id)
        .all()
      return c.json({ results: rows.map(filterToDto), next_cursor: null }, 200)
    },
  )

  // POST /filters — create; `query` is validated by the core filter parser.
  app.openapi(
    createRoute({
      method: 'post',
      path: '/filters',
      tags,
      security,
      request: { body: { content: { 'application/json': { schema: CreateFilterSchema } } } },
      responses: {
        201: {
          content: { 'application/json': { schema: FilterDtoSchema } },
          description: 'created',
        },
        400: { description: 'invalid filter query' },
        401: { description: 'unauthorized' },
      },
    }),
    (c) => {
      const { db, bus } = c.get('deps')
      const auth = c.get('auth')
      if (!auth) return problem(c, 401, 'unauthorized')
      const body = c.req.valid('json')
      const invalid = validateQuery(c, body.query)
      if (invalid !== null) return invalid
      const maxOrder = db
        .select({ m: max(filters.itemOrder) })
        .from(filters)
        .where(and(eq(filters.userId, auth.userId), isNull(filters.deletedAt)))
        .get()
      const now = nowIso()
      const id = newId()
      const row = db
        .insert(filters)
        .values({
          id,
          userId: auth.userId,
          name: body.name,
          query: body.query,
          color: body.color ?? 'charcoal',
          itemOrder: (maxOrder?.m ?? -1) + 1,
          isFavorite: body.is_favorite ?? false,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get()
      logActivity(db, {
        userId: auth.userId,
        eventType: 'filter_added',
        entityType: 'filter',
        entityId: id,
      })
      bus.publish({ userId: auth.userId, type: 'filter.created', entity: 'filter', ids: [id] })
      return c.json(filterToDto(row), 201)
    },
  )

  // POST /filters/reorder — batch update item_order (registered before /filters/{id}).
  app.openapi(
    createRoute({
      method: 'post',
      path: '/filters/reorder',
      tags,
      security,
      request: { body: { content: { 'application/json': { schema: ReorderSchema } } } },
      responses: {
        204: { description: 'reordered' },
        401: { description: 'unauthorized' },
        404: { description: 'not found' },
      },
    }),
    (c) => {
      const { db, bus } = c.get('deps')
      const auth = c.get('auth')
      if (!auth) return problem(c, 401, 'unauthorized')
      const { items } = c.req.valid('json')
      for (const item of items) {
        const owned = db
          .select({ id: filters.id })
          .from(filters)
          .where(
            and(
              eq(filters.id, item.id),
              eq(filters.userId, auth.userId),
              isNull(filters.deletedAt),
            ),
          )
          .get()
        if (owned === undefined) return problem(c, 404, 'not found')
      }
      const now = nowIso()
      for (const item of items) {
        db.update(filters)
          .set({ itemOrder: item.item_order, updatedAt: now })
          .where(and(eq(filters.id, item.id), eq(filters.userId, auth.userId)))
          .run()
      }
      bus.publish({
        userId: auth.userId,
        type: 'filter.updated',
        entity: 'filter',
        ids: items.map((i) => i.id),
      })
      return c.body(null, 204)
    },
  )

  // PATCH /filters/{id} — partial update; `query` is revalidated before any write.
  app.openapi(
    createRoute({
      method: 'patch',
      path: '/filters/{id}',
      tags,
      security,
      request: {
        params: ParamSchema,
        body: { content: { 'application/json': { schema: UpdateFilterSchema } } },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: FilterDtoSchema } },
          description: 'updated',
        },
        400: { description: 'invalid filter query' },
        401: { description: 'unauthorized' },
        404: { description: 'not found' },
      },
    }),
    (c) => {
      const { db, bus } = c.get('deps')
      const auth = c.get('auth')
      if (!auth) return problem(c, 401, 'unauthorized')
      const { id } = c.req.valid('param')
      const body = c.req.valid('json')
      const existing = db
        .select()
        .from(filters)
        .where(and(eq(filters.id, id), eq(filters.userId, auth.userId), isNull(filters.deletedAt)))
        .get()
      if (existing === undefined) return problem(c, 404, 'not found')
      if (body.query !== undefined) {
        const invalid = validateQuery(c, body.query)
        if (invalid !== null) return invalid
      }
      const now = nowIso()
      const updated: FilterRow = {
        ...existing,
        name: body.name ?? existing.name,
        query: body.query ?? existing.query,
        color: body.color ?? existing.color,
        isFavorite: body.is_favorite ?? existing.isFavorite,
        updatedAt: now,
      }
      db.update(filters)
        .set({
          name: updated.name,
          query: updated.query,
          color: updated.color,
          isFavorite: updated.isFavorite,
          updatedAt: now,
        })
        .where(eq(filters.id, id))
        .run()
      logActivity(db, {
        userId: auth.userId,
        eventType: 'filter_updated',
        entityType: 'filter',
        entityId: id,
      })
      bus.publish({ userId: auth.userId, type: 'filter.updated', entity: 'filter', ids: [id] })
      return c.json(filterToDto(updated), 200)
    },
  )

  // DELETE /filters/{id} — soft-delete.
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/filters/{id}',
      tags,
      security,
      request: { params: ParamSchema },
      responses: {
        204: { description: 'deleted' },
        401: { description: 'unauthorized' },
        404: { description: 'not found' },
      },
    }),
    (c) => {
      const { db, bus } = c.get('deps')
      const auth = c.get('auth')
      if (!auth) return problem(c, 401, 'unauthorized')
      const { id } = c.req.valid('param')
      const existing = db
        .select({ id: filters.id })
        .from(filters)
        .where(and(eq(filters.id, id), eq(filters.userId, auth.userId), isNull(filters.deletedAt)))
        .get()
      if (existing === undefined) return problem(c, 404, 'not found')
      const now = nowIso()
      db.update(filters).set({ deletedAt: now, updatedAt: now }).where(eq(filters.id, id)).run()
      logActivity(db, {
        userId: auth.userId,
        eventType: 'filter_deleted',
        entityType: 'filter',
        entityId: id,
      })
      bus.publish({ userId: auth.userId, type: 'filter.deleted', entity: 'filter', ids: [id] })
      return c.body(null, 204)
    },
  )

  return app
}
