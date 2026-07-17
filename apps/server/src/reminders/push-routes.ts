import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, eq } from 'drizzle-orm'
import type { AppEnv } from '../app'
import { pushSubscriptions } from '../db/schema'
import { newId, nowIso } from '../lib/ids'
import { problem } from '../lib/problem'
import { getOrCreateVapidKeys } from '../secrets'
import { PushSubscriptionBodySchema, PushSubscriptionDtoSchema } from './contracts'

type PushRow = typeof pushSubscriptions.$inferSelect
type PushSubscriptionDto = z.infer<typeof PushSubscriptionDtoSchema>

function toDto(row: PushRow): PushSubscriptionDto {
  return {
    id: row.id,
    endpoint: row.endpoint,
    user_agent: row.userAgent,
    created_at: row.createdAt,
    last_used_at: row.lastUsedAt,
  }
}

const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }]
const tags = ['push']

const ListSchema = z.object({ results: z.array(PushSubscriptionDtoSchema) })
const VapidKeySchema = z.object({ public_key: z.string() })
const ParamSchema = z.object({ id: z.string().min(1) })

/**
 * Browser push-subscription management + the public VAPID key the client subscribes with.
 * Mounted under /api/v1 by the app wiring; the auth guard there already enforces auth + scope,
 * but each handler re-checks defensively (matching the phase-3 route convention).
 */
export const pushRoutes = () => {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return problem(c, 400, 'validation failed', undefined, { errors: result.error.issues })
      }
    },
  })

  // GET /push-subscriptions — the user's registered devices (full endpoint; single-user instance).
  app.openapi(
    createRoute({
      method: 'get',
      path: '/push-subscriptions',
      tags,
      security,
      responses: {
        200: { content: { 'application/json': { schema: ListSchema } }, description: 'devices' },
        401: { description: 'unauthorized' },
      },
    }),
    (c) => {
      const { db } = c.get('deps')
      const auth = c.get('auth')
      if (!auth) return problem(c, 401, 'unauthorized')
      const rows = db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, auth.userId))
        .orderBy(pushSubscriptions.createdAt, pushSubscriptions.id)
        .all()
      return c.json({ results: rows.map(toDto) }, 200)
    },
  )

  // POST /push-subscriptions — upsert on endpoint: re-subscribing the same endpoint refreshes its
  // keys/user_agent and keeps the original row id (the browser may resubscribe with rotated keys).
  app.openapi(
    createRoute({
      method: 'post',
      path: '/push-subscriptions',
      tags,
      security,
      request: {
        body: { content: { 'application/json': { schema: PushSubscriptionBodySchema } } },
      },
      responses: {
        201: {
          content: { 'application/json': { schema: PushSubscriptionDtoSchema } },
          description: 'subscribed',
        },
        400: { description: 'validation failed' },
        401: { description: 'unauthorized' },
      },
    }),
    (c) => {
      const { db, bus } = c.get('deps')
      const auth = c.get('auth')
      if (!auth) return problem(c, 401, 'unauthorized')
      const body = c.req.valid('json')
      const now = nowIso()
      const row = db
        .insert(pushSubscriptions)
        .values({
          id: newId(),
          userId: auth.userId,
          endpoint: body.endpoint,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          userAgent: body.user_agent ?? null,
          createdAt: now,
          lastUsedAt: null,
        })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: {
            p256dh: body.keys.p256dh,
            auth: body.keys.auth,
            userAgent: body.user_agent ?? null,
            lastUsedAt: now,
          },
        })
        .returning()
        .get()
      bus.publish({
        userId: auth.userId,
        type: 'push_subscriptions.created',
        entity: 'push_subscriptions',
        ids: [row.id],
      })
      return c.json(toDto(row), 201)
    },
  )

  // DELETE /push-subscriptions/{id} — revoke a device (hard delete; the row is worthless once gone).
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/push-subscriptions/{id}',
      tags,
      security,
      request: { params: ParamSchema },
      responses: {
        204: { description: 'revoked' },
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
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(and(eq(pushSubscriptions.id, id), eq(pushSubscriptions.userId, auth.userId)))
        .get()
      if (existing === undefined) return problem(c, 404, 'not found')
      db.delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.id, id), eq(pushSubscriptions.userId, auth.userId)))
        .run()
      bus.publish({
        userId: auth.userId,
        type: 'push_subscriptions.deleted',
        entity: 'push_subscriptions',
        ids: [id],
      })
      return c.body(null, 204)
    },
  )

  // GET /push/vapid-public-key — the applicationServerKey the browser needs to subscribe. Read from
  // request-scoped config so it resolves the instance's persisted key (never regenerated).
  app.openapi(
    createRoute({
      method: 'get',
      path: '/push/vapid-public-key',
      tags,
      security,
      responses: {
        200: { content: { 'application/json': { schema: VapidKeySchema } }, description: 'key' },
        401: { description: 'unauthorized' },
      },
    }),
    (c) => {
      const { config } = c.get('deps')
      const auth = c.get('auth')
      if (!auth) return problem(c, 401, 'unauthorized')
      const { publicKey } = getOrCreateVapidKeys({
        dataDir: config.dataDir,
        publicUrl: config.publicUrl,
      })
      return c.json({ public_key: publicKey }, 200)
    },
  )

  return app
}
