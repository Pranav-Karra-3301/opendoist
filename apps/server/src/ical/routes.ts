/**
 * iCal capability-token management + the public feed (phase 6 Task J).
 *
 * `icalTokenRoutes` (authed, mounted under /api/v1 by app.ts): GET auto-creates the caller's token,
 * POST rotates it. `icalFeedRoutes` (PUBLIC, mounted at app level BEFORE the SPA fallback): the
 * opaque token in the path IS the credential, so an unknown token is a 404 (never a 401 — we never
 * confirm whether a token could exist). The feed body is deterministic and cached via a strong ETag.
 */

import { randomBytes } from 'node:crypto'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { type RecurrenceSpec, RecurrenceSpecSchema } from '@opentask/core'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { AppEnv } from '../app'
import type { Db } from '../db/db'
import { icalTokens, labels as labelsTable, taskLabels, tasks } from '../db/schema'
import { newId, nowIso } from '../lib/ids'
import { problem } from '../lib/problem'
import { getSettings } from '../services/task-write'
import { buildTasksCalendar, feedEtag, type IcalTaskRow } from './feed'

const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }]

const IcalTokenDtoSchema = z.object({
  token: z.string(),
  url: z.string(),
  webcal_url: z.string(),
  created_at: z.string(),
})

/** New 32-char URL-safe capability token (192 bits of entropy). */
function newToken(): string {
  return randomBytes(24).toString('base64url')
}

function tokenDto(row: { token: string; createdAt: string }, publicUrl: string | null) {
  const base = (publicUrl ?? 'http://localhost:7968').replace(/\/+$/, '')
  const url = `${base}/ical/${row.token}/tasks.ics`
  return {
    token: row.token,
    url,
    // Apple Calendar / Outlook open a `webcal://` URL directly into their subscribe flow.
    webcal_url: url.replace(/^https?:\/\//, 'webcal://'),
    created_at: row.createdAt,
  }
}

const getTokenRoute = createRoute({
  method: 'get',
  path: '/ical-token',
  tags: ['Calendar'],
  summary: 'Get the calendar-feed token (auto-created on first call)',
  description:
    'Returns the read-only iCal feed token and URLs, creating the token on first call. The token in ' +
    'the feed URL IS the credential — anyone with the URL can read the calendar, so treat it as a ' +
    'secret and rotate it if it leaks.',
  security,
  responses: {
    200: {
      description: 'Calendar-feed token and URLs',
      content: { 'application/json': { schema: IcalTokenDtoSchema } },
    },
    401: { description: 'Unauthorized' },
  },
})

const rotateTokenRoute = createRoute({
  method: 'post',
  path: '/ical-token/rotate',
  tags: ['Calendar'],
  summary: 'Rotate the calendar-feed token',
  description:
    'Issues a fresh token; the previous feed URL stops working immediately, so existing calendar ' +
    'subscriptions must be re-added with the new URL.',
  security,
  responses: {
    200: {
      description: 'Rotated token and URLs',
      content: { 'application/json': { schema: IcalTokenDtoSchema } },
    },
    401: { description: 'Unauthorized' },
  },
})

export const icalTokenRoutes = () => {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return problem(c, 400, 'validation failed', undefined, { errors: result.error.issues })
      }
    },
  })

  app.openapi(getTokenRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, config } = c.get('deps')
    let row = db.select().from(icalTokens).where(eq(icalTokens.userId, auth.userId)).get()
    if (row === undefined) {
      db.insert(icalTokens)
        .values({ id: newId(), userId: auth.userId, token: newToken() })
        .onConflictDoNothing()
        .run()
      row = db.select().from(icalTokens).where(eq(icalTokens.userId, auth.userId)).get()
    }
    if (row === undefined) return problem(c, 500, 'internal error')
    return c.json(tokenDto(row, config.publicUrl), 200)
  })

  app.openapi(rotateTokenRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, config } = c.get('deps')
    const token = newToken()
    const existing = db
      .select({ id: icalTokens.id })
      .from(icalTokens)
      .where(eq(icalTokens.userId, auth.userId))
      .get()
    if (existing === undefined) {
      db.insert(icalTokens)
        .values({ id: newId(), userId: auth.userId, token })
        .onConflictDoNothing()
        .run()
    } else {
      db.update(icalTokens)
        .set({ token, lastAccessedAt: null })
        .where(eq(icalTokens.userId, auth.userId))
        .run()
    }
    const row = db.select().from(icalTokens).where(eq(icalTokens.userId, auth.userId)).get()
    if (row === undefined) return problem(c, 500, 'internal error')
    return c.json(tokenDto(row, config.publicUrl), 200)
  })

  return app
}

/** Stored recurrence JSON → validated spec; a malformed/legacy blob degrades to non-recurring. */
function parseRecurrence(json: string | null): RecurrenceSpec | null {
  if (json === null) return null
  try {
    const parsed = RecurrenceSpecSchema.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Live, due-dated tasks for one user, with their label names joined in a single junction query. */
function loadIcalTaskRows(db: Db, userId: string): IcalTaskRow[] {
  const rows = db
    .select({
      id: tasks.id,
      content: tasks.content,
      description: tasks.description,
      dueDate: tasks.dueDate,
      dueTime: tasks.dueTime,
      durationMin: tasks.durationMin,
      recurrence: tasks.recurrence,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        isNull(tasks.completedAt),
        isNotNull(tasks.dueDate),
      ),
    )
    .all()
  if (rows.length === 0) return []

  const junction = db
    .select({ taskId: taskLabels.taskId, name: labelsTable.name })
    .from(taskLabels)
    .innerJoin(labelsTable, eq(taskLabels.labelId, labelsTable.id))
    .where(
      inArray(
        taskLabels.taskId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(labelsTable.itemOrder)
    .all()
  const labelsByTask = new Map<string, string[]>()
  for (const j of junction) {
    const list = labelsByTask.get(j.taskId)
    if (list === undefined) labelsByTask.set(j.taskId, [j.name])
    else list.push(j.name)
  }

  const out: IcalTaskRow[] = []
  for (const r of rows) {
    if (r.dueDate === null) continue // impossible after isNotNull, but narrows the type
    out.push({
      id: r.id,
      content: r.content,
      description: r.description,
      dueDate: r.dueDate,
      dueTime: r.dueTime,
      durationMin: r.durationMin,
      recurrence: parseRecurrence(r.recurrence),
      labels: labelsByTask.get(r.id) ?? [],
    })
  }
  return out
}

/**
 * The feed clock, quantized to the top of the current UTC hour. `DTSTAMP` (hence the whole body and
 * its ETag) then stays byte-identical across the caching window, so a conditional re-request within
 * the same hour returns a true 304 instead of a fresh 200 differing only by a few `DTSTAMP` ms.
 * Zeroing the minutes never crosses a date boundary, so the date-based visibility window is intact.
 */
function stableFeedNow(): string {
  const d = new Date()
  d.setUTCMinutes(0, 0, 0)
  return d.toISOString()
}

export const icalFeedRoutes = () => {
  const app = new OpenAPIHono<AppEnv>()

  // Public: the path token is the credential. Hono answers HEAD via this GET route automatically.
  app.get('/ical/:token/tasks.ics', (c) => {
    const { db, config } = c.get('deps')
    const token = c.req.param('token')
    const tokenRow = db
      .select({ id: icalTokens.id, userId: icalTokens.userId })
      .from(icalTokens)
      .where(eq(icalTokens.token, token))
      .get()
    if (tokenRow === undefined) return problem(c, 404, 'not found')

    db.update(icalTokens)
      .set({ lastAccessedAt: nowIso() })
      .where(eq(icalTokens.id, tokenRow.id))
      .run()

    const timezone = getSettings(db, tokenRow.userId).timezone
    const body = buildTasksCalendar(loadIcalTaskRows(db, tokenRow.userId), {
      publicUrl: config.publicUrl,
      timezone,
      now: stableFeedNow(),
    })
    const etag = feedEtag(body)
    const cacheControl = 'private, max-age=300'

    if (c.req.header('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { etag, 'cache-control': cacheControl } })
    }
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        etag,
        'cache-control': cacheControl,
      },
    })
  })

  return app
}
