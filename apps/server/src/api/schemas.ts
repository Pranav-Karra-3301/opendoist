import { z } from '@hono/zod-openapi'

export const PALETTE = [
  'berry_red',
  'red',
  'orange',
  'yellow',
  'olive_green',
  'lime_green',
  'green',
  'mint_green',
  'teal',
  'sky_blue',
  'light_blue',
  'blue',
  'grape',
  'violet',
  'lavender',
  'magenta',
  'salmon',
  'charcoal',
  'grey',
  'taupe',
] as const
export const ColorSchema = z.enum(PALETTE)
export const IdSchema = z.string().min(1)
export const DueDtoSchema = z.object({
  date: z.string(),
  time: z.string().nullable(),
  string: z.string(),
  is_recurring: z.boolean(),
  recurrence: z.unknown().nullable(),
})
export const TaskDtoSchema = z.object({
  id: IdSchema,
  project_id: IdSchema,
  section_id: IdSchema.nullable(),
  parent_id: IdSchema.nullable(),
  child_order: z.number().int(),
  content: z.string(),
  description: z.string(),
  priority: z.number().int().min(1).max(4),
  due: DueDtoSchema.nullable(),
  deadline_date: z.string().nullable(),
  duration_min: z.number().int().nullable(),
  day_order: z.number().int(),
  labels: z.array(z.string()),
  is_collapsed: z.boolean(),
  uncompletable: z.boolean(),
  completed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})
export const ProjectDtoSchema = z.object({
  id: IdSchema,
  name: z.string(),
  description: z.string(),
  color: ColorSchema,
  parent_id: IdSchema.nullable(),
  child_order: z.number().int(),
  is_favorite: z.boolean(),
  is_archived: z.boolean(),
  is_collapsed: z.boolean(),
  is_inbox: z.boolean(),
  view_prefs: z.unknown().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})
export const SectionDtoSchema = z.object({
  id: IdSchema,
  project_id: IdSchema,
  name: z.string(),
  section_order: z.number().int(),
  is_archived: z.boolean(),
  is_collapsed: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
})
export const LabelDtoSchema = z.object({
  id: IdSchema,
  name: z.string(),
  color: ColorSchema,
  item_order: z.number().int(),
  is_favorite: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
})
export const FilterDtoSchema = z.object({
  id: IdSchema,
  name: z.string(),
  query: z.string(),
  color: ColorSchema,
  item_order: z.number().int(),
  is_favorite: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
})
export const AttachmentDtoSchema = z.object({
  id: IdSchema,
  file_name: z.string(),
  file_size: z.number().int(),
  file_type: z.string(),
  file_url: z.string(),
})
export const CommentDtoSchema = z.object({
  id: IdSchema,
  task_id: IdSchema,
  content: z.string(),
  attachment: AttachmentDtoSchema.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})
/**
 * Read-time-denormalized activity payload (plan phase 5 Task B Step 2). `content` is the entity's
 * primary text looked up at read time, `project_name` is joined from `project_id`, and the
 * event-specific payload phase 3 stored lands under `meta`. Byte-compatible with core's
 * `ActivityEventSchema.payload`, so `ActivityPageSchema` parses the response client-side.
 */
export const ActivityPayloadSchema = z.object({
  content: z.string(),
  project_name: z.string().nullable(),
  meta: z.record(z.string(), z.unknown()),
})
export const ActivityDtoSchema = z.object({
  id: IdSchema,
  event_type: z.string(),
  entity_type: z.string(),
  entity_id: IdSchema,
  project_id: IdSchema.nullable(),
  payload: ActivityPayloadSchema,
  at: z.string(),
})
export type { UserSettings as Settings } from '@opendoist/core'
/** CANONICAL user-settings wire document for GET/PATCH /api/v1/user/settings.
 *  Re-homed in @opendoist/core as `UserSettingsSchema` (plan phase 5 Task A Step 1 / Task B Step 1);
 *  the server imports that single definition so web, server, and core share ONE schema. Byte-compatible
 *  with the phase-3 document — same keys/enums/defaults (8 themes + separate autoDark, timeFormat
 *  default '12h', dateFormat 'MDY' | 'DMY' default 'MDY'). DELIBERATE camelCase exception to the
 *  snake_case wire rule: a client-owned preferences blob persisted verbatim in user_settings.settings.
 *  Later phases may not re-key, re-default, or re-declare any field. */
export { UserSettingsSchema as SettingsSchema } from '@opendoist/core'
export const DueInputSchema = z
  .object({
    string: z.string().optional(),
    date: z.string().optional(),
    time: z.string().optional(),
  })
  .nullable()
export const CreateTaskSchema = z.object({
  content: z.string().min(1),
  description: z.string().default(''),
  project_id: IdSchema.optional(),
  section_id: IdSchema.nullable().optional(),
  parent_id: IdSchema.nullable().optional(),
  child_order: z.number().int().optional(),
  priority: z.number().int().min(1).max(4).default(4),
  due: DueInputSchema.optional(),
  deadline_date: z.string().nullable().optional(),
  duration_min: z.number().int().min(1).max(1440).nullable().optional(),
  labels: z.array(z.string()).default([]),
  uncompletable: z.boolean().optional(),
})
export const UpdateTaskSchema = CreateTaskSchema.partial().extend({
  day_order: z.number().int().optional(),
  is_collapsed: z.boolean().optional(),
})
export const InfoDtoSchema = z.object({
  version: z.string(),
  first_run: z.boolean(),
  registration_open: z.boolean(),
  auth_providers: z.object({
    password: z.boolean(),
    oidc: z.object({ name: z.string() }).nullable(),
  }),
  features: z.object({ stt: z.boolean(), llm: z.boolean(), push: z.boolean() }),
  available_importers: z.array(z.string()),
})
