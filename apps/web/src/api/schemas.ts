/**
 * FROZEN wire contract for the phase-3 as-built server (Task A reconciled against the
 * live /api/v1/openapi.json on 2026-07-16). Response DTOs are snake_case; zod strips
 * extra response fields the client doesn't consume (created_at/updated_at on
 * project/section/label/comment, view_prefs, due.is_recurring). Parallel tasks import
 * from here and never redeclare shapes.
 */
import { type Due, DueSchema, type Priority, PrioritySchema } from '@opentask/core'
import { z } from 'zod'

export const TaskSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  section_id: z.string().nullable(),
  parent_id: z.string().nullable(),
  child_order: z.number().int(),
  day_order: z.number().int(),
  content: z.string(),
  description: z.string(),
  priority: PrioritySchema,
  due: DueSchema.nullable(),
  deadline_date: z.string().nullable(),
  /** HH:mm wall-clock deadline time, null = date-only. Additive sibling of deadline_date
   *  (quick-add UX pass); optional so pre-field fixtures/responses parse unchanged. */
  deadline_time: z.string().nullable().optional(),
  duration_min: z.number().int().nullable(),
  labels: z.array(z.string()),
  is_collapsed: z.boolean(),
  uncompletable: z.boolean(),
  completed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type Task = z.infer<typeof TaskSchema>

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  color: z.string(),
  parent_id: z.string().nullable(),
  child_order: z.number().int(),
  is_favorite: z.boolean(),
  is_archived: z.boolean(),
  is_collapsed: z.boolean(),
  is_inbox: z.boolean(),
})
export type Project = z.infer<typeof ProjectSchema>

export const SectionSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string(),
  section_order: z.number().int(),
  is_archived: z.boolean(),
  is_collapsed: z.boolean(),
})
export type Section = z.infer<typeof SectionSchema>

export const LabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  item_order: z.number().int(),
  is_favorite: z.boolean(),
})
export type Label = z.infer<typeof LabelSchema>

export const CommentSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  content: z.string(),
  attachment: z.unknown().nullable(),
  created_at: z.string(),
})
export type Comment = z.infer<typeof CommentSchema>

/** Canonical camelCase user-settings document served by GET /user/settings (phase 3 Task A
 *  Step 10 `SettingsSchema` — the one deliberate non-snake_case wire shape). Parse the subset
 *  this phase consumes; `.partial().passthrough()` tolerates the full document. */
export const UserSettingsSchema = z
  .object({
    timezone: z.string(),
    weekStart: z.number().int(),
    nextWeekDay: z.number().int(),
    weekendDay: z.number().int(),
    smartDate: z.boolean(),
    timeFormat: z.enum(['12h', '24h']),
    dateFormat: z.enum(['MDY', 'DMY']),
    homeView: z.string(),
  })
  .partial()
  .passthrough()
export type UserSettings = z.infer<typeof UserSettingsSchema>

/** GET /user returns NO settings field — settings live at GET /user/settings. */
export const UserSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    two_factor_enabled: z.boolean().optional(),
    created_at: z.string().optional(),
  })
  .passthrough()
export type User = z.infer<typeof UserSchema>

/** Exact shape of phase 3's InfoDto (GET /api/v1/info). */
export const InfoSchema = z
  .object({
    version: z.string(),
    first_run: z.boolean(),
    registration_open: z.boolean(),
    auth_providers: z.object({
      password: z.boolean(),
      oidc: z.object({ name: z.string() }).nullable(),
    }),
    features: z
      .object({ stt: z.boolean(), llm: z.boolean(), push: z.boolean() })
      .partial()
      .passthrough(),
    available_importers: z.array(z.string()).default([]),
  })
  .passthrough() // passthrough: phase 9 adds `update`
export type Info = z.infer<typeof InfoSchema>

export const SseEventSchema = z.object({
  type: z.string(),
  /** MUST mirror the server's ServerEvent entity union (apps/server/src/events/bus.ts) — events
   *  whose entity is outside this enum fail safeParse and are silently dropped. Phase 6 widened
   *  BOTH lists with 'reminders' | 'push_subscriptions' | 'notification_channels'. */
  entity: z.enum([
    'task',
    'project',
    'section',
    'label',
    'filter',
    'comment',
    'settings',
    'reminders',
    'push_subscriptions',
    'notification_channels',
  ]),
  ids: z.array(z.string()),
})
export type SseEvent = z.infer<typeof SseEventSchema>

export function paginated<T extends z.ZodType>(item: T) {
  return z.object({ results: z.array(item), next_cursor: z.string().nullable() })
}

export interface TaskCreate {
  content: string
  description?: string
  project_id?: string
  section_id?: string | null
  parent_id?: string | null
  priority?: Priority
  due?: Due | null
  deadline_date?: string | null
  deadline_time?: string | null
  duration_min?: number | null
  labels?: string[]
  uncompletable?: boolean
}
export type TaskPatch = Partial<TaskCreate> & {
  day_order?: number
  child_order?: number
  is_collapsed?: boolean
}
export interface TaskMove {
  project_id?: string
  section_id?: string | null
  parent_id?: string | null
  /** AS-BUILT: POST /tasks/{id}/move honors an explicit child_order (undo restores the
   *  captured pre-move position); omitted, moved tasks append at the end of the target
   *  container. Batch reordering still goes through POST /tasks/reorder. */
  child_order?: number
}

/* ---------- AS-BUILT wire serialization (Task A Step 2 findings) ---------- */

/** What POST/PATCH /tasks actually accepts for `due` (server `DueInputSchema`):
 *  `{ string }` → server re-parses the phrase authoritatively (recurrence included);
 *  `{ date, time? }` → exact values, recurrence CLEARED; `{ string, date, time? }` →
 *  exact values with the phrase stored verbatim (recurrence re-parsed from the string),
 *  the shape undo uses for exact restores; `null` → clears the due. The full core `Due`
 *  object is NOT accepted — `time: null` fails validation and `recurrence` is stripped. */
export type DueInput = { string?: string; date?: string; time?: string } | null

/**
 * Serialize a client-side `Due` (or an already-wire-shaped input) for the server: when a
 * date is known it travels alongside the natural-language `string` so the stored due is
 * deterministic (what the user previewed is what is stored) AND the phrase round-trips
 * verbatim — a restore of `{string, date, time?}` is exact, recurrence included. Without
 * a date the phrase alone is sent for the server to resolve authoritatively.
 */
export function toDueInput(due: Due | DueInput | undefined): DueInput | undefined {
  if (due === undefined) return undefined
  if (due === null) return null
  const d = due as Partial<Due>
  const str = typeof d.string === 'string' ? d.string.trim() : ''
  const hasDate = typeof d.date === 'string' && d.date !== ''
  if (!hasDate) return str === '' ? null : { string: str }
  const wire: NonNullable<DueInput> = { date: d.date as string }
  if (typeof d.time === 'string') wire.time = d.time
  if (str !== '') wire.string = str
  return wire
}

/** AS-BUILT: the move body must carry ≥1 of project_id/section_id/parent_id; an explicit
 *  child_order pins the position among the destination siblings (omitted = append). */
export function toMoveBody(to: TaskMove): {
  project_id?: string
  section_id?: string | null
  parent_id?: string | null
  child_order?: number
} {
  const body: {
    project_id?: string
    section_id?: string | null
    parent_id?: string | null
    child_order?: number
  } = {}
  if (to.project_id !== undefined) body.project_id = to.project_id
  if (to.section_id !== undefined) body.section_id = to.section_id
  if (to.parent_id !== undefined) body.parent_id = to.parent_id
  if (to.child_order !== undefined) body.child_order = to.child_order
  return body
}
