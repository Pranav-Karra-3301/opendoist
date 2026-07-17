/**
 * Import job runner (phase 9 Task G). Owns the async lifecycle of a Todoist import: insert a
 * `running` row, parse (backup zip) or fetch (live API) into an `ImportPlan`, then apply it or
 * produce a dry-run report, and persist status/progress/report on the `import_jobs` row.
 *
 * AS-BUILT ADAPTATION: Task A removed the global db/bus (see `apply.ts`), so this runner is
 * dependency-injected — `startImportJob`/`getImportJob` take the db (and, for start, the bus,
 * logger and authed userId) that the routes build from `c.get('deps')`. Concurrency ("one
 * running import at a time") is enforced against the `import_jobs` table itself, so it is
 * naturally per-instance and isolated between tests (each has its own database).
 */
import { unlinkSync } from 'node:fs'
import { count, eq } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { z } from 'zod'
import type { Db } from '../db/db'
import { importJobs } from '../db/schema'
import type { EventBus } from '../events/bus'
import { newId, nowIso } from '../lib/ids'
import { applyImportPlan, dryRunReport, type ImportApplyDeps } from './apply'
import { fetchTodoistExport } from './todoist-api'
import { parseTodoistBackupZip } from './todoist-csv'
import {
  ImportJobDtoSchema,
  type ImportPlan,
  type ImportProgress,
  ImportProgressSchema,
} from './types'

/** Wall-clock ms between throttled progress writes while fetching (plan Task G Step 1). */
const PROGRESS_THROTTLE_MS = 250

export type ImportJobDto = z.infer<typeof ImportJobDtoSchema>

/** Everything the runner needs, built by the routes from `c.get('deps')` + the authed user. */
export interface ImportJobContext {
  db: Db
  bus: EventBus
  logger: Logger
  /** owner of every row the apply step writes */
  userId: string
}

export interface StartImportInput {
  source: 'todoist-csv' | 'todoist-api'
  mode: 'dry-run' | 'apply'
  /** todoist-csv: the saved upload path, deleted once the job finishes */
  zipPath?: string
  /** todoist-api: the Todoist API token — never persisted or logged */
  token?: string
  /** todoist-api: optional self-hosted mirror base URL */
  baseUrl?: string
}

/** Thrown by `startImportJob` when an import is already running; the routes map it to 409. */
export class ImportRunningError extends Error {
  constructor() {
    super('An import is already running')
    this.name = 'ImportRunningError'
  }
}

function isImportRunning(db: Db): boolean {
  const row = db
    .select({ n: count() })
    .from(importJobs)
    .where(eq(importJobs.status, 'running'))
    .get()
  return (row?.n ?? 0) > 0
}

/**
 * Insert the `running` row and kick off the async pipeline (fire-and-forget); returns the job id.
 * The check-and-insert is synchronous, so no two concurrent requests can both start a job.
 */
export function startImportJob(ctx: ImportJobContext, input: StartImportInput): string {
  if (isImportRunning(ctx.db)) throw new ImportRunningError()
  const id = newId()
  const initialPhase: ImportProgress['phase'] =
    input.source === 'todoist-csv' ? 'parsing' : 'fetching'
  ctx.db
    .insert(importJobs)
    .values({
      id,
      source: input.source,
      mode: input.mode,
      status: 'running',
      progress: JSON.stringify({ phase: initialPhase, detail: '' } satisfies ImportProgress),
      report: null,
      error: null,
      createdAt: nowIso(),
      finishedAt: null,
    })
    .run()
  void runImportJob(ctx, id, input)
  return id
}

async function runImportJob(
  ctx: ImportJobContext,
  id: string,
  input: StartImportInput,
): Promise<void> {
  let lastProgressWrite = 0
  const writeProgress = (p: ImportProgress) => {
    ctx.db
      .update(importJobs)
      .set({ progress: JSON.stringify(ImportProgressSchema.parse(p)) })
      .where(eq(importJobs.id, id))
      .run()
  }
  // Progress updates from the live-API fetch are best-effort and rate-limited: a write failure
  // (or a burst of callbacks) must never fail the underlying import.
  const throttledProgress = (p: ImportProgress) => {
    const now = Date.now()
    if (now - lastProgressWrite < PROGRESS_THROTTLE_MS) return
    lastProgressWrite = now
    try {
      writeProgress(p)
    } catch (err) {
      ctx.logger.warn({ err, jobId: id }, 'failed to persist import progress')
    }
  }

  try {
    let plan: ImportPlan
    if (input.source === 'todoist-csv') {
      if (input.zipPath === undefined) throw new Error('missing uploaded backup file')
      plan = await parseTodoistBackupZip(input.zipPath)
    } else {
      if (input.token === undefined) throw new Error('missing Todoist API token')
      plan = await fetchTodoistExport(input.token, {
        baseUrl: input.baseUrl,
        onProgress: throttledProgress,
      })
    }

    writeProgress({ phase: 'applying', detail: '' })
    const deps: ImportApplyDeps = { db: ctx.db, userId: ctx.userId, bus: ctx.bus }
    const report = input.mode === 'apply' ? applyImportPlan(deps, plan) : dryRunReport(deps, plan)

    ctx.db
      .update(importJobs)
      .set({
        status: 'done',
        report: JSON.stringify(report),
        progress: JSON.stringify({ phase: 'done', detail: '' } satisfies ImportProgress),
        finishedAt: nowIso(),
      })
      .where(eq(importJobs.id, id))
      .run()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    try {
      ctx.db
        .update(importJobs)
        .set({
          status: 'error',
          error: message,
          progress: JSON.stringify({ phase: 'error', detail: message } satisfies ImportProgress),
          finishedAt: nowIso(),
        })
        .where(eq(importJobs.id, id))
        .run()
    } catch (writeErr) {
      ctx.logger.error({ err: writeErr, jobId: id }, 'failed to persist import job error')
    }
    ctx.logger.error({ err, jobId: id }, 'import job failed')
  } finally {
    if (input.zipPath !== undefined) {
      try {
        unlinkSync(input.zipPath)
      } catch {
        // best-effort tmp cleanup — the upload may already be gone
      }
    }
  }
}

function rowToDto(row: typeof importJobs.$inferSelect): ImportJobDto {
  return ImportJobDtoSchema.parse({
    id: row.id,
    source: row.source,
    mode: row.mode,
    status: row.status,
    progress: JSON.parse(row.progress),
    report: row.report === null ? null : JSON.parse(row.report),
    error: row.error,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  })
}

export function getImportJob(db: Db, id: string): ImportJobDto | null {
  const row = db.select().from(importJobs).where(eq(importJobs.id, id)).get()
  return row === undefined ? null : rowToDto(row)
}
