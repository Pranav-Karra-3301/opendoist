import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { ApiTokenSchema, CreatedApiTokenSchema } from '@opendoist/core'
import { and, eq } from 'drizzle-orm'
import type { AppEnv } from '../../app'
import { apikey } from '../../db/auth-schema'
import { problem } from '../../lib/problem'

const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }]

type Scope = 'read' | 'read_write'

/** The two frozen permission shapes: `{opendoist:['read']}` | `{opendoist:['read','read_write']}`. */
const permissionsFor = (scope: Scope): Record<string, string[]> => ({
  opendoist: scope === 'read_write' ? ['read', 'read_write'] : ['read'],
})

/** Read a stored `permissions` blob (JSON string or object) back to a scope — mirrors app.ts. */
function scopeOf(permissions: unknown): Scope {
  let parsed: unknown = permissions
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return 'read'
    }
  }
  const opendoist = (parsed as { opendoist?: unknown } | null)?.opendoist
  return Array.isArray(opendoist) && opendoist.includes('read_write') ? 'read_write' : 'read'
}

const toIso = (v: unknown): string => {
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'number') return new Date(v).toISOString()
  return typeof v === 'string' ? v : new Date().toISOString()
}
const toIsoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : toIso(v))

const CreateBodySchema = z.object({
  name: z.string().min(1),
  scope: z.enum(['read', 'read_write']),
})
const OkSchema = z.object({ ok: z.boolean() })
const IdParam = z.object({ id: z.string().min(1) })

const listRoute = createRoute({
  method: 'get',
  path: '/tokens',
  tags: ['Tokens'],
  summary: 'List API tokens (never returns the secret value)',
  security,
  responses: {
    200: {
      description: 'API tokens',
      content: { 'application/json': { schema: z.array(ApiTokenSchema) } },
    },
    401: { description: 'Unauthorized' },
  },
})

const createTokenRoute = createRoute({
  method: 'post',
  path: '/tokens',
  tags: ['Tokens'],
  summary: 'Create an API token',
  description: 'The full `od_…` value is returned exactly once and is never retrievable again.',
  security,
  request: {
    body: { content: { 'application/json': { schema: CreateBodySchema } }, required: true },
  },
  responses: {
    201: {
      description: 'Created token (secret shown once)',
      content: { 'application/json': { schema: CreatedApiTokenSchema } },
    },
    400: { description: 'Validation failed' },
    401: { description: 'Unauthorized' },
  },
})

const revokeRoute = createRoute({
  method: 'delete',
  path: '/tokens/{id}',
  tags: ['Tokens'],
  summary: 'Revoke an API token',
  security,
  request: { params: IdParam },
  responses: {
    200: { description: 'Revoked', content: { 'application/json': { schema: OkSchema } } },
    401: { description: 'Unauthorized' },
    404: { description: 'Not found' },
  },
})

export const tokensRoutes = () => {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return problem(c, 400, 'validation failed', undefined, { errors: result.error.issues })
      }
    },
  })

  app.openapi(listRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db } = c.get('deps')
    // @better-auth/api-key stores the owner as `referenceId`. Select only the display columns —
    // the hashed `key` never leaves the server.
    const rows = db
      .select({
        id: apikey.id,
        name: apikey.name,
        start: apikey.start,
        permissions: apikey.permissions,
        createdAt: apikey.createdAt,
        lastRequest: apikey.lastRequest,
      })
      .from(apikey)
      .where(eq(apikey.referenceId, auth.userId))
      .all()
    const tokens = rows
      .map((r) => ({
        id: r.id,
        name: r.name ?? '',
        scope: scopeOf(r.permissions),
        start: r.start ?? 'od_',
        createdAt: toIso(r.createdAt),
        lastUsedAt: toIsoOrNull(r.lastRequest),
      }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    return c.json(tokens, 200)
  })

  app.openapi(createTokenRoute, async (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { auth: authApi } = c.get('deps')
    const { name, scope } = c.req.valid('json')

    // Server-side (trusted) mint: pass the owner id explicitly so this works under both session
    // and api-key auth. `permissions` is server-only, so it MUST be set here (HTTP create cannot).
    const created = await authApi.api.createApiKey({
      body: {
        name,
        prefix: 'od_',
        permissions: permissionsFor(scope),
        userId: auth.userId,
      },
    })
    return c.json(
      {
        id: created.id,
        name: created.name ?? name,
        scope: scopeOf(created.permissions),
        start: created.start ?? 'od_',
        createdAt: toIso(created.createdAt),
        lastUsedAt: toIsoOrNull(created.lastRequest),
        token: created.key,
      },
      201,
    )
  })

  app.openapi(revokeRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db } = c.get('deps')
    const { id } = c.req.valid('param')
    const row = db
      .select({ id: apikey.id })
      .from(apikey)
      .where(and(eq(apikey.id, id), eq(apikey.referenceId, auth.userId)))
      .get()
    if (row === undefined) return problem(c, 404, 'not found')
    db.delete(apikey)
      .where(and(eq(apikey.id, id), eq(apikey.referenceId, auth.userId)))
      .run()
    return c.json({ ok: true }, 200)
  })

  return app
}
