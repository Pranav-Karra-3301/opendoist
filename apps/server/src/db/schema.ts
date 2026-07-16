import { sql } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
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
