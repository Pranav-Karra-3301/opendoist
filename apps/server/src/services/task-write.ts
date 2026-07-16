import type { RecurrenceSpec } from '@opendoist/core'
import { and, eq, isNull, max, sql } from 'drizzle-orm'
import { type Settings, SettingsSchema } from '../api/schemas'
import type { Db } from '../db/db'
import { labels, projects, taskLabels, tasks, userSettings } from '../db/schema'
import { newId, nowIso } from '../lib/ids'

/** Mirrors CreateTaskSchema, camelCase, plus resolved due fields. */
export interface CreateTaskInput {
  content: string
  description: string
  projectId: string | null
  sectionId: string | null
  parentId: string | null
  childOrder: number | null
  priority: 1 | 2 | 3 | 4
  dueDate: string | null
  dueTime: string | null
  dueString: string | null
  recurrence: RecurrenceSpec | null
  deadlineDate: string | null
  durationMin: number | null
  labels: string[]
  /** null = not explicitly set → derived from a leading `* ` in content */
  uncompletable: boolean | null
}

export function inboxProjectId(db: Db, userId: string): string {
  const row = db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.isInbox, true)))
    .get()
  if (row === undefined) throw new Error(`no inbox project for user ${userId}`)
  return row.id
}

/** Case-insensitive match against non-deleted labels; auto-creates missing ones (item_order append). */
export function resolveLabelIds(db: Db, userId: string, names: string[]): string[] {
  const ids: string[] = []
  for (const name of names) {
    const existing = db
      .select({ id: labels.id })
      .from(labels)
      .where(
        and(
          eq(labels.userId, userId),
          isNull(labels.deletedAt),
          sql`lower(${labels.name}) = lower(${name})`,
        ),
      )
      .get()
    if (existing !== undefined) {
      if (!ids.includes(existing.id)) ids.push(existing.id)
      continue
    }
    const maxOrder = db
      .select({ m: max(labels.itemOrder) })
      .from(labels)
      .where(and(eq(labels.userId, userId), isNull(labels.deletedAt)))
      .get()
    const now = nowIso()
    const id = newId()
    db.insert(labels)
      .values({
        id,
        userId,
        name,
        itemOrder: (maxOrder?.m ?? -1) + 1,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    ids.push(id)
  }
  return ids
}

/**
 * Inserts a task + its task_labels rows and returns the inserted row.
 * Defaults: projectId → inbox, childOrder → max(sibling) + 1, uncompletable from a
 * leading `* ` when not explicit. Does NOT log activity or publish events (callers do).
 */
export function createTask(
  db: Db,
  userId: string,
  input: CreateTaskInput,
): typeof tasks.$inferSelect {
  const projectId = input.projectId ?? inboxProjectId(db, userId)
  let childOrder = input.childOrder
  if (childOrder === null) {
    const maxOrder = db
      .select({ m: max(tasks.childOrder) })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          eq(tasks.projectId, projectId),
          input.parentId === null ? isNull(tasks.parentId) : eq(tasks.parentId, input.parentId),
          isNull(tasks.deletedAt),
        ),
      )
      .get()
    childOrder = (maxOrder?.m ?? -1) + 1
  }
  const now = nowIso()
  const id = newId()
  const row = db
    .insert(tasks)
    .values({
      id,
      userId,
      projectId,
      sectionId: input.sectionId,
      parentId: input.parentId,
      childOrder,
      content: input.content,
      description: input.description,
      priority: input.priority,
      dueDate: input.dueDate,
      dueTime: input.dueTime,
      dueString: input.dueString,
      recurrence: input.recurrence === null ? null : JSON.stringify(input.recurrence),
      deadlineDate: input.deadlineDate,
      durationMin: input.durationMin,
      uncompletable: input.uncompletable ?? input.content.startsWith('* '),
      completedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()
  for (const labelId of resolveLabelIds(db, userId, input.labels)) {
    db.insert(taskLabels).values({ taskId: id, labelId }).onConflictDoNothing().run()
  }
  return row
}

/** Parse the stored user_settings document through SettingsSchema (defaults applied). */
export function getSettings(db: Db, userId: string): Settings {
  const row = db
    .select({ settings: userSettings.settings })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .get()
  if (row === undefined) return SettingsSchema.parse({})
  return SettingsSchema.parse(JSON.parse(row.settings))
}
