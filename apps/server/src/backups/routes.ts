/**
 * Backups API (phase 9 Task D). List / create / configure / download backups and restore from an
 * uploaded backup zip. Every route requires an interactive session or a `read_write` token — a
 * backup contains the entire database, so read-only tokens are refused even for GETs.
 */
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppDeps, AppEnv } from '../app'
import { backupSettings } from '../db/schema'
import { newId } from '../lib/ids'
import { problem } from '../lib/problem'
import { backupFilePath, createBackup, effectiveBackupSettings, listBackups } from './engine'
import { restoreFromZip } from './restore'
import {
  BACKUP_FILENAME_RE,
  BackupInfoSchema,
  BackupSettingsDtoSchema,
  BackupSettingsPatchSchema,
  RestoreResponseSchema,
} from './types'

/** 2 GiB restore-upload cap (the attachments OPENTASK_UPLOAD_MAX_MB cap deliberately does NOT apply). */
const RESTORE_MAX_BYTES = 2 * 1024 * 1024 * 1024

const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }]

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

const ListSchema = z.object({
  results: z.array(BackupInfoSchema),
  next_cursor: z.null(),
})

/**
 * Refuse anyone who is not a session or a `read_write` token — a backup is a full copy of the
 * database, so read-only tokens are turned away even on GETs. Returns a problem Response to short
 * circuit, or `undefined` to continue. (A per-handler check, NOT sub-router `use('*')`, which would
 * leak onto every sibling `/api/v1` route mounted under the same prefix.)
 */
function requireReadWrite(c: Context<AppEnv>) {
  const auth = c.get('auth')
  if (!auth) return problem(c, 401, 'unauthorized')
  if (auth.scope !== 'read_write') {
    return problem(
      c,
      403,
      'insufficient scope',
      'Backups require a read_write token or an interactive session.',
    )
  }
  return undefined
}

/** Current stored + effective backup settings as a `BackupSettingsDto`. */
function readSettingsDto(deps: AppDeps) {
  const stored = deps.db.select().from(backupSettings).where(eq(backupSettings.id, 1)).get()
  return {
    retentionDays: stored?.retentionDays ?? null,
    includeAttachments: stored?.includeAttachments ?? null,
    effective: effectiveBackupSettings(deps),
  }
}

/** Upsert singleton row 1, touching only the fields present in `patch` (null = clear to env default). */
function applySettingsPatch(deps: AppDeps, patch: z.infer<typeof BackupSettingsPatchSchema>): void {
  const updates: { retentionDays?: number | null; includeAttachments?: boolean | null } = {}
  if ('retentionDays' in patch) updates.retentionDays = patch.retentionDays ?? null
  if ('includeAttachments' in patch) updates.includeAttachments = patch.includeAttachments ?? null

  const existing = deps.db.select().from(backupSettings).where(eq(backupSettings.id, 1)).get()
  if (existing) {
    if (Object.keys(updates).length > 0) {
      deps.db.update(backupSettings).set(updates).where(eq(backupSettings.id, 1)).run()
    }
  } else {
    deps.db
      .insert(backupSettings)
      .values({
        id: 1,
        retentionDays: updates.retentionDays ?? null,
        includeAttachments: updates.includeAttachments ?? null,
      })
      .run()
  }
}

const listRoute = createRoute({
  method: 'get',
  path: '/backups',
  tags: ['Backups'],
  security,
  summary: 'List backups (newest first)',
  responses: {
    200: { content: { 'application/json': { schema: ListSchema } }, description: 'Backups' },
    401: problemResponse('Unauthorized'),
    403: problemResponse('Backups require read_write scope'),
  },
})

const createBackupRoute = createRoute({
  method: 'post',
  path: '/backups',
  tags: ['Backups'],
  security,
  summary: 'Create a manual backup now',
  responses: {
    201: { content: { 'application/json': { schema: BackupInfoSchema } }, description: 'Created' },
    401: problemResponse('Unauthorized'),
    403: problemResponse('Backups require read_write scope'),
  },
})

const getSettingsRoute = createRoute({
  method: 'get',
  path: '/backups/settings',
  tags: ['Backups'],
  security,
  summary: 'Get backup retention/attachment settings',
  responses: {
    200: {
      content: { 'application/json': { schema: BackupSettingsDtoSchema } },
      description: 'Settings',
    },
    401: problemResponse('Unauthorized'),
    403: problemResponse('Backups require read_write scope'),
  },
})

const patchSettingsRoute = createRoute({
  method: 'patch',
  path: '/backups/settings',
  tags: ['Backups'],
  security,
  summary: 'Update backup settings (null field = fall back to env/default)',
  request: {
    body: { content: { 'application/json': { schema: BackupSettingsPatchSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: BackupSettingsDtoSchema } },
      description: 'Updated',
    },
    400: problemResponse('Invalid patch'),
    401: problemResponse('Unauthorized'),
    403: problemResponse('Backups require read_write scope'),
  },
})

const downloadRoute = createRoute({
  method: 'get',
  path: '/backups/{filename}/download',
  tags: ['Backups'],
  security,
  summary: 'Download a backup zip',
  request: { params: z.object({ filename: z.string() }) },
  responses: {
    200: {
      content: { 'application/zip': { schema: z.string().openapi({ format: 'binary' }) } },
      description: 'The backup zip',
    },
    404: problemResponse('Unknown or invalid backup filename'),
    401: problemResponse('Unauthorized'),
    403: problemResponse('Backups require read_write scope'),
  },
})

const restoreRoute = createRoute({
  method: 'post',
  path: '/backups/restore',
  tags: ['Backups'],
  security,
  summary: 'Restore from an uploaded backup zip (replaces ALL data)',
  description:
    'Multipart upload (`file` field, a backup zip, up to 2 GiB). A pre-restore safety snapshot is ' +
    'taken first and the app pauses (503) while the swap runs.',
  request: {
    body: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: z.object({
            file: z
              .instanceof(File)
              .openapi({ type: 'string', format: 'binary', description: 'A backup zip.' }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: RestoreResponseSchema } },
      description: 'Restored',
    },
    400: problemResponse('Missing file or invalid/unverifiable backup zip'),
    401: problemResponse('Unauthorized'),
    403: problemResponse('Backups require read_write scope'),
    409: problemResponse('A restore is already in progress'),
    413: problemResponse('Upload exceeds the 2 GiB restore cap'),
  },
})

export const backupsRouter = () => {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return problem(c, 400, 'validation failed', undefined, { errors: result.error.issues })
      }
    },
  })

  app.openapi(listRoute, async (c) => {
    const denied = requireReadWrite(c)
    if (denied) return denied
    const results = await listBackups(c.get('deps'))
    return c.json({ results, next_cursor: null }, 200)
  })

  app.openapi(createBackupRoute, async (c) => {
    const denied = requireReadWrite(c)
    if (denied) return denied
    const info = await createBackup(c.get('deps'), { kind: 'manual' })
    return c.json(info, 201)
  })

  app.openapi(getSettingsRoute, (c) => {
    const denied = requireReadWrite(c)
    if (denied) return denied
    return c.json(readSettingsDto(c.get('deps')), 200)
  })

  app.openapi(patchSettingsRoute, (c) => {
    const denied = requireReadWrite(c)
    if (denied) return denied
    const deps = c.get('deps')
    applySettingsPatch(deps, c.req.valid('json'))
    return c.json(readSettingsDto(deps), 200)
  })

  app.openapi(downloadRoute, (c) => {
    const denied = requireReadWrite(c)
    if (denied) return denied
    const { filename } = c.req.valid('param')
    const deps = c.get('deps')
    // Boundary path-traversal guard (BACKUP_FILENAME_RE also backs backupFilePath).
    if (!BACKUP_FILENAME_RE.test(filename)) return problem(c, 404, 'not found')
    let path: string
    try {
      path = backupFilePath(deps.config.dataDir, filename)
    } catch {
      return problem(c, 404, 'not found')
    }
    if (!existsSync(path)) return problem(c, 404, 'not found')
    const stream = Readable.toWeb(createReadStream(path)) as ReadableStream
    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${filename}"`,
        'content-length': String(statSync(path).size),
      },
    })
  })

  app.openapi(restoreRoute, async (c) => {
    const denied = requireReadWrite(c)
    if (denied) return denied
    const { file } = c.req.valid('form')
    const deps = c.get('deps')
    if (file.size > RESTORE_MAX_BYTES) {
      return problem(c, 413, 'upload too large', 'Maximum restore upload is 2 GiB')
    }
    const tmpDir = join(deps.config.dataDir, 'tmp')
    mkdirSync(tmpDir, { recursive: true })
    const tmpZip = join(tmpDir, `restore-upload-${newId()}.zip`)
    writeFileSync(tmpZip, Buffer.from(await file.arrayBuffer()))
    try {
      const { preRestoreBackup } = await restoreFromZip(deps, tmpZip)
      return c.json({ restored: true as const, preRestoreBackup }, 200)
    } catch (err) {
      if (err instanceof HTTPException) {
        const title =
          err.status === 409
            ? 'restore in progress'
            : err.status === 400
              ? 'invalid backup'
              : 'restore failed'
        return problem(c, err.status, title, err.message)
      }
      throw err
    } finally {
      rmSync(tmpZip, { force: true })
    }
  })

  return app
}
