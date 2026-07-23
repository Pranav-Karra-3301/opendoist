/**
 * Export HTTP routes (phase 9 Task P), mounted under `/api/v1` by Task A app wiring.
 *
 *   GET /api/v1/export/json — the canonical, restorable JSON document (one download)
 *   GET /api/v1/export/csv  — a zip of Todoist-compatible per-project CSVs
 *
 * Both dump the whole account, so — per the plan — they require a session or a `read_write` token
 * (a read-only API key is refused). Sessions always carry `read_write` scope (see app.ts), so the
 * single scope check implements "session or read_write". Building lives in `json-export.ts` /
 * `csv-export.ts`; the handlers only resolve the owning user and stream the result as a download.
 */
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import type { AppEnv } from '../app'
import { problem } from '../lib/problem'
import { buildCsvFiles, zipCsvFiles } from './csv-export'
import { buildJsonExport, OpentaskExportSchema } from './json-export'

const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }]

/** RFC 9457 problem-details body (matches `lib/problem.ts`). */
const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string().optional(),
})
const problemResponse = (description: string) => ({
  content: { 'application/problem+json': { schema: ProblemSchema } },
  description,
})

/** UTC calendar date for the download filename, e.g. `2026-07-15`. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

const jsonExportRoute = createRoute({
  method: 'get',
  path: '/export/json',
  tags: ['export'],
  security,
  summary: 'Export all data as canonical JSON',
  description:
    'Downloads a single, self-contained JSON document of your whole account (projects, sections, ' +
    'labels, filters, tasks, comments, reminders, settings). Completed tasks are included; ' +
    'soft-deleted rows and attachment file bytes are not. Requires a session or `read_write` token.',
  responses: {
    200: {
      content: { 'application/json': { schema: OpentaskExportSchema } },
      description: 'The export document (served as a file download)',
    },
    401: problemResponse('Unauthorized'),
    403: problemResponse('A read-only token cannot export all data'),
  },
})

const csvExportRoute = createRoute({
  method: 'get',
  path: '/export/csv',
  tags: ['export'],
  security,
  summary: 'Export all data as a Todoist-compatible CSV zip',
  description:
    'Downloads a zip with one CSV per non-archived project, in the same per-project column shape ' +
    "Todoist's backup export uses (re-importable here or into Todoist). Active tasks only. " +
    'Requires a session or `read_write` token.',
  responses: {
    200: {
      content: {
        'application/zip': { schema: z.string().openapi({ type: 'string', format: 'binary' }) },
      },
      description: 'A zip of per-project CSV files (served as a file download)',
    },
    401: problemResponse('Unauthorized'),
    403: problemResponse('A read-only token cannot export all data'),
  },
})

export const exportRouter = () => {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return problem(c, 400, 'validation failed', undefined, { errors: result.error.issues })
      }
    },
  })

  app.openapi(jsonExportRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    if (auth.scope !== 'read_write') return problem(c, 403, 'insufficient scope')
    const { db } = c.get('deps')

    const doc = buildJsonExport({ db, userId: auth.userId })
    c.header('content-disposition', `attachment; filename="opentask-export-${today()}.json"`)
    return c.json(doc, 200)
  })

  app.openapi(csvExportRoute, async (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    if (auth.scope !== 'read_write') return problem(c, 403, 'insufficient scope')
    const { db } = c.get('deps')

    const zip = await zipCsvFiles(buildCsvFiles({ db, userId: auth.userId }))
    return new Response(zip, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="opentask-export-${today()}.zip"`,
      },
    })
  })

  return app
}
