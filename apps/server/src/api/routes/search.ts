import { createRoute, OpenAPIHono, type RouteConfig, z } from '@hono/zod-openapi'
import { inArray } from 'drizzle-orm'
import type { AppEnv } from '../../app'
import { tasks } from '../../db/schema'
import { decodeCursor, encodeCursor, queryBool } from '../../lib/pagination'
import { problem } from '../../lib/problem'
import { type TaskDto, tasksToDtos } from '../../services/task-read'
import { TaskDtoSchema } from '../schemas'

const SearchQuerySchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
  include_completed: queryBool(false),
})

const MatchedInSchema = z.enum(['task', 'comment'])
const SearchResultSchema = z.object({
  task: TaskDtoSchema,
  matched_in: MatchedInSchema,
  /** FTS5 snippet with `<b>…</b>` marks around matches; '' when unavailable */
  snippet: z.string(),
})
const SearchResponseSchema = z.object({
  results: z.array(SearchResultSchema),
  next_cursor: z.string().nullable(),
})

type MatchedIn = z.infer<typeof MatchedInSchema>
interface FtsMatch {
  id: string
  rank: number
  snippet: string
}

/**
 * Turn raw user input into a safe FTS5 prefix query: split on whitespace, strip the
 * FTS5 syntax characters, quote every remaining term and append `*` for prefix matching.
 * Quoting makes each term a literal phrase, so operator-lookalikes (OR/AND/NEAR) and
 * injection attempts are inert. Returns '' when nothing searchable remains.
 */
function toFtsPrefixQuery(q: string): string {
  return q
    .split(/\s+/)
    .map((term) => term.replace(/["'*():^-]/g, ''))
    .filter((term) => term.length > 0)
    .map((term) => `"${term}"*`)
    .join(' ')
}

// Annotated as the route's own security type: the bare `[{ cookieAuth: [] }, { bearerAuth: [] }]`
// literal infers members with `?: undefined`, which is not assignable to SecurityRequirementObject[]
// and (via a poisoned RouteConfig) collapses zod-openapi's request-input inference. Same OpenAPI output.
const SECURITY: NonNullable<RouteConfig['security']> = [{ cookieAuth: [] }, { bearerAuth: [] }]

const searchRoute = createRoute({
  method: 'get',
  path: '/search',
  tags: ['search'],
  summary: 'Full-text search across tasks and comments',
  security: SECURITY,
  request: { query: SearchQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: SearchResponseSchema } },
      description: 'Ranked search hits; each hit carries the matching task and where it matched',
    },
    // Declared without a content schema on purpose: it documents the problem+json errors AND
    // keeps zod-openapi's handler return type permissive enough to return `problem()` responses.
    400: { description: 'Malformed cursor (application/problem+json)' },
    401: { description: 'Authentication required (application/problem+json)' },
  },
})

export const searchRoutes = () => {
  const app = new OpenAPIHono<AppEnv>()

  app.openapi(searchRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const deps = c.get('deps')
    const { q, limit, cursor, include_completed } = c.req.valid('query')

    // Offset cursor: search ranks a merged list, so keyset ordering does not apply.
    let offset = 0
    if (cursor !== undefined) {
      const off = decodeCursor(cursor)?.offset
      if (typeof off !== 'number' || !Number.isInteger(off) || off < 0) {
        return problem(c, 400, 'invalid cursor')
      }
      offset = off
    }

    const match = toFtsPrefixQuery(q)
    if (match === '') return c.json({ results: [], next_cursor: null }, 200)

    // Soft-deleted rows stay in the FTS index; filter them (and, by default, completed
    // tasks) at query time. Raw SQL: Drizzle has no FTS5/bm25 bindings.
    const completedClause = include_completed ? '' : ' AND t.completed_at IS NULL'
    // snippet(fts, -1, …): column -1 lets SQLite pick the matching column (content or description).
    const taskSql = `SELECT t.id AS id, bm25(tasks_fts) AS rank,
        snippet(tasks_fts, -1, '<b>', '</b>', '…', 12) AS snippet
      FROM tasks_fts
      JOIN tasks t ON t.rowid = tasks_fts.rowid
      WHERE tasks_fts MATCH ? AND t.user_id = ? AND t.deleted_at IS NULL${completedClause}`
    const commentSql = `SELECT t.id AS id, bm25(comments_fts) AS rank,
        snippet(comments_fts, -1, '<b>', '</b>', '…', 12) AS snippet
      FROM comments_fts
      JOIN comments cm ON cm.rowid = comments_fts.rowid
      JOIN tasks t ON t.id = cm.task_id
      WHERE comments_fts MATCH ? AND t.user_id = ? AND cm.deleted_at IS NULL AND t.deleted_at IS NULL${completedClause}`

    const taskHits = deps.sqlite
      .prepare<[string, string], FtsMatch>(taskSql)
      .all(match, auth.userId)
    const commentHits = deps.sqlite
      .prepare<[string, string], FtsMatch>(commentSql)
      .all(match, auth.userId)

    // Keep the best (lowest = most relevant) bm25 rank — and its snippet — per task id per source.
    const bestRank = (hits: FtsMatch[]): Map<string, { rank: number; snippet: string }> => {
      const map = new Map<string, { rank: number; snippet: string }>()
      for (const hit of hits) {
        const current = map.get(hit.id)
        if (current === undefined || hit.rank < current.rank) {
          map.set(hit.id, { rank: hit.rank, snippet: hit.snippet })
        }
      }
      return map
    }
    const taskBest = bestRank(taskHits)
    const commentBest = bestRank(commentHits)

    // Merge: a direct task hit outranks (and replaces) a comment hit for the same task.
    const merged: { id: string; rank: number; matchedIn: MatchedIn; snippet: string }[] = []
    for (const [id, { rank, snippet }] of taskBest) {
      merged.push({ id, rank, matchedIn: 'task', snippet })
    }
    for (const [id, { rank, snippet }] of commentBest) {
      if (!taskBest.has(id)) merged.push({ id, rank, matchedIn: 'comment', snippet })
    }
    merged.sort((a, b) =>
      a.rank !== b.rank ? a.rank - b.rank : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    )

    // Offset-slice one extra row to detect a next page.
    const windowed = merged.slice(offset, offset + limit + 1)
    const hasMore = windowed.length > limit
    const pageRows = hasMore ? windowed.slice(0, limit) : windowed
    const nextCursor = hasMore ? encodeCursor({ offset: offset + limit }) : null

    if (pageRows.length === 0) return c.json({ results: [], next_cursor: nextCursor }, 200)

    const rows = deps.db
      .select()
      .from(tasks)
      .where(
        inArray(
          tasks.id,
          pageRows.map((r) => r.id),
        ),
      )
      .all()
    const dtoById = new Map(tasksToDtos(deps.db, rows).map((dto) => [dto.id, dto]))
    const results: { task: TaskDto; matched_in: MatchedIn; snippet: string }[] = []
    for (const row of pageRows) {
      const task = dtoById.get(row.id)
      if (task !== undefined)
        results.push({ task, matched_in: row.matchedIn, snippet: row.snippet })
    }
    return c.json({ results, next_cursor: nextCursor }, 200)
  })

  return app
}
