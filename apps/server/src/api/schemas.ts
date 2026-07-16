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
export const ActivityDtoSchema = z.object({
  id: IdSchema,
  event_type: z.string(),
  entity_type: z.string(),
  entity_id: IdSchema,
  project_id: IdSchema.nullable(),
  payload: z.unknown().nullable(),
  at: z.string(),
})
/** CANONICAL user-settings wire document for GET/PATCH /api/v1/user/settings.
 *  DELIBERATE exception to the snake_case rule: this is a client-owned preferences document
 *  persisted verbatim in user_settings.settings, so keys are camelCase — phase 4 parses it as-is,
 *  phase 5 re-homes this EXACT schema in @opendoist/core as UserSettingsSchema, and phase 6 reuses
 *  autoReminderMinutes. Decisions frozen here: 8 themes + separate autoDark (NO 'system' theme value
 *  — spec §2.5), timeFormat default '12h', dateFormat 'MDY' | 'DMY' default 'MDY'.
 *  Later phases may not re-key, re-default, or re-declare any field. */
export const ViewPrefsSchema = z.object({
  groupBy: z.enum(['none', 'project', 'priority', 'label', 'date']).default('none'),
  sortBy: z.enum(['manual', 'date', 'added', 'priority', 'alphabetical']).default('manual'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  filterBy: z
    .object({
      priority: z.number().int().min(1).max(4).nullable().default(null),
      label: z.string().nullable().default(null),
      due: z.enum(['has-date', 'no-date', 'overdue']).nullable().default(null),
    })
    .default({ priority: null, label: null, due: null }),
  showCompleted: z.boolean().default(false),
})
export const QUICK_ADD_CHIP_IDS = [
  'date',
  'deadline',
  'priority',
  'reminders',
  'labels',
  'duration',
  'description',
] as const
export const SettingsSchema = z.object({
  homeView: z.string().default('today'),
  timezone: z.string().default('UTC'),
  dateFormat: z.enum(['MDY', 'DMY']).default('MDY'),
  timeFormat: z.enum(['12h', '24h']).default('12h'),
  weekStart: z.number().int().min(1).max(7).default(1),
  nextWeekDay: z.number().int().min(1).max(7).default(1),
  weekendDay: z.number().int().min(1).max(7).default(6),
  smartDate: z.boolean().default(true),
  theme: z
    .enum([
      'kale',
      'todoist',
      'dark',
      'moonstone',
      'tangerine',
      'blueberry',
      'lavender',
      'raspberry',
    ])
    .default('kale'),
  autoDark: z.boolean().default(true),
  dailyGoal: z.number().int().min(0).max(100).default(5),
  weeklyGoal: z.number().int().min(0).max(700).default(25),
  daysOff: z.array(z.number().int().min(1).max(7)).default([6, 7]),
  vacationMode: z.boolean().default(false),
  karmaEnabled: z.boolean().default(true),
  /** minutes before a timed due for the automatic reminder; 0 = at due time; null = off (phase 6 consumes) */
  autoReminderMinutes: z.number().int().min(0).max(10080).nullable().default(30),
  notifications: z
    .object({
      push: z.boolean().default(true),
      ntfy: z.boolean().default(false),
      gotify: z.boolean().default(false),
      webhook: z.boolean().default(false),
    })
    .default({ push: true, ntfy: false, gotify: false, webhook: false }),
  sidebar: z
    .object({
      showInbox: z.boolean().default(true),
      showToday: z.boolean().default(true),
      showUpcoming: z.boolean().default(true),
      showFiltersLabels: z.boolean().default(true),
      showReporting: z.boolean().default(true),
      showCounts: z.boolean().default(true),
    })
    .default({
      showInbox: true,
      showToday: true,
      showUpcoming: true,
      showFiltersLabels: true,
      showReporting: true,
      showCounts: true,
    }),
  quickAdd: z
    .object({
      chips: z
        .array(z.object({ id: z.enum(QUICK_ADD_CHIP_IDS), visible: z.boolean() }))
        .default(QUICK_ADD_CHIP_IDS.map((id) => ({ id, visible: true }))),
      labeled: z.boolean().default(true),
    })
    .default({ chips: QUICK_ADD_CHIP_IDS.map((id) => ({ id, visible: true })), labeled: true }),
  /** keyed by view key ('today', 'project:<id>', …); PATCH semantics: per-key replace */
  viewPrefs: z.record(z.string(), ViewPrefsSchema).default({}),
})
export type Settings = z.infer<typeof SettingsSchema>
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
