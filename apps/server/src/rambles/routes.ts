/**
 * Phase 7 Task F — ramble HTTP routes (mounted under `/api/v1` by Task N).
 *
 * Multipart upload → status-machine stages (transcribe/extract) → confirm → discard.
 * The service is built per request from `deps`; the STT/extractor resolvers come from
 * `provider-config` + `registry`, and `createTask` is a port adapter that reproduces the
 * `POST /tasks/quick` creation path (SSE publish + activity log + auto-reminder). Tests
 * inject fake resolvers and `autoRun: false` through `RambleRoutesOverrides`.
 */
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, eq, isNull } from 'drizzle-orm'
import type { Context } from 'hono'
import type { AppDeps, AppEnv } from '../app'
import type { Config } from '../config'
import type { Db } from '../db/db'
import { labels } from '../db/schema'
import { logActivity } from '../lib/activity'
import { parseContextFor } from '../lib/parse-context'
import { problem } from '../lib/problem'
import { syncTaskReminders } from '../reminders/materialize'
import { type CreateTaskInput, createTask, getSettings } from '../services/task-write'
import { type ProviderEnv, resolveLlmConfig, resolveSttConfig } from './provider-config'
import { createExtractor, createSttProvider } from './providers/registry'
import type { SttProvider, TaskExtractor } from './providers/types'
import {
  ConfirmRambleResponseSchema,
  ConfirmRambleSchema,
  RambleListSchema,
  RambleSchema,
} from './schemas'
import {
  createRambleService,
  RambleConflictError,
  RambleNotFoundError,
  SttUnconfiguredError,
} from './service'
import type { CreateTaskPort, RambleService } from './types'

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

const IdParam = z.object({ id: z.string().min(1) })

/**
 * Adapter over the as-built task-creation service used by `POST /tasks/quick` — reproduces
 * its side effects exactly (SSE `task.created`, activity `task_added`, auto-reminder sync) so a
 * confirmed ramble is indistinguishable from a Quick Add task.
 */
function makeCreateTaskPort(deps: AppDeps): CreateTaskPort {
  return async (userId, draft) => {
    const input: CreateTaskInput = {
      content: draft.content,
      description: draft.description ?? '',
      projectId: null,
      sectionId: null,
      parentId: null,
      childOrder: null,
      priority: draft.priority,
      dueDate: draft.due?.date ?? null,
      dueTime: draft.due?.time ?? null,
      dueString: draft.due?.string ?? null,
      recurrence: draft.due?.recurrence ?? null,
      deadlineDate: null,
      durationMin: null,
      labels: draft.labels,
      uncompletable: null,
    }
    const row = createTask(deps.db, userId, input)
    logActivity(deps.db, {
      userId,
      eventType: 'task_added',
      entityType: 'task',
      entityId: row.id,
      projectId: row.projectId,
      payload: { via: 'ramble' },
    })
    deps.bus.publish({ userId, type: 'task.created', entity: 'task', ids: [row.id] })
    await syncTaskReminders(deps.db, row.id)
    return { id: row.id }
  }
}

/** Non-deleted label names for the extractor's `knownLabels` hint. */
function listLabelNames(db: Db, userId: string): string[] {
  return db
    .select({ name: labels.name })
    .from(labels)
    .where(and(eq(labels.userId, userId), isNull(labels.deletedAt)))
    .all()
    .map((r) => r.name)
}

/** Build the provider `ProviderEnv` from parsed instance config (single source of truth is env). */
function providerEnvFromConfig(config: Config): ProviderEnv {
  return {
    sttProvider: config.stt?.provider,
    sttBaseUrl: config.stt?.baseUrl ?? undefined,
    sttModel: config.stt?.model ?? undefined,
    sttApiKey: config.stt?.apiKey ?? undefined,
    llmProvider: config.llm?.provider,
    llmBaseUrl: config.llm?.baseUrl ?? undefined,
    llmModel: config.llm?.model ?? undefined,
    llmApiKey: config.llm?.apiKey ?? undefined,
  }
}

/** Test seam: override the provider resolvers and disable auto-run without external services. */
export interface RambleRoutesOverrides {
  resolveStt?: (userId: string) => Promise<SttProvider | null>
  resolveExtractor?: (userId: string) => Promise<TaskExtractor>
  autoRun?: boolean
}

function buildRambleService(deps: AppDeps, overrides?: RambleRoutesOverrides): RambleService {
  const env = providerEnvFromConfig(deps.config)
  return createRambleService({
    db: deps.db,
    dataDir: deps.config.dataDir,
    resolveStt:
      overrides?.resolveStt ??
      (async (userId) => {
        const cfg = await resolveSttConfig(deps.db, userId, env)
        return cfg === null ? null : createSttProvider(cfg)
      }),
    resolveExtractor:
      overrides?.resolveExtractor ??
      (async (userId) => {
        const cfg = await resolveLlmConfig(deps.db, userId, env)
        return createExtractor(cfg)
      }),
    createTask: makeCreateTaskPort(deps),
    listLabelNames: async (userId) => listLabelNames(deps.db, userId),
    autoRun: overrides?.autoRun,
  })
}

const uploadRoute = createRoute({
  method: 'post',
  path: '/rambles',
  tags: ['rambles'],
  security,
  summary: 'Upload a voice ramble',
  description:
    'Multipart upload (`audio` file field). Persists the audio and starts the transcribe→extract ' +
    'pipeline. Rejects with 409 when no speech-to-text provider is configured, and 413 when the ' +
    'file exceeds the configured upload cap.',
  request: {
    body: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            properties: {
              audio: {
                type: 'string',
                format: 'binary',
                description: 'The recorded audio (webm/opus, mp4/m4a, wav, …).',
              },
            },
            required: ['audio'],
          },
        },
      },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: RambleSchema } },
      description: 'Created ramble',
    },
    400: problemResponse('Missing `audio` field or not a multipart form'),
    409: problemResponse('No speech-to-text provider is configured'),
    413: problemResponse('Upload exceeds the configured size cap'),
  },
})

const listRoute = createRoute({
  method: 'get',
  path: '/rambles',
  tags: ['rambles'],
  security,
  summary: 'List recent rambles',
  description: 'Newest first, single page (limit 50). `next_cursor` is always null.',
  responses: {
    200: { content: { 'application/json': { schema: RambleListSchema } }, description: 'Rambles' },
    401: problemResponse('Unauthorized'),
  },
})

const getRoute = createRoute({
  method: 'get',
  path: '/rambles/{id}',
  tags: ['rambles'],
  security,
  summary: 'Get a ramble',
  request: { params: IdParam },
  responses: {
    200: { content: { 'application/json': { schema: RambleSchema } }, description: 'Ramble' },
    404: problemResponse('Unknown ramble or foreign owner'),
  },
})

const transcribeRoute = createRoute({
  method: 'post',
  path: '/rambles/{id}/transcribe',
  tags: ['rambles'],
  security,
  summary: 'Run (or retry) the transcribe stage',
  description:
    'Valid from status `uploaded` or a `failed`@`transcribe`. On success the ramble becomes ' +
    '`transcribed`; on provider failure it becomes `failed` with `failedStage: transcribe` and an ' +
    'error message (returned with HTTP 200, not an error status).',
  request: { params: IdParam },
  responses: {
    200: { content: { 'application/json': { schema: RambleSchema } }, description: 'Ramble' },
    404: problemResponse('Unknown ramble'),
    409: problemResponse('Ramble is not in a transcribable state'),
  },
})

const extractRoute = createRoute({
  method: 'post',
  path: '/rambles/{id}/extract',
  tags: ['rambles'],
  security,
  summary: 'Run (or retry) the extract stage',
  description:
    'Valid from status `transcribed`, `extracted`, or a `failed`@`extract`. Requires a transcript. ' +
    'The `none` extractor also lands on `extracted` for a uniform client flow.',
  request: { params: IdParam },
  responses: {
    200: { content: { 'application/json': { schema: RambleSchema } }, description: 'Ramble' },
    404: problemResponse('Unknown ramble'),
    409: problemResponse('Ramble is not in an extractable state or has no transcript'),
  },
})

const confirmRoute = createRoute({
  method: 'post',
  path: '/rambles/{id}/confirm',
  tags: ['rambles'],
  security,
  summary: 'Confirm the extracted tasks',
  description:
    'Creates tasks from the (edited) items through the same path as `POST /tasks/quick`, marks the ' +
    'ramble `confirmed`, and deletes the audio file. Valid only from status `extracted`. If task ' +
    'creation throws midway the ramble stays `extracted` and the client may re-confirm (already-' +
    'created tasks are not rolled back).',
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: ConfirmRambleSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ConfirmRambleResponseSchema } },
      description: 'Created task ids',
    },
    400: problemResponse('Invalid confirm body'),
    404: problemResponse('Unknown ramble'),
    409: problemResponse('Ramble is not in the extracted state'),
  },
})

const deleteRoute = createRoute({
  method: 'delete',
  path: '/rambles/{id}',
  tags: ['rambles'],
  security,
  summary: 'Discard a ramble',
  description: 'Hard-deletes the row and its audio file. Rambles are transient capture state.',
  request: { params: IdParam },
  responses: {
    204: { description: 'Discarded' },
    404: problemResponse('Unknown ramble'),
  },
})

export const rambleRoutes = (overrides?: RambleRoutesOverrides) => {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return problem(c, 400, 'validation failed', undefined, { errors: result.error.issues })
      }
    },
  })

  const service = (c: Context<AppEnv>): RambleService =>
    buildRambleService(c.get('deps'), overrides)

  app.openapi(uploadRoute, async (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { config } = c.get('deps')
    const maxBytes = config.uploadMaxMb * 1024 * 1024

    // Reject oversized uploads by Content-Length before buffering the whole body when possible.
    const declared = Number(c.req.header('content-length') ?? '')
    if (Number.isFinite(declared) && declared > maxBytes) {
      return problem(c, 413, 'upload too large', `Maximum upload size is ${config.uploadMaxMb} MB`)
    }

    let body: Record<string, string | File>
    try {
      body = await c.req.parseBody()
    } catch {
      return problem(c, 400, 'invalid upload', 'Expected a multipart form with an `audio` file')
    }
    const audio = body.audio
    if (!(audio instanceof File)) {
      return problem(c, 400, 'invalid upload', 'Missing `audio` file field')
    }
    const data = Buffer.from(await audio.arrayBuffer())
    if (data.byteLength > maxBytes) {
      return problem(c, 413, 'upload too large', `Maximum upload size is ${config.uploadMaxMb} MB`)
    }
    const mimeType = audio.type.length > 0 ? audio.type : 'application/octet-stream'

    try {
      const dto = await service(c).create(auth.userId, { data, mimeType, filename: audio.name })
      return c.json(dto, 201)
    } catch (err) {
      if (err instanceof SttUnconfiguredError) {
        return problem(c, 409, 'stt not configured', err.message)
      }
      throw err
    }
  })

  app.openapi(listRoute, async (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const results = await service(c).list(auth.userId, 50)
    return c.json({ results, next_cursor: null }, 200)
  })

  app.openapi(getRoute, async (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { id } = c.req.valid('param')
    const dto = await service(c).get(auth.userId, id)
    if (dto === null) return problem(c, 404, 'not found')
    return c.json(dto, 200)
  })

  app.openapi(transcribeRoute, async (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { id } = c.req.valid('param')
    try {
      const dto = await service(c).runTranscribe(auth.userId, id)
      return c.json(dto, 200)
    } catch (err) {
      return stageError(c, err)
    }
  })

  app.openapi(extractRoute, async (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { id } = c.req.valid('param')
    try {
      const dto = await service(c).runExtract(auth.userId, id)
      return c.json(dto, 200)
    } catch (err) {
      return stageError(c, err)
    }
  })

  app.openapi(confirmRoute, async (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db } = c.get('deps')
    const { id } = c.req.valid('param')
    const { tasks } = c.req.valid('json')
    const ctx = parseContextFor(getSettings(db, auth.userId))
    try {
      const result = await service(c).confirm(auth.userId, id, tasks, ctx)
      return c.json(result, 200)
    } catch (err) {
      return stageError(c, err)
    }
  })

  app.openapi(deleteRoute, async (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { id } = c.req.valid('param')
    try {
      await service(c).discard(auth.userId, id)
      return c.body(null, 204)
    } catch (err) {
      if (err instanceof RambleNotFoundError) return problem(c, 404, 'not found')
      throw err
    }
  })

  return app
}

/** Map a stage/confirm error to problem-JSON: NotFound → 404, Conflict → 409, else rethrow. */
function stageError(c: Context<AppEnv>, err: unknown) {
  if (err instanceof RambleNotFoundError) return problem(c, 404, 'not found')
  if (err instanceof RambleConflictError)
    return problem(c, 409, 'invalid ramble status', err.message)
  throw err
}
