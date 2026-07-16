import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, eq, isNull, max, ne, sql } from 'drizzle-orm'
import type { AppEnv } from '../../app'
import { labels, taskLabels } from '../../db/schema'
import { logActivity } from '../../lib/activity'
import { newId, nowIso } from '../../lib/ids'
import { problem } from '../../lib/problem'
import { ColorSchema, IdSchema, LabelDtoSchema } from '../schemas'

type LabelRow = typeof labels.$inferSelect
type LabelDto = z.infer<typeof LabelDtoSchema>

function labelToDto(row: LabelRow): LabelDto {
  return {
    id: row.id,
    name: row.name,
    color: row.color as LabelDto['color'],
    item_order: row.itemOrder,
    is_favorite: row.isFavorite,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }]
const tags = ['labels']

const LabelListSchema = z.object({
  results: z.array(LabelDtoSchema),
  next_cursor: z.string().nullable(),
})
const CreateLabelSchema = z.object({
  name: z.string().min(1),
  color: ColorSchema.optional(),
  is_favorite: z.boolean().optional(),
})
const UpdateLabelSchema = z.object({
  name: z.string().min(1).optional(),
  color: ColorSchema.optional(),
  is_favorite: z.boolean().optional(),
})
const ReorderSchema = z.object({
  items: z.array(z.object({ id: IdSchema, item_order: z.number().int() })).min(1),
})
const ParamSchema = z.object({ id: IdSchema })

export const labelsRoutes = () => {
  const app = new OpenAPIHono<AppEnv>()

  // GET /labels — all of the user's labels, ordered by item_order (no pagination).
  app.openapi(
    createRoute({
      method: 'get',
      path: '/labels',
      tags,
      security,
      responses: {
        200: {
          content: { 'application/json': { schema: LabelListSchema } },
          description: 'labels',
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
        .from(labels)
        .where(and(eq(labels.userId, auth.userId), isNull(labels.deletedAt)))
        .orderBy(labels.itemOrder, labels.id)
        .all()
      return c.json({ results: rows.map(labelToDto), next_cursor: null }, 200)
    },
  )

  // POST /labels — create; duplicate name (case-insensitive, per user) → 409.
  app.openapi(
    createRoute({
      method: 'post',
      path: '/labels',
      tags,
      security,
      request: { body: { content: { 'application/json': { schema: CreateLabelSchema } } } },
      responses: {
        201: {
          content: { 'application/json': { schema: LabelDtoSchema } },
          description: 'created',
        },
        401: { description: 'unauthorized' },
        409: { description: 'label exists' },
      },
    }),
    (c) => {
      const { db, bus } = c.get('deps')
      const auth = c.get('auth')
      if (!auth) return problem(c, 401, 'unauthorized')
      const body = c.req.valid('json')
      const dup = db
        .select({ id: labels.id })
        .from(labels)
        .where(
          and(
            eq(labels.userId, auth.userId),
            isNull(labels.deletedAt),
            sql`lower(${labels.name}) = lower(${body.name})`,
          ),
        )
        .get()
      if (dup !== undefined) return problem(c, 409, 'label exists')
      const maxOrder = db
        .select({ m: max(labels.itemOrder) })
        .from(labels)
        .where(and(eq(labels.userId, auth.userId), isNull(labels.deletedAt)))
        .get()
      const now = nowIso()
      const id = newId()
      const row = db
        .insert(labels)
        .values({
          id,
          userId: auth.userId,
          name: body.name,
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
        eventType: 'label_added',
        entityType: 'label',
        entityId: id,
      })
      bus.publish({ userId: auth.userId, type: 'label.created', entity: 'label', ids: [id] })
      return c.json(labelToDto(row), 201)
    },
  )

  // POST /labels/reorder — batch update item_order (registered before /labels/{id}).
  app.openapi(
    createRoute({
      method: 'post',
      path: '/labels/reorder',
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
          .select({ id: labels.id })
          .from(labels)
          .where(
            and(eq(labels.id, item.id), eq(labels.userId, auth.userId), isNull(labels.deletedAt)),
          )
          .get()
        if (owned === undefined) return problem(c, 404, 'not found')
      }
      const now = nowIso()
      for (const item of items) {
        db.update(labels)
          .set({ itemOrder: item.item_order, updatedAt: now })
          .where(and(eq(labels.id, item.id), eq(labels.userId, auth.userId)))
          .run()
      }
      bus.publish({
        userId: auth.userId,
        type: 'label.updated',
        entity: 'label',
        ids: items.map((i) => i.id),
      })
      return c.body(null, 204)
    },
  )

  // PATCH /labels/{id} — rename/recolor; rename re-checks the 409.
  app.openapi(
    createRoute({
      method: 'patch',
      path: '/labels/{id}',
      tags,
      security,
      request: {
        params: ParamSchema,
        body: { content: { 'application/json': { schema: UpdateLabelSchema } } },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: LabelDtoSchema } },
          description: 'updated',
        },
        401: { description: 'unauthorized' },
        404: { description: 'not found' },
        409: { description: 'label exists' },
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
        .from(labels)
        .where(and(eq(labels.id, id), eq(labels.userId, auth.userId), isNull(labels.deletedAt)))
        .get()
      if (existing === undefined) return problem(c, 404, 'not found')
      if (body.name !== undefined) {
        const dup = db
          .select({ id: labels.id })
          .from(labels)
          .where(
            and(
              eq(labels.userId, auth.userId),
              isNull(labels.deletedAt),
              ne(labels.id, id),
              sql`lower(${labels.name}) = lower(${body.name})`,
            ),
          )
          .get()
        if (dup !== undefined) return problem(c, 409, 'label exists')
      }
      const now = nowIso()
      const updated: LabelRow = {
        ...existing,
        name: body.name ?? existing.name,
        color: body.color ?? existing.color,
        isFavorite: body.is_favorite ?? existing.isFavorite,
        updatedAt: now,
      }
      db.update(labels)
        .set({
          name: updated.name,
          color: updated.color,
          isFavorite: updated.isFavorite,
          updatedAt: now,
        })
        .where(eq(labels.id, id))
        .run()
      logActivity(db, {
        userId: auth.userId,
        eventType: 'label_updated',
        entityType: 'label',
        entityId: id,
      })
      bus.publish({ userId: auth.userId, type: 'label.updated', entity: 'label', ids: [id] })
      return c.json(labelToDto(updated), 200)
    },
  )

  // DELETE /labels/{id} — soft-delete the label, hard-delete its task_labels junction rows.
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/labels/{id}',
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
        .select({ id: labels.id })
        .from(labels)
        .where(and(eq(labels.id, id), eq(labels.userId, auth.userId), isNull(labels.deletedAt)))
        .get()
      if (existing === undefined) return problem(c, 404, 'not found')
      const now = nowIso()
      db.update(labels).set({ deletedAt: now, updatedAt: now }).where(eq(labels.id, id)).run()
      db.delete(taskLabels).where(eq(taskLabels.labelId, id)).run()
      logActivity(db, {
        userId: auth.userId,
        eventType: 'label_deleted',
        entityType: 'label',
        entityId: id,
      })
      bus.publish({ userId: auth.userId, type: 'label.deleted', entity: 'label', ids: [id] })
      return c.body(null, 204)
    },
  )

  return app
}
