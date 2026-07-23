/**
 * Import HTTP routes (phase 9 Task G), mounted under `/api/v1` by Task A app wiring.
 *
 *   POST /api/v1/import/todoist-csv  — multipart `file` (backup .zip) + optional `mode`
 *   POST /api/v1/import/todoist-api  — JSON { token, mode?, baseUrl? }
 *   GET  /api/v1/import/jobs/:id     — poll job status + report
 *
 * The app-level guard already requires an authenticated session or a read_write token for the
 * POSTs; the handlers only narrow `auth` to read the owning userId. Parsing/fetch/apply live in
 * the frozen `todoist-csv` / `todoist-api` / `apply` modules (Tasks E/F); the async job lifecycle
 * lives in `jobs.ts`.
 */
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import type { AppEnv } from '../app'
import { newId } from '../lib/ids'
import { problem } from '../lib/problem'
import { getImportJob, type ImportJobContext, ImportRunningError, startImportJob } from './jobs'
import { ImportJobDtoSchema } from './types'

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

const JobStartedSchema = z.object({ jobId: z.string() })
const ModeSchema = z.enum(['dry-run', 'apply'])

/** Backup-zip upload cap (256 MiB) — deliberately NOT the attachments OPENTASK_UPLOAD_MAX_MB cap. */
const CSV_IMPORT_MAX_BYTES = 256 * 1024 * 1024

const csvImportRoute = createRoute({
  method: 'post',
  path: '/import/todoist-csv',
  tags: ['import'],
  security,
  summary: 'Import from a Todoist backup zip',
  description:
    'Multipart form: `file` (a Todoist backup .zip of per-project CSVs) plus an optional `mode` ' +
    '(`dry-run` | `apply`, default `dry-run`). Starts a background job and returns its id; poll ' +
    '`GET /import/jobs/{id}` for progress and the final report.',
  request: {
    body: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            properties: {
              file: { type: 'string', format: 'binary', description: 'Todoist backup .zip' },
              mode: {
                type: 'string',
                enum: ['dry-run', 'apply'],
                description: 'Import mode (default `dry-run`).',
              },
            },
            required: ['file'],
          },
        },
      },
    },
  },
  responses: {
    202: {
      content: { 'application/json': { schema: JobStartedSchema } },
      description: 'Import job started',
    },
    400: problemResponse('Missing `file` field or not a multipart form'),
    409: problemResponse('An import is already running'),
    413: problemResponse('Upload exceeds the 256 MiB import cap'),
  },
})

const apiImportRoute = createRoute({
  method: 'post',
  path: '/import/todoist-api',
  tags: ['import'],
  security,
  summary: 'Import from the Todoist API',
  description:
    'JSON body `{ token, mode?, baseUrl? }`. The token is used only to fetch your Todoist data ' +
    'and is never persisted or logged. `baseUrl` targets a self-hosted mirror. Starts a background ' +
    'job and returns its id; poll `GET /import/jobs/{id}`.',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            token: z.string().min(1),
            mode: ModeSchema.default('dry-run'),
            baseUrl: z.string().url().optional(),
          }),
        },
      },
    },
  },
  responses: {
    202: {
      content: { 'application/json': { schema: JobStartedSchema } },
      description: 'Import job started',
    },
    400: problemResponse('Invalid JSON body'),
    409: problemResponse('An import is already running'),
  },
})

const getJobRoute = createRoute({
  method: 'get',
  path: '/import/jobs/{id}',
  tags: ['import'],
  security,
  summary: 'Get an import job',
  description: 'Returns the job status, current progress, and (when finished) the import report.',
  request: { params: z.object({ id: z.string().min(1) }) },
  responses: {
    200: {
      content: { 'application/json': { schema: ImportJobDtoSchema } },
      description: 'Import job',
    },
    404: problemResponse('Unknown job id'),
  },
})

export const importRouter = () => {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return problem(c, 400, 'validation failed', undefined, { errors: result.error.issues })
      }
    },
  })

  app.openapi(csvImportRoute, async (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus, logger, config } = c.get('deps')

    // Reject clearly-oversized uploads before buffering the whole body when Content-Length is known.
    const declared = Number(c.req.header('content-length') ?? '')
    if (Number.isFinite(declared) && declared > CSV_IMPORT_MAX_BYTES) {
      return problem(c, 413, 'upload too large', 'Maximum import size is 256 MiB')
    }

    let body: Record<string, string | File>
    try {
      body = await c.req.parseBody()
    } catch {
      return problem(c, 400, 'invalid upload', 'Expected a multipart form with a `file` field')
    }
    const file = body.file
    if (!(file instanceof File)) {
      return problem(c, 400, 'invalid upload', 'Missing `file` field')
    }
    if (file.size > CSV_IMPORT_MAX_BYTES) {
      return problem(c, 413, 'upload too large', 'Maximum import size is 256 MiB')
    }
    const parsedMode = ModeSchema.safeParse(typeof body.mode === 'string' ? body.mode : 'dry-run')
    if (!parsedMode.success) {
      return problem(c, 400, 'invalid mode', '`mode` must be `dry-run` or `apply`')
    }

    // Persist the upload to a tmp file the job reads and then deletes.
    const tmpDir = join(config.dataDir, 'tmp')
    mkdirSync(tmpDir, { recursive: true })
    const zipPath = join(tmpDir, `import-${newId()}.zip`)
    writeFileSync(zipPath, Buffer.from(await file.arrayBuffer()))

    const ctx: ImportJobContext = { db, bus, logger, userId: auth.userId }
    try {
      const jobId = startImportJob(ctx, {
        source: 'todoist-csv',
        mode: parsedMode.data,
        zipPath,
      })
      return c.json({ jobId }, 202)
    } catch (err) {
      try {
        unlinkSync(zipPath)
      } catch {
        // best-effort: drop the tmp upload we just wrote
      }
      if (err instanceof ImportRunningError) {
        return problem(c, 409, 'import in progress', err.message)
      }
      throw err
    }
  })

  app.openapi(apiImportRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus, logger } = c.get('deps')
    const { token, mode, baseUrl } = c.req.valid('json')

    const ctx: ImportJobContext = { db, bus, logger, userId: auth.userId }
    try {
      const jobId = startImportJob(ctx, { source: 'todoist-api', mode, token, baseUrl })
      return c.json({ jobId }, 202)
    } catch (err) {
      if (err instanceof ImportRunningError) {
        return problem(c, 409, 'import in progress', err.message)
      }
      throw err
    }
  })

  app.openapi(getJobRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db } = c.get('deps')
    const { id } = c.req.valid('param')
    const dto = getImportJob(db, id)
    if (dto === null) return problem(c, 404, 'not found')
    return c.json(dto, 200)
  })

  return app
}
