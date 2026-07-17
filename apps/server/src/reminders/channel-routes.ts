import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, eq } from 'drizzle-orm'
import type { AppEnv } from '../app'
import { notificationChannels } from '../db/schema'
import { newId, nowIso } from '../lib/ids'
import { problem } from '../lib/problem'
import { defaultChannelDeps, sendToChannel } from './channels/index'
import {
  type ChannelDeps,
  type ChannelDto,
  ChannelDtoSchema,
  CreateChannelBodySchema,
  GotifyConfigSchema,
  NtfyConfigSchema,
  type ReminderPayload,
  UpdateChannelBodySchema,
  WebhookConfigSchema,
} from './contracts'

/**
 * Notification-channel CRUD + test-fire (phase 6 Task I). All routes are authed (mounted under
 * /api/v1 by Task A's app wiring) and single-user/owner-scoped: the full config is returned so the
 * settings UI can edit it. Every mutation publishes SSE `{entity: 'notification_channels'}`.
 * Test-fire bypasses the dispatcher entirely — it never touches the failure counters.
 */

type ChannelRow = typeof notificationChannels.$inferSelect

const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }]
const tags = ['channels']

const ChannelListSchema = z.object({ results: z.array(ChannelDtoSchema) })
const TestOutcomeSchema = z.object({ outcome: z.enum(['delivered', 'gone', 'error']) })
const ParamSchema = z.object({ id: z.string() })

/** Parse a stored configJson with the row-type's schema, so the DTO `config` union is well-typed. */
function channelToDto(row: ChannelRow): ChannelDto {
  const raw: unknown = JSON.parse(row.configJson)
  const config =
    row.type === 'ntfy'
      ? NtfyConfigSchema.parse(raw)
      : row.type === 'gotify'
        ? GotifyConfigSchema.parse(raw)
        : WebhookConfigSchema.parse(raw)
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    enabled: row.enabled,
    config,
    consecutive_failures: row.consecutiveFailures,
    disabled_reason: row.disabledReason,
    created_at: row.createdAt,
  }
}

export const channelRoutes = () => {
  const app = new OpenAPIHono<AppEnv>()

  // GET /channels — every channel the user owns (config included; owner-only instance).
  app.openapi(
    createRoute({
      method: 'get',
      path: '/channels',
      tags,
      security,
      responses: {
        200: {
          content: { 'application/json': { schema: ChannelListSchema } },
          description: 'channels',
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
        .from(notificationChannels)
        .where(eq(notificationChannels.userId, auth.userId))
        .orderBy(notificationChannels.createdAt, notificationChannels.id)
        .all()
      return c.json({ results: rows.map(channelToDto) }, 200)
    },
  )

  // POST /channels — create; body is a discriminated union so config is type-checked per type.
  app.openapi(
    createRoute({
      method: 'post',
      path: '/channels',
      tags,
      security,
      request: { body: { content: { 'application/json': { schema: CreateChannelBodySchema } } } },
      responses: {
        201: {
          content: { 'application/json': { schema: ChannelDtoSchema } },
          description: 'created',
        },
        400: { description: 'invalid channel' },
        401: { description: 'unauthorized' },
      },
    }),
    (c) => {
      const { db, bus } = c.get('deps')
      const auth = c.get('auth')
      if (!auth) return problem(c, 401, 'unauthorized')
      const body = c.req.valid('json')
      const now = nowIso()
      const id = newId()
      const row = db
        .insert(notificationChannels)
        .values({
          id,
          userId: auth.userId,
          type: body.type,
          name: body.name,
          enabled: true,
          configJson: JSON.stringify(body.config),
          consecutiveFailures: 0,
          disabledReason: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get()
      bus.publish({
        userId: auth.userId,
        type: 'notification_channels.created',
        entity: 'notification_channels',
        ids: [id],
      })
      return c.json(channelToDto(row), 201)
    },
  )

  // POST /channels/{id}/test — fire the standard test payload straight at the adapter registry.
  // Deliberately bypasses the dispatcher: outcome is reported but failure counters never change.
  app.openapi(
    createRoute({
      method: 'post',
      path: '/channels/{id}/test',
      tags,
      security,
      request: { params: ParamSchema },
      responses: {
        200: {
          content: { 'application/json': { schema: TestOutcomeSchema } },
          description: 'test outcome',
        },
        401: { description: 'unauthorized' },
        404: { description: 'not found' },
      },
    }),
    async (c) => {
      const { db, config, logger } = c.get('deps')
      const auth = c.get('auth')
      if (!auth) return problem(c, 401, 'unauthorized')
      const { id } = c.req.valid('param')
      const row = db
        .select()
        .from(notificationChannels)
        .where(and(eq(notificationChannels.id, id), eq(notificationChannels.userId, auth.userId)))
        .get()
      if (row === undefined) return problem(c, 404, 'not found')
      const appRoot = (config.publicUrl ?? 'http://localhost:7968').replace(/\/+$/, '')
      const payload: ReminderPayload = {
        title: 'Test notification from OpenDoist',
        body: `Your ${row.name} channel works.`,
        url: appRoot,
        tag: `channel-test-${row.id}`,
        task_id: 'test',
        reminder_id: 'test',
        fired_at: nowIso(),
        priority: 4,
        due: null,
        test: true,
      }
      const log: ChannelDeps['log'] = (level, msg, data) => {
        logger[level](data ?? {}, msg)
      }
      const outcome = await sendToChannel(
        row.type,
        row.configJson,
        payload,
        defaultChannelDeps(log),
      )
      return c.json({ outcome }, 200)
    },
  )

  // PATCH /channels/{id} — rename / toggle / reconfigure. Config is re-validated against the row's
  // OWN type (the update union would otherwise accept a foreign shape). Any config change or an
  // explicit `enabled: true` clears the auto-disable state (counter → 0, reason → null).
  app.openapi(
    createRoute({
      method: 'patch',
      path: '/channels/{id}',
      tags,
      security,
      request: {
        params: ParamSchema,
        body: { content: { 'application/json': { schema: UpdateChannelBodySchema } } },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: ChannelDtoSchema } },
          description: 'updated',
        },
        400: { description: 'invalid channel config' },
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
        .from(notificationChannels)
        .where(and(eq(notificationChannels.id, id), eq(notificationChannels.userId, auth.userId)))
        .get()
      if (existing === undefined) return problem(c, 404, 'not found')

      let configJson = existing.configJson
      let resetFailures = body.enabled === true
      if (body.config !== undefined) {
        const result =
          existing.type === 'ntfy'
            ? NtfyConfigSchema.safeParse(body.config)
            : existing.type === 'gotify'
              ? GotifyConfigSchema.safeParse(body.config)
              : WebhookConfigSchema.safeParse(body.config)
        if (!result.success)
          return problem(c, 400, 'invalid channel config', 'config does not match channel type')
        configJson = JSON.stringify(result.data)
        resetFailures = true
      }

      const now = nowIso()
      const updated = db
        .update(notificationChannels)
        .set({
          name: body.name ?? existing.name,
          enabled: body.enabled ?? existing.enabled,
          configJson,
          consecutiveFailures: resetFailures ? 0 : existing.consecutiveFailures,
          disabledReason: resetFailures ? null : existing.disabledReason,
          updatedAt: now,
        })
        .where(eq(notificationChannels.id, id))
        .returning()
        .get()
      bus.publish({
        userId: auth.userId,
        type: 'notification_channels.updated',
        entity: 'notification_channels',
        ids: [id],
      })
      return c.json(channelToDto(updated), 200)
    },
  )

  // DELETE /channels/{id} — hard delete.
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/channels/{id}',
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
        .select({ id: notificationChannels.id })
        .from(notificationChannels)
        .where(and(eq(notificationChannels.id, id), eq(notificationChannels.userId, auth.userId)))
        .get()
      if (existing === undefined) return problem(c, 404, 'not found')
      db.delete(notificationChannels).where(eq(notificationChannels.id, id)).run()
      bus.publish({
        userId: auth.userId,
        type: 'notification_channels.deleted',
        entity: 'notification_channels',
        ids: [id],
      })
      return c.body(null, 204)
    },
  )

  return app
}
