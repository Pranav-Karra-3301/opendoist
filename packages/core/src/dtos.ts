/**
 * Phase-5 wire DTOs — FROZEN contract (plan Task A Step 2). Client-side parse schemas
 * for the phase-3/5 server routes (activities, tasks/completed, search, tokens).
 * Task B makes the server responses validate against these.
 */
import { z } from 'zod'
import { IsoDateSchema, PrioritySchema } from './types'

/** Known activity types (UI icons/labels); DTO tolerates unknown strings so server drift never breaks the feed. */
export const KNOWN_ACTIVITY_TYPES = [
  'task_added',
  'task_updated',
  'task_completed',
  'task_uncompleted',
  'task_deleted',
  'task_restored',
  'task_moved',
  'project_added',
  'project_updated',
  'project_archived',
  'project_unarchived',
  'project_deleted',
  'project_restored',
  'section_added',
  'section_updated',
  'section_deleted',
  'section_restored',
  'label_added',
  'label_updated',
  'label_deleted',
  'filter_added',
  'filter_updated',
  'filter_deleted',
  'comment_added',
  'comment_deleted',
] as const
export type KnownActivityType = (typeof KNOWN_ACTIVITY_TYPES)[number]

/** Wire shape = phase 3's ActivityDto (snake_case top level: event_type/entity_type/entity_id/project_id/at)
 *  EXTENDED by Task B with a read-time-denormalized `payload` object. Phase 3's stored event-specific
 *  payload lands in `payload.meta`; content/project_name are joined at read time. */
export const ActivityEventSchema = z.object({
  id: z.string(),
  event_type: z.string(), // tolerates unknown strings so server drift never breaks the feed
  entity_type: z.string().default(''),
  entity_id: z.string(),
  project_id: z.string().nullable().default(null),
  /** ISO instant */
  at: z.string(),
  payload: z
    .object({
      content: z.string().default(''),
      project_name: z.string().nullable().default(null),
      meta: z.record(z.string(), z.unknown()).default({}),
    })
    .default({ content: '', project_name: null, meta: {} }),
})
export type ActivityEvent = z.infer<typeof ActivityEventSchema>
export const ActivityPageSchema = z.object({
  results: z.array(ActivityEventSchema),
  next_cursor: z.string().nullable(),
})

/** Subset parse of phase 3's TaskDto rows served by GET /tasks/completed — the response contract
 *  stays phase 3's TaskDto page (zod strips the fields we don't need). Project names are joined
 *  client-side from the `['projects']` cache. */
export const CompletedTaskSchema = z.object({
  id: z.string(),
  content: z.string(),
  project_id: z.string(),
  /** Board columns attribute completed cards to their section column (board-view pass);
   *  defaulted so rows from older callers/tests without the field still parse. */
  section_id: z.string().nullable().default(null),
  /** Due DATE only (board day columns attribute completed cards by it); the row's full due
   *  object is stripped down to the date, and a missing due defaults to null. */
  due: z.object({ date: z.string() }).nullable().default(null),
  priority: PrioritySchema.default(4),
  /** ISO instant */
  completed_at: z.string(),
})
export type CompletedTask = z.infer<typeof CompletedTaskSchema>
export const CompletedPageSchema = z.object({
  results: z.array(CompletedTaskSchema),
  next_cursor: z.string().nullable(),
})

/** One hit from GET /search — phase 3's `{task, matched_in}` wrapper (matched_in: 'task' | 'comment';
 *  phase 3's FTS cannot distinguish content vs description hits), EXTENDED by Task B with `snippet`. */
export const SearchResultSchema = z.object({
  task: z
    .object({
      id: z.string(),
      content: z.string(),
      project_id: z.string(),
      completed_at: z.string().nullable().default(null),
      due: z.object({ date: IsoDateSchema }).partial().nullable().default(null),
    })
    .passthrough(), // full TaskDto on the wire; parse only what the palette renders
  matched_in: z.enum(['task', 'comment']),
  /** FTS snippet with <b>…</b> marks around matches; '' when unavailable */
  snippet: z.string().default(''),
})
export type SearchResult = z.infer<typeof SearchResultSchema>
export const SearchPageSchema = z.object({
  results: z.array(SearchResultSchema),
  next_cursor: z.string().nullable().default(null),
})

export const ApiTokenScopeSchema = z.enum(['read', 'read_write'])
export const ApiTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  scope: ApiTokenScopeSchema,
  /** first 8 chars of the token for identification, e.g. 'ot_3fa9…' */
  start: z.string().default('ot_'),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable().default(null),
})
export type ApiToken = z.infer<typeof ApiTokenSchema>
/** returned ONLY from POST /tokens; `token` is shown once and never retrievable again */
export const CreatedApiTokenSchema = ApiTokenSchema.extend({ token: z.string().regex(/^ot_/) })
export type CreatedApiToken = z.infer<typeof CreatedApiTokenSchema>
