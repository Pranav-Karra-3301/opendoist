/**
 * Phase 7 Task F — ramble pipeline service.
 *
 * A status machine persisted on the `rambles` row: `uploaded → transcribed → extracted →
 * confirmed`, with `failed` + `failedStage` at the transcribe/extract stages (each stage
 * retryable without re-recording). Audio is written under `<dataDir>/rambles/<id>.<ext>`
 * and deleted on confirm/discard. Provider slots (STT + extractor) and the task-creation
 * port are injected via `RambleServiceDeps` so the whole pipeline is testable with fakes.
 */
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { rambles } from '../db/schema'
import { newId } from '../lib/ids'
import { getSettings } from '../services/task-write'
import { buildTaskDrafts } from './confirm'
import { ExtractedTaskSchema, type RambleDto } from './schemas'
import type { RambleService, RambleServiceDeps } from './types'

type RambleRow = typeof rambles.$inferSelect

/** Thrown by `create` when no STT provider is configured; the route maps it to 409. */
export class SttUnconfiguredError extends Error {
  constructor() {
    super('No speech-to-text provider is configured')
    this.name = 'SttUnconfiguredError'
  }
}

/** Unknown/foreign ramble id — the route maps it to 404. */
export class RambleNotFoundError extends Error {
  constructor() {
    super('ramble not found')
    this.name = 'RambleNotFoundError'
  }
}

/** Stage invoked from an incompatible status (or missing transcript) — the route maps it to 409. */
export class RambleConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RambleConflictError'
  }
}

const ExtractedArraySchema = z.array(ExtractedTaskSchema)

/** File extension for the stored audio, derived from the recorder mime (dossier §5.7). */
function extForMime(mime: string): string {
  const m = mime.toLowerCase()
  if (m.includes('webm')) return 'webm'
  if (m.includes('m4a') || m.includes('mp4')) return 'm4a'
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3'
  if (m.includes('wav')) return 'wav'
  return 'bin'
}

/** Row → wire DTO. Parses `extractedJson`; never exposes `audioPath`/`userId`. */
function rowToDto(row: RambleRow): RambleDto {
  return {
    id: row.id,
    status: row.status,
    audioMime: row.audioMime,
    audioBytes: row.audioBytes,
    durationSec: row.durationSec,
    transcript: row.transcript,
    extractedTasks:
      row.extractedJson === null ? null : ExtractedArraySchema.parse(JSON.parse(row.extractedJson)),
    error: row.error,
    failedStage: row.failedStage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** unlink that tolerates an already-deleted file (ENOENT) and rethrows anything else. */
async function unlinkQuiet(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function createRambleService(deps: RambleServiceDeps): RambleService {
  const { db, dataDir } = deps
  const clock = deps.now ?? (() => new Date())
  const stamp = () => clock().toISOString()

  function load(userId: string, id: string): RambleRow | undefined {
    return db
      .select()
      .from(rambles)
      .where(and(eq(rambles.id, id), eq(rambles.userId, userId)))
      .get()
  }

  function absAudioPath(row: RambleRow): string | null {
    return row.audioPath === null ? null : join(dataDir, row.audioPath)
  }

  const service: RambleService = {
    async create(userId, audio) {
      // Reject BEFORE persisting/writing when STT is unconfigured.
      const provider = await deps.resolveStt(userId)
      if (provider === null) throw new SttUnconfiguredError()

      const id = newId()
      const relPath = `rambles/${id}.${extForMime(audio.mimeType)}`
      await mkdir(join(dataDir, 'rambles'), { recursive: true })
      await writeFile(join(dataDir, relPath), audio.data, { mode: 0o600 })

      const now = stamp()
      const row = db
        .insert(rambles)
        .values({
          id,
          userId,
          status: 'uploaded',
          audioPath: relPath,
          audioMime: audio.mimeType,
          audioBytes: audio.data.byteLength,
          durationSec: null,
          transcript: null,
          extractedJson: null,
          error: null,
          failedStage: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get()

      // Fire the pipeline asynchronously; stage failures are persisted on the row (never rethrown),
      // so this detached chain can only reject on an unexpected bug — swallow to avoid an
      // unhandled rejection. Tests pass `autoRun: false` and drive the stages by hand.
      if (deps.autoRun !== false) {
        void service
          .runTranscribe(userId, id)
          .then((r) => (r.status === 'transcribed' ? service.runExtract(userId, id) : undefined))
          .catch(() => {})
      }
      return rowToDto(row)
    },

    async get(userId, id) {
      const row = load(userId, id)
      return row === undefined ? null : rowToDto(row)
    },

    async list(userId, limit = 50) {
      const rows = db
        .select()
        .from(rambles)
        .where(eq(rambles.userId, userId))
        .orderBy(desc(rambles.createdAt))
        .limit(limit)
        .all()
      return rows.map(rowToDto)
    },

    async runTranscribe(userId, id) {
      const row = load(userId, id)
      if (row === undefined) throw new RambleNotFoundError()
      const isRetry = row.status === 'failed' && row.failedStage === 'transcribe'
      if (row.status !== 'uploaded' && !isRetry) {
        throw new RambleConflictError(`cannot transcribe a ramble with status '${row.status}'`)
      }
      try {
        const provider = await deps.resolveStt(userId)
        if (provider === null) throw new Error('No speech-to-text provider is configured')
        const path = absAudioPath(row)
        if (path === null) throw new Error('audio file is no longer available')
        const data = await readFile(path)
        const filename = row.audioPath?.split('/').pop() ?? id
        const result = await provider.transcribe({ data, mimeType: row.audioMime, filename })
        const updated = db
          .update(rambles)
          .set({
            status: 'transcribed',
            transcript: result.text,
            durationSec: result.durationSec ?? row.durationSec,
            error: null,
            failedStage: null,
            updatedAt: stamp(),
          })
          .where(and(eq(rambles.id, id), eq(rambles.userId, userId)))
          .returning()
          .get()
        return rowToDto(updated)
      } catch (err) {
        const updated = db
          .update(rambles)
          .set({
            status: 'failed',
            failedStage: 'transcribe',
            error: errorMessage(err),
            updatedAt: stamp(),
          })
          .where(and(eq(rambles.id, id), eq(rambles.userId, userId)))
          .returning()
          .get()
        return rowToDto(updated)
      }
    },

    async runExtract(userId, id) {
      const row = load(userId, id)
      if (row === undefined) throw new RambleNotFoundError()
      const isRetry = row.status === 'failed' && row.failedStage === 'extract'
      if (row.status !== 'transcribed' && row.status !== 'extracted' && !isRetry) {
        throw new RambleConflictError(`cannot extract a ramble with status '${row.status}'`)
      }
      if (row.transcript === null) {
        throw new RambleConflictError('ramble has no transcript to extract from')
      }
      try {
        const extractor = await deps.resolveExtractor(userId)
        const timezone = getSettings(db, userId).timezone
        const knownLabels = await deps.listLabelNames(userId)
        const { tasks } = await extractor.extract(row.transcript, {
          now: stamp(),
          timezone,
          knownLabels,
        })
        const updated = db
          .update(rambles)
          .set({
            status: 'extracted',
            extractedJson: JSON.stringify(tasks),
            error: null,
            failedStage: null,
            updatedAt: stamp(),
          })
          .where(and(eq(rambles.id, id), eq(rambles.userId, userId)))
          .returning()
          .get()
        return rowToDto(updated)
      } catch (err) {
        const updated = db
          .update(rambles)
          .set({
            status: 'failed',
            failedStage: 'extract',
            error: errorMessage(err),
            updatedAt: stamp(),
          })
          .where(and(eq(rambles.id, id), eq(rambles.userId, userId)))
          .returning()
          .get()
        return rowToDto(updated)
      }
    },

    async confirm(userId, id, items, ctx) {
      const row = load(userId, id)
      if (row === undefined) throw new RambleNotFoundError()
      if (row.status !== 'extracted') {
        throw new RambleConflictError(`cannot confirm a ramble with status '${row.status}'`)
      }

      // Create tasks sequentially through the injected port (SSE + activity + auto-reminder).
      // A mid-way failure leaves the row 'extracted' and rethrows — the client may re-confirm.
      const drafts = buildTaskDrafts(items, ctx)
      const createdTaskIds: string[] = []
      for (const draft of drafts) {
        const created = await deps.createTask(userId, draft)
        createdTaskIds.push(created.id)
      }

      const path = absAudioPath(row)
      db.update(rambles)
        .set({
          status: 'confirmed',
          extractedJson: JSON.stringify(items),
          audioPath: null,
          updatedAt: stamp(),
        })
        .where(and(eq(rambles.id, id), eq(rambles.userId, userId)))
        .run()
      if (path !== null) await unlinkQuiet(path)
      return { createdTaskIds }
    },

    async discard(userId, id) {
      const row = load(userId, id)
      if (row === undefined) throw new RambleNotFoundError()
      const path = absAudioPath(row)
      if (path !== null) await unlinkQuiet(path)
      db.delete(rambles)
        .where(and(eq(rambles.id, id), eq(rambles.userId, userId)))
        .run()
    },
  }

  return service
}
