import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, eq } from 'drizzle-orm'
import type { AppEnv } from '../../app'
import { attachments } from '../../db/schema'
import { newId, nowIso } from '../../lib/ids'
import { problem } from '../../lib/problem'
import { AttachmentDtoSchema, IdSchema } from '../schemas'

type AttachmentRow = typeof attachments.$inferSelect

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

/** Wire DTO for an attachment. `file_url` is the authenticated download path. */
export function attachmentToDto(row: AttachmentRow) {
  return {
    id: row.id,
    file_name: row.fileName,
    file_size: row.fileSize,
    file_type: row.fileType,
    file_url: `/api/v1/attachments/${row.id}/${encodeURIComponent(row.fileName)}`,
  }
}

/** Reduce any upload name to a safe basename: no directory parts, null bytes, or `.`/`..`. */
function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? ''
  const cleaned = base.replace(/\0/g, '').replace(/[/\\]/g, '').trim()
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return 'file'
  return cleaned
}

const uploadRoute = createRoute({
  method: 'post',
  path: '/attachments',
  tags: ['attachments'],
  security,
  summary: 'Upload a file',
  description:
    'Multipart upload (`file` field required). The stored name is the sanitized basename of the ' +
    'uploaded filename, and the returned `file_url` is the authenticated download path.',
  request: {
    body: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: z.object({
            file: z
              .instanceof(File)
              .openapi({ type: 'string', format: 'binary', description: 'The file to store.' }),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: AttachmentDtoSchema } },
      description: 'Stored attachment',
    },
    400: problemResponse('Missing `file` field or not a multipart form'),
    413: problemResponse('Upload exceeds the configured size cap'),
  },
})

const downloadRoute = createRoute({
  method: 'get',
  path: '/attachments/{id}/{filename}',
  tags: ['attachments'],
  security,
  summary: 'Download a stored file',
  description:
    'Streams the stored bytes with the stored content type. `filename` must equal the stored ' +
    'file name. Images are served `inline`, everything else as an `attachment` download.',
  request: { params: z.object({ id: IdSchema, filename: z.string().min(1) }) },
  responses: {
    200: {
      content: {
        'application/octet-stream': {
          schema: z.string().openapi({ format: 'binary' }),
        },
      },
      description: 'The file bytes (content-type is the stored file type)',
    },
    404: problemResponse('Unknown attachment, foreign owner, or filename mismatch'),
  },
})

export const attachmentsRoutes = () => {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return problem(c, 400, 'validation failed', undefined, { errors: result.error.issues })
      }
    },
  })

  // Multipart upload. Stored at `<dataDir>/attachments/<id>/<fileName>`.
  app.openapi(uploadRoute, async (c) => {
    const { db, config } = c.get('deps')
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')

    const { file } = c.req.valid('form')
    if (file.size > config.uploadMaxMb * 1024 * 1024) {
      return problem(c, 413, 'upload too large', `Maximum upload size is ${config.uploadMaxMb} MB`)
    }

    const fileName = sanitizeFilename(file.name)
    const id = newId()
    const dir = join(config.dataDir, 'attachments', id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, fileName), Buffer.from(await file.arrayBuffer()))

    const fileType = file.type.length > 0 ? file.type : 'application/octet-stream'
    const row = db
      .insert(attachments)
      .values({
        id,
        userId: auth.userId,
        fileName,
        fileSize: file.size,
        fileType,
        filePath: join(id, fileName),
        createdAt: nowIso(),
      })
      .returning()
      .get()
    return c.json(attachmentToDto(row), 201)
  })

  // Authenticated download. The filename param must equal the stored name (404 otherwise), and
  // bytes are only ever served from the DB-stored relative path — traversal is unmatchable.
  app.openapi(downloadRoute, (c) => {
    const { db, config } = c.get('deps')
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')

    const { id, filename } = c.req.valid('param')
    const row = db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, id), eq(attachments.userId, auth.userId)))
      .get()
    if (row === undefined || row.fileName !== filename) return problem(c, 404, 'not found')

    const attachmentsRoot = join(config.dataDir, 'attachments')
    const abs = join(attachmentsRoot, row.filePath)
    if (!resolve(abs).startsWith(resolve(attachmentsRoot) + sep) || !existsSync(abs)) {
      return problem(c, 404, 'not found')
    }

    const dispositionType = row.fileType.startsWith('image/') ? 'inline' : 'attachment'
    const headerName = row.fileName.replace(/["\\]/g, '')
    return new Response(readFileSync(abs), {
      status: 200,
      headers: {
        'content-type': row.fileType,
        'content-disposition': `${dispositionType}; filename="${headerName}"`,
      },
    })
  })

  return app
}
