/**
 * Phase 7 FROZEN service + port contracts (plan Task A Step 5). Task F implements
 * `createRambleService` in `service.ts` and re-exports it here — final shape: this file
 * holds interfaces only plus `export { createRambleService } from './service'`.
 */
import type { Due, ParseContext, Priority } from '@opentask/core'
import type { Db } from '../db/db'
import type { SttProvider, TaskExtractor } from './providers/types'
import type { ExtractedTask, RambleDto } from './schemas'

/** Draft ready for creation — same fields the /tasks/quick path produces from ParsedQuickAdd. */
export interface TaskDraft {
  content: string
  description: string | null
  due: Due | null
  priority: Priority
  labels: string[]
}

/** Adapter over the as-built task-creation service used by POST /tasks/quick.
 *  MUST go through the same service (SSE publish + activity log + auto-reminder come for free). */
export type CreateTaskPort = (userId: string, draft: TaskDraft) => Promise<{ id: string }>

export interface RambleServiceDeps {
  db: Db
  dataDir: string
  /** null → STT unconfigured → uploads rejected 409 */
  resolveStt: (userId: string) => Promise<SttProvider | null>
  resolveExtractor: (userId: string) => Promise<TaskExtractor>
  createTask: CreateTaskPort
  listLabelNames: (userId: string) => Promise<string[]>
  /** true (default) = upload kicks transcribe→extract asynchronously; tests set false and drive stages */
  autoRun?: boolean
  now?: () => Date
}

export interface RambleService {
  create(
    userId: string,
    audio: { data: Buffer; mimeType: string; filename: string },
  ): Promise<RambleDto>
  get(userId: string, id: string): Promise<RambleDto | null>
  list(userId: string, limit?: number): Promise<RambleDto[]>
  /** valid from status 'uploaded' or failed@transcribe; else ConflictError */
  runTranscribe(userId: string, id: string): Promise<RambleDto>
  /** valid from 'transcribed', 'extracted', or failed@extract; else ConflictError */
  runExtract(userId: string, id: string): Promise<RambleDto>
  /** valid from 'extracted' (or 'transcribed' when extractor id === 'none' ran); creates tasks from the
   *  EDITED items in the request, sets status 'confirmed', persists final items, deletes the audio file. */
  confirm(
    userId: string,
    id: string,
    items: ExtractedTask[],
    ctx: ParseContext,
  ): Promise<{ createdTaskIds: string[] }>
  /** hard-deletes row + audio file (rambles are transient capture state, not user-visible tasks) */
  discard(userId: string, id: string): Promise<void>
}

export { createRambleService } from './service'
