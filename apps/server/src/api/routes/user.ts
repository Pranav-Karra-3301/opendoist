import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { eq } from 'drizzle-orm'
import type { AppEnv } from '../../app'
import { user } from '../../db/auth-schema'
import { userSettings } from '../../db/schema'
import { nowIso } from '../../lib/ids'
import { problem } from '../../lib/problem'
import { getSettings } from '../../services/task-write'
import { IdSchema, type Settings, SettingsSchema } from '../schemas'

/**
 * Valid IANA time-zone identifiers. `Intl.supportedValuesOf('timeZone')` omits the
 * `'UTC'` alias on V8/Node, so it is added explicitly — otherwise the default (and
 * selectable) `'UTC'` value could never be PATCHed back in.
 */
const TIMEZONES = new Set<string>([...Intl.supportedValuesOf('timeZone'), 'UTC'])

/**
 * Allowed `autoReminderMinutes` values (phase 6, Settings > Reminders select).
 * Core's `UserSettingsSchema` only bounds the range (0–10080 | null); the PATCH
 * boundary constrains it to the exact option set. The at-time reminder is always
 * materialized for timed tasks, so `null` = no extra heads-up and `0` is a
 * back-compat alias for null (the web menu no longer offers it).
 */
const AUTO_REMINDER_MINUTES = new Set<number | null>([null, 0, 5, 10, 15, 30, 45, 60, 120])

const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }]

const UserDtoSchema = z.object({
  id: IdSchema,
  name: z.string(),
  email: z.string(),
  two_factor_enabled: z.boolean(),
  created_at: z.string(),
})

interface UserRow {
  id: string
  name: string
  email: string
  twoFactorEnabled: boolean | null
  createdAt: Date
}

function userDto(row: UserRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    two_factor_enabled: row.twoFactorEnabled ?? false,
    created_at: row.createdAt.toISOString(),
  }
}

const userColumns = {
  id: user.id,
  name: user.name,
  email: user.email,
  twoFactorEnabled: user.twoFactorEnabled,
  createdAt: user.createdAt,
}

const getUserRoute = createRoute({
  method: 'get',
  path: '/user',
  tags: ['User'],
  summary: 'Current user',
  security,
  responses: {
    200: {
      description: 'Current user',
      content: { 'application/json': { schema: UserDtoSchema } },
    },
    401: { description: 'Unauthorized' },
    404: { description: 'Not found' },
  },
})

const patchUserRoute = createRoute({
  method: 'patch',
  path: '/user',
  tags: ['User'],
  summary: 'Update the current user',
  description:
    'Updates the display name only. Email, password, 2FA and connected-provider changes go through better-auth endpoints under /api/auth/* and are not reimplemented here.',
  security,
  request: {
    body: {
      content: {
        'application/json': { schema: z.object({ name: z.string().min(1).optional() }) },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated user',
      content: { 'application/json': { schema: UserDtoSchema } },
    },
    400: { description: 'Validation failed' },
    401: { description: 'Unauthorized' },
    404: { description: 'Not found' },
  },
})

const getSettingsRoute = createRoute({
  method: 'get',
  path: '/user/settings',
  tags: ['User'],
  summary: 'Client preferences document',
  security,
  responses: {
    200: {
      description: 'User settings',
      content: { 'application/json': { schema: SettingsSchema } },
    },
    401: { description: 'Unauthorized' },
  },
})

const patchSettingsRoute = createRoute({
  method: 'patch',
  path: '/user/settings',
  tags: ['User'],
  summary: 'Update client preferences',
  description:
    'Shallow top-level merge onto the stored document; only the keys present in the request body are changed. `viewPrefs` merges per view key (provided keys replace, others are kept). ' +
    '`autoReminderMinutes` accepts exactly null, 0, 5, 10, 15, 30, 45, 60, or 120 — the extra heads-up before a timed due. Tasks with a due time always get an at-time reminder; null means no extra heads-up and 0 is a back-compat alias for null.',
  security,
  request: {
    body: { content: { 'application/json': { schema: SettingsSchema.partial() } } },
  },
  responses: {
    200: {
      description: 'Merged settings',
      content: { 'application/json': { schema: SettingsSchema } },
    },
    400: { description: 'Invalid timezone or validation failed' },
    401: { description: 'Unauthorized' },
  },
})

export const userRoutes = () => {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return problem(c, 400, 'validation failed', undefined, { errors: result.error.issues })
      }
    },
  })

  app.openapi(getUserRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db } = c.get('deps')
    const row = db.select(userColumns).from(user).where(eq(user.id, auth.userId)).get()
    if (!row) return problem(c, 404, 'not found')
    return c.json(userDto(row), 200)
  })

  app.openapi(patchUserRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db } = c.get('deps')
    const body = c.req.valid('json')
    if (body.name !== undefined) {
      db.update(user)
        .set({ name: body.name, updatedAt: new Date() })
        .where(eq(user.id, auth.userId))
        .run()
    }
    const row = db.select(userColumns).from(user).where(eq(user.id, auth.userId)).get()
    if (!row) return problem(c, 404, 'not found')
    return c.json(userDto(row), 200)
  })

  app.openapi(getSettingsRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db } = c.get('deps')
    return c.json(getSettings(db, auth.userId), 200)
  })

  app.openapi(patchSettingsRoute, async (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus } = c.get('deps')
    const validated = c.req.valid('json')
    // `.partial()` injects defaults for absent keys, so the raw body tells us which
    // keys the client actually sent — only those are merged onto the stored document.
    const raw = (await c.req.json()) as Record<string, unknown>
    const providedKeys = new Set(Object.keys(raw))

    if (providedKeys.has('timezone')) {
      const tz = validated.timezone
      if (typeof tz !== 'string' || !TIMEZONES.has(tz)) {
        return problem(c, 400, 'invalid timezone', `Unknown time zone: ${String(tz)}`)
      }
    }

    if (providedKeys.has('autoReminderMinutes')) {
      const minutes = validated.autoReminderMinutes ?? null
      if (!AUTO_REMINDER_MINUTES.has(minutes)) {
        return problem(
          c,
          400,
          'invalid autoReminderMinutes',
          `Allowed values: null, 0, 5, 10, 15, 30, 45, 60, 120 — got ${String(minutes)}`,
        )
      }
    }

    const stored = getSettings(db, auth.userId)
    const merged = { ...stored } as Settings
    const mergedRecord = merged as Record<string, unknown>
    const validatedRecord = validated as Record<string, unknown>
    for (const key of providedKeys) {
      if (key === 'viewPrefs') continue
      if (key in validatedRecord) mergedRecord[key] = validatedRecord[key]
    }
    if (providedKeys.has('viewPrefs') && validated.viewPrefs) {
      merged.viewPrefs = { ...stored.viewPrefs, ...validated.viewPrefs }
    }

    const final = SettingsSchema.parse(merged)
    const now = nowIso()
    db.insert(userSettings)
      .values({ userId: auth.userId, settings: JSON.stringify(final), updatedAt: now })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { settings: JSON.stringify(final), updatedAt: now },
      })
      .run()
    bus.publish({
      userId: auth.userId,
      type: 'settings.updated',
      entity: 'settings',
      ids: [auth.userId],
    })
    return c.json(final, 200)
  })

  return app
}
