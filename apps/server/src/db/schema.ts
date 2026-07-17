import { sql } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { user } from './auth-schema'

const nowIso = () => new Date().toISOString()

/** Timestamps are ISO-8601 UTC text; app code sets them explicitly, the default is a safety net. */
const timestamps = {
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
  updatedAt: text('updated_at').notNull().$defaultFn(nowIso),
}

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    color: text('color').notNull().default('charcoal'),
    parentId: text('parent_id').references((): AnySQLiteColumn => projects.id),
    childOrder: integer('child_order').notNull().default(0),
    isFavorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
    isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
    isCollapsed: integer('is_collapsed', { mode: 'boolean' }).notNull().default(false),
    isInbox: integer('is_inbox', { mode: 'boolean' }).notNull().default(false),
    /** JSON ViewPrefs blob */
    viewPrefs: text('view_prefs'),
    deletedAt: text('deleted_at'),
    ...timestamps,
  },
  (t) => [index('projects_user_id_idx').on(t.userId)],
)

export const sections = sqliteTable(
  'sections',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    sectionOrder: integer('section_order').notNull().default(0),
    isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
    isCollapsed: integer('is_collapsed', { mode: 'boolean' }).notNull().default(false),
    deletedAt: text('deleted_at'),
    ...timestamps,
  },
  (t) => [index('sections_project_id_idx').on(t.projectId)],
)

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    sectionId: text('section_id').references(() => sections.id),
    parentId: text('parent_id').references((): AnySQLiteColumn => tasks.id),
    childOrder: integer('child_order').notNull().default(0),
    content: text('content').notNull(),
    description: text('description').notNull().default(''),
    priority: integer('priority').notNull().default(4),
    dueDate: text('due_date'),
    dueTime: text('due_time'),
    dueString: text('due_string'),
    /** JSON RecurrenceSpec */
    recurrence: text('recurrence'),
    deadlineDate: text('deadline_date'),
    durationMin: integer('duration_min'),
    dayOrder: integer('day_order').notNull().default(0),
    isCollapsed: integer('is_collapsed', { mode: 'boolean' }).notNull().default(false),
    uncompletable: integer('uncompletable', { mode: 'boolean' }).notNull().default(false),
    completedAt: text('completed_at'),
    deletedAt: text('deleted_at'),
    ...timestamps,
  },
  (t) => [
    index('tasks_project_id_idx').on(t.projectId),
    index('tasks_section_id_idx').on(t.sectionId),
    index('tasks_parent_id_idx').on(t.parentId),
    index('tasks_due_date_idx').on(t.dueDate),
    index('tasks_completed_at_idx').on(t.completedAt),
  ],
)

export const labels = sqliteTable(
  'labels',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    name: text('name').notNull(),
    color: text('color').notNull().default('charcoal'),
    itemOrder: integer('item_order').notNull().default(0),
    isFavorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
    deletedAt: text('deleted_at'),
    ...timestamps,
  },
  // partial: soft-deleted labels release their name for re-creation
  (t) => [
    uniqueIndex('labels_user_id_name_unique').on(t.userId, t.name).where(sql`deleted_at IS NULL`),
  ],
)

export const taskLabels = sqliteTable(
  'task_labels',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.labelId] })],
)

export const filters = sqliteTable('filters', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id),
  name: text('name').notNull(),
  query: text('query').notNull(),
  color: text('color').notNull().default('charcoal'),
  itemOrder: integer('item_order').notNull().default(0),
  isFavorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
  deletedAt: text('deleted_at'),
  ...timestamps,
})

export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id),
  fileName: text('file_name').notNull(),
  fileSize: integer('file_size').notNull(),
  fileType: text('file_type').notNull(),
  /** relative to `<dataDir>/attachments` */
  filePath: text('file_path').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
})

export const comments = sqliteTable(
  'comments',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    content: text('content').notNull(),
    attachmentId: text('attachment_id').references(() => attachments.id),
    deletedAt: text('deleted_at'),
    ...timestamps,
  },
  (t) => [index('comments_task_id_idx').on(t.taskId)],
)

export const activityLog = sqliteTable(
  'activity_log',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    eventType: text('event_type').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    projectId: text('project_id'),
    /** JSON blob */
    payload: text('payload'),
    at: text('at').notNull(),
  },
  (t) => [
    index('activity_log_at_idx').on(t.at),
    index('activity_log_entity_idx').on(t.entityType, t.entityId),
  ],
)

export const dayStats = sqliteTable(
  'day_stats',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    date: text('date').notNull(),
    completedCount: integer('completed_count').notNull().default(0),
    goalMet: integer('goal_met', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.date] })],
)

export const userSettings = sqliteTable('user_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id),
  /** JSON, validated by SettingsSchema */
  settings: text('settings').notNull(),
  updatedAt: text('updated_at').notNull(),
})

/* ---------- phase 6: reminders (frozen contract — plan Task A Step 2) ---------- */

export const reminders = sqliteTable(
  'reminders',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    /** 'relative' | 'absolute' | 'recurring' */
    type: text('type', { enum: ['relative', 'absolute', 'recurring'] }).notNull(),
    /** relative only: minutes before due time (0 = at time) */
    minuteOffset: integer('minute_offset'),
    /** absolute/recurring: JSON of core Due ({date, time, string, recurrence}) */
    dueJson: text('due_json'),
    isAuto: integer('is_auto', { mode: 'boolean' }).notNull().default(false),
    /** next fire instant, ISO UTC (ms precision, `new Date(x).toISOString()`); null = currently unfireable */
    fireAtUtc: text('fire_at_utc'),
    /** set when dispatched (or suppressed); null = pending */
    firedAt: text('fired_at'),
    ...timestamps,
  },
  (t) => [
    index('idx_reminders_pending').on(t.firedAt, t.fireAtUtc),
    index('idx_reminders_task').on(t.taskId),
  ],
)

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
  lastUsedAt: text('last_used_at'),
})

export const notificationChannels = sqliteTable('notification_channels', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id),
  type: text('type', { enum: ['ntfy', 'gotify', 'webhook'] }).notNull(),
  name: text('name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  /** zod-validated per type at the API boundary; stored as JSON text */
  configJson: text('config_json').notNull(),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  disabledReason: text('disabled_reason'),
  ...timestamps,
})

export const icalTokens = sqliteTable('ical_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => user.id),
  token: text('token').notNull().unique(),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
  lastAccessedAt: text('last_accessed_at'),
})

/* ---------- phase 7: ramble voice capture (frozen contract — plan Task A Step 1) ---------- */

export const rambleStatuses = [
  'uploaded',
  'transcribed',
  'extracted',
  'confirmed',
  'failed',
] as const
export const rambleFailedStages = ['transcribe', 'extract'] as const

export const rambles = sqliteTable(
  'rambles',
  {
    id: text('id').primaryKey(), // nanoid via lib/ids newId()
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: text('status', { enum: rambleStatuses }).notNull().default('uploaded'),
    /** relative to DATA_DIR, e.g. 'rambles/<id>.webm'; null after confirm/discard deletes the file */
    audioPath: text('audio_path'),
    audioMime: text('audio_mime').notNull(),
    audioBytes: integer('audio_bytes').notNull(),
    durationSec: real('duration_sec'),
    transcript: text('transcript'),
    /** JSON string: ExtractedTask[] (rambles/schemas.ts) */
    extractedJson: text('extracted_json'),
    error: text('error'),
    failedStage: text('failed_stage', { enum: rambleFailedStages }),
    ...timestamps,
  },
  (t) => [index('rambles_user_id_idx').on(t.userId)],
)

export const providerSettings = sqliteTable('provider_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  sttProvider: text('stt_provider', { enum: ['openai-compatible', 'deepgram', 'elevenlabs'] }),
  sttBaseUrl: text('stt_base_url'),
  sttModel: text('stt_model'),
  /** secret-crypto envelope (lib/secret-crypto.ts), never plaintext */
  sttApiKeyEnc: text('stt_api_key_enc'),
  llmProvider: text('llm_provider', { enum: ['openai-compatible'] }),
  llmBaseUrl: text('llm_base_url'),
  llmModel: text('llm_model'),
  llmApiKeyEnc: text('llm_api_key_enc'),
  updatedAt: text('updated_at').notNull().$defaultFn(nowIso),
})
