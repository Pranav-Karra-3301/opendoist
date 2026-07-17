import { existsSync } from 'node:fs'
import { serveStatic } from '@hono/node-server/serve-static'
import { OpenAPIHono } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'
import type { Database } from 'better-sqlite3'
import { count } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { nanoid } from 'nanoid'
import type { Logger } from 'pino'
import { activitiesRoutes } from './api/routes/activities'
import { attachmentsRoutes } from './api/routes/attachments'
import { commentsRoutes } from './api/routes/comments'
import { eventsRoutes } from './api/routes/events'
import { filtersRoutes } from './api/routes/filters'
import { labelsRoutes } from './api/routes/labels'
import { projectsRoutes } from './api/routes/projects'
import { searchRoutes } from './api/routes/search'
import { sectionsRoutes } from './api/routes/sections'
import { taskActionsRoutes } from './api/routes/task-actions'
import { tasksRoutes } from './api/routes/tasks'
import { tokensRoutes } from './api/routes/tokens'
import { userRoutes } from './api/routes/user'
import type { Auth } from './auth'
import type { Config } from './config'
import { user } from './db/auth-schema'
import type { Db } from './db/db'
import type { EventBus } from './events/bus'
import { icalFeedRoutes, icalTokenRoutes } from './ical/routes'
import { problem } from './lib/problem'
import { integrationsRoutes } from './rambles/integrations-routes'
import { rambleRoutes } from './rambles/routes'
import { channelRoutes } from './reminders/channel-routes'
import { pushRoutes } from './reminders/push-routes'
import { remindersRoutes } from './reminders/routes'
import type { Secrets } from './secrets'

export interface AppDeps {
  config: Config
  db: Db
  sqlite: Database
  secrets: Secrets
  bus: EventBus
  auth: Auth
  logger: Logger
}
export interface AuthInfo {
  userId: string
  via: 'session' | 'api-key'
  scope: 'read' | 'read_write'
}
export type AppEnv = { Variables: { auth: AuthInfo | null; requestId: string; deps: AppDeps } }

/** API-key `permissions` may arrive as a JSON string or an object; only two shapes exist. */
function apiKeyScope(permissions: unknown): 'read' | 'read_write' {
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

export function createApp(deps: AppDeps): OpenAPIHono<AppEnv> {
  // 1. Root app: zod validation failures become RFC 9457 problem JSON.
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return problem(c, 400, 'validation failed', undefined, { errors: result.error.issues })
      }
    },
  })

  // Errors are problem JSON too — never a bare-text 500 (or a leaked driver error message).
  app.onError((err, c) => {
    if (err instanceof HTTPException) return problem(c, err.status, 'request failed', err.message)
    deps.logger.error({ err, requestId: c.get('requestId') }, 'unhandled error')
    return problem(c, 500, 'internal error')
  })

  // 2. Request id + deps + completion log line.
  app.use('*', async (c, next) => {
    c.set('requestId', nanoid(8))
    c.set('deps', deps)
    c.set('auth', null)
    const start = Date.now()
    await next()
    const ip = deps.config.trustProxy
      ? c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      : undefined
    deps.logger.info(
      {
        requestId: c.get('requestId'),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Date.now() - start,
        ...(ip === undefined ? {} : { ip }),
      },
      'request',
    )
  })

  // 3. Health.
  app.get('/api/health', (c) => c.json({ status: 'ok' }))

  // 4. better-auth endpoints.
  app.on(['GET', 'POST'], '/api/auth/*', (c) => deps.auth.handler(c.req.raw))

  // 5. Auth resolver: `Authorization: Bearer od_…` API keys, else session cookie.
  app.use('/api/v1/*', async (c, next) => {
    const header = c.req.header('authorization')
    if (header?.startsWith('Bearer od_')) {
      try {
        const result = await deps.auth.api.verifyApiKey({
          body: { key: header.slice('Bearer '.length) },
        })
        if (result.valid && result.key) {
          c.set('auth', {
            // @better-auth/api-key stores the owning user id as `referenceId`
            userId: result.key.referenceId,
            via: 'api-key',
            scope: apiKeyScope(result.key.permissions),
          })
        }
      } catch {
        // invalid key → stays unauthenticated
      }
      return next()
    }
    const session = await deps.auth.api.getSession({ headers: c.req.raw.headers })
    if (session) c.set('auth', { userId: session.user.id, via: 'session', scope: 'read_write' })
    return next()
  })

  // 6. Public instance info (before the guard).
  app.get('/api/v1/info', async (c) => {
    const [row] = await deps.db.select({ n: count() }).from(user)
    const firstRun = (row?.n ?? 0) === 0
    return c.json({
      version: deps.config.version,
      first_run: firstRun,
      registration_open: firstRun || deps.config.allowRegistration,
      auth_providers: {
        password: true,
        oidc: deps.config.oidc === null ? null : { name: deps.config.oidc.name },
      },
      // push is always available: VAPID keys are auto-generated into secrets.json at first boot.
      features: { stt: deps.config.stt !== null, llm: deps.config.llm !== null, push: true },
      available_importers: [],
    })
  })

  // 7. Guard: everything else under /api/v1 requires auth; writes require read_write scope.
  app.use('/api/v1/*', async (c, next) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && auth.scope === 'read') {
      return problem(c, 403, 'insufficient scope')
    }
    return next()
  })

  // 8. Routers (order matters: quick/close/reopen/completed before `:id` routes).
  app.route('/api/v1', taskActionsRoutes())
  app.route('/api/v1', tasksRoutes())
  app.route('/api/v1', projectsRoutes())
  app.route('/api/v1', sectionsRoutes())
  app.route('/api/v1', labelsRoutes())
  app.route('/api/v1', filtersRoutes())
  app.route('/api/v1', commentsRoutes())
  app.route('/api/v1', attachmentsRoutes())
  app.route('/api/v1', userRoutes())
  app.route('/api/v1', tokensRoutes())
  app.route('/api/v1', activitiesRoutes())
  app.route('/api/v1', searchRoutes())
  app.route('/api/v1', eventsRoutes())
  // phase 6 (Task A wiring): reminders, push subscriptions, notification channels, iCal token
  app.route('/api/v1', remindersRoutes())
  app.route('/api/v1', pushRoutes())
  app.route('/api/v1', channelRoutes())
  app.route('/api/v1', icalTokenRoutes())
  // phase 7 (Task N wiring): voice rambles + provider integrations settings
  app.route('/api/v1', rambleRoutes())
  app.route('/api/v1', integrationsRoutes())

  // 9. OpenAPI document + security schemes.
  app.doc('/api/v1/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'OpenDoist API', version: deps.config.version },
  })
  app.openAPIRegistry.registerComponent('securitySchemes', 'cookieAuth', {
    type: 'apiKey',
    in: 'cookie',
    name: 'better-auth.session_token',
  })
  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'od_…',
  })

  // 10. Scalar docs UI.
  app.get('/api/v1/docs', Scalar({ url: '/api/v1/openapi.json', pageTitle: 'OpenDoist API' }))

  // 11. Unknown /api paths never fall through to the SPA.
  app.all('/api/*', (c) => problem(c, 404, 'not found'))

  // 12. Public iCal feed (phase 6): the capability token in the path IS the credential —
  // no session auth, and it must be registered before the SPA fallback below.
  app.route('/', icalFeedRoutes())

  // Static SPA + index.html fallback (GETs outside /api), only when configured and present.
  if (deps.config.webDistDir !== null && existsSync(deps.config.webDistDir)) {
    const root = deps.config.webDistDir
    app.use('*', serveStatic({ root }))
    app.get('*', serveStatic({ root, rewriteRequestPath: () => '/index.html' }))
  }

  return app
}
