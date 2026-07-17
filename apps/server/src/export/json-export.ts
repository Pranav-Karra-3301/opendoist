/**
 * Canonical JSON export (phase 9 Task P, spec §2.6).
 *
 * `buildJsonExport` produces one self-contained, restorable document of a user's whole account —
 * projects, sections, labels, filters, tasks (with the core `Due` shape and label NAMES), comments
 * (attachment metadata only, never file bytes), reminders and the user settings blob. Soft-deleted
 * rows are excluded; completed tasks are kept (they are part of the canonical record). The route in
 * `routes.ts` streams `OpendoistExportSchema.parse`-able JSON as a download.
 *
 * AS-BUILT: every row is user-scoped (each table carries `user_id NOT NULL`) and the codebase is
 * deps-injected, so this takes `{ db, userId }` rather than the plan's no-arg signature.
 */
import {
  type Due,
  DueSchema,
  IsoDateSchema,
  type Priority,
  PrioritySchema,
  type RecurrenceSpec,
  RecurrenceSpecSchema,
} from '@opendoist/core'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '../db/db'
import {
  attachments,
  comments,
  filters,
  labels,
  projects,
  reminders,
  sections,
  taskLabels,
  tasks,
} from '../db/schema'
import { nowIso } from '../lib/ids'
import { getSettings } from '../services/task-write'

export interface ExportDeps {
  db: Db
  userId: string
}

/* ---------- wire schema (also the exported document's runtime contract) ---------- */

const ExportProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  color: z.string(),
  parentId: z.string().nullable(),
  childOrder: z.number().int(),
  isFavorite: z.boolean(),
  isArchived: z.boolean(),
  isCollapsed: z.boolean(),
  isInbox: z.boolean(),
  viewPrefs: z.unknown().nullable(),
})
const ExportSectionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  sectionOrder: z.number().int(),
  isArchived: z.boolean(),
  isCollapsed: z.boolean(),
})
const ExportLabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  itemOrder: z.number().int(),
  isFavorite: z.boolean(),
})
const ExportFilterSchema = z.object({
  id: z.string(),
  name: z.string(),
  query: z.string(),
  color: z.string(),
  itemOrder: z.number().int(),
  isFavorite: z.boolean(),
})
const ExportTaskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  sectionId: z.string().nullable(),
  parentId: z.string().nullable(),
  childOrder: z.number().int(),
  content: z.string(),
  description: z.string(),
  priority: PrioritySchema,
  due: DueSchema.nullable(),
  deadline: IsoDateSchema.nullable(),
  durationMin: z.number().int().nullable(),
  labels: z.array(z.string()),
  uncompletable: z.boolean(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
const ExportAttachmentSchema = z.object({
  filename: z.string(),
  size: z.number().int(),
  type: z.string(),
})
const ExportCommentSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  content: z.string(),
  attachment: ExportAttachmentSchema.nullable(),
  createdAt: z.string(),
})
const ExportReminderSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  type: z.enum(['relative', 'absolute', 'recurring']),
  minuteOffset: z.number().int().nullable(),
  due: DueSchema.nullable(),
  isAuto: z.boolean(),
  fireAtUtc: z.string().nullable(),
  firedAt: z.string().nullable(),
})

export const OpendoistExportSchema = z.object({
  format: z.literal('opendoist-export'),
  version: z.literal(1),
  exportedAt: z.string(),
  /** the user's settings document (phase-5 UserSettings shape); passed through untouched */
  settings: z.record(z.string(), z.unknown()),
  projects: z.array(ExportProjectSchema),
  sections: z.array(ExportSectionSchema),
  labels: z.array(ExportLabelSchema),
  filters: z.array(ExportFilterSchema),
  tasks: z.array(ExportTaskSchema),
  comments: z.array(ExportCommentSchema),
  reminders: z.array(ExportReminderSchema),
})
export type OpendoistExport = z.infer<typeof OpendoistExportSchema>

/* ---------- helpers ---------- */

/** DB priority is a plain integer; clamp any legacy out-of-range value to the p4 default. */
function toPriority(n: number): Priority {
  return (n >= 1 && n <= 4 ? n : 4) as Priority
}

/** A malformed/legacy recurrence blob degrades to non-recurring rather than failing the export. */
function parseRecurrence(json: string | null): RecurrenceSpec | null {
  if (json === null) return null
  try {
    const parsed = RecurrenceSpecSchema.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** A stored reminder `due_json` blob → validated core Due (null when absent/malformed). */
function parseDueJson(json: string | null): Due | null {
  if (json === null) return null
  try {
    const parsed = DueSchema.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Discrete task due columns → canonical core Due (null when the task has no due date). */
function taskDue(row: {
  dueDate: string | null
  dueTime: string | null
  dueString: string | null
  recurrence: string | null
}): Due | null {
  if (row.dueDate === null) return null
  return {
    date: row.dueDate,
    time: row.dueTime,
    string: row.dueString ?? row.dueDate,
    recurrence: parseRecurrence(row.recurrence),
  }
}

/** taskId → ordered label NAMES, for every live task of the user (one junction query). */
function loadLabelsByTask(db: Db, userId: string): Map<string, string[]> {
  const rows = db
    .select({ taskId: taskLabels.taskId, name: labels.name })
    .from(taskLabels)
    .innerJoin(labels, eq(taskLabels.labelId, labels.id))
    .where(and(eq(labels.userId, userId), isNull(labels.deletedAt)))
    .orderBy(labels.itemOrder, labels.name)
    .all()
  const byTask = new Map<string, string[]>()
  for (const r of rows) {
    const list = byTask.get(r.taskId)
    if (list === undefined) byTask.set(r.taskId, [r.name])
    else list.push(r.name)
  }
  return byTask
}

/** Build the whole canonical export document for one user. Never throws on odd stored data. */
export function buildJsonExport(deps: ExportDeps, now: string = nowIso()): OpendoistExport {
  const { db, userId } = deps

  const projectRows = db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, userId), isNull(projects.deletedAt)))
    .orderBy(projects.childOrder, projects.id)
    .all()

  const sectionRows = db
    .select()
    .from(sections)
    .where(and(eq(sections.userId, userId), isNull(sections.deletedAt)))
    .orderBy(sections.sectionOrder, sections.id)
    .all()

  const labelRows = db
    .select()
    .from(labels)
    .where(and(eq(labels.userId, userId), isNull(labels.deletedAt)))
    .orderBy(labels.itemOrder, labels.id)
    .all()

  const filterRows = db
    .select()
    .from(filters)
    .where(and(eq(filters.userId, userId), isNull(filters.deletedAt)))
    .orderBy(filters.itemOrder, filters.id)
    .all()

  const taskRows = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.userId, userId), isNull(tasks.deletedAt)))
    .orderBy(tasks.childOrder, tasks.id)
    .all()

  const commentRows = db
    .select({
      id: comments.id,
      taskId: comments.taskId,
      content: comments.content,
      createdAt: comments.createdAt,
      attFile: attachments.fileName,
      attSize: attachments.fileSize,
      attType: attachments.fileType,
    })
    .from(comments)
    .leftJoin(attachments, eq(comments.attachmentId, attachments.id))
    .where(and(eq(comments.userId, userId), isNull(comments.deletedAt)))
    .orderBy(comments.createdAt, comments.id)
    .all()

  const reminderRows = db
    .select()
    .from(reminders)
    .where(eq(reminders.userId, userId))
    .orderBy(reminders.createdAt, reminders.id)
    .all()

  const labelsByTask = loadLabelsByTask(db, userId)

  return {
    format: 'opendoist-export',
    version: 1,
    exportedAt: now,
    settings: getSettings(db, userId) as unknown as Record<string, unknown>,
    projects: projectRows.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      color: p.color,
      parentId: p.parentId,
      childOrder: p.childOrder,
      isFavorite: p.isFavorite,
      isArchived: p.isArchived,
      isCollapsed: p.isCollapsed,
      isInbox: p.isInbox,
      viewPrefs: p.viewPrefs === null ? null : safeJson(p.viewPrefs),
    })),
    sections: sectionRows.map((s) => ({
      id: s.id,
      projectId: s.projectId,
      name: s.name,
      sectionOrder: s.sectionOrder,
      isArchived: s.isArchived,
      isCollapsed: s.isCollapsed,
    })),
    labels: labelRows.map((l) => ({
      id: l.id,
      name: l.name,
      color: l.color,
      itemOrder: l.itemOrder,
      isFavorite: l.isFavorite,
    })),
    filters: filterRows.map((f) => ({
      id: f.id,
      name: f.name,
      query: f.query,
      color: f.color,
      itemOrder: f.itemOrder,
      isFavorite: f.isFavorite,
    })),
    tasks: taskRows.map((t) => ({
      id: t.id,
      projectId: t.projectId,
      sectionId: t.sectionId,
      parentId: t.parentId,
      childOrder: t.childOrder,
      content: t.content,
      description: t.description,
      priority: toPriority(t.priority),
      due: taskDue(t),
      deadline: t.deadlineDate,
      durationMin: t.durationMin,
      labels: labelsByTask.get(t.id) ?? [],
      uncompletable: t.uncompletable,
      completedAt: t.completedAt,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
    comments: commentRows.map((c) => ({
      id: c.id,
      taskId: c.taskId,
      content: c.content,
      attachment:
        c.attFile === null || c.attSize === null || c.attType === null
          ? null
          : { filename: c.attFile, size: c.attSize, type: c.attType },
      createdAt: c.createdAt,
    })),
    reminders: reminderRows.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      type: r.type,
      minuteOffset: r.minuteOffset,
      due: parseDueJson(r.dueJson),
      isAuto: r.isAuto,
      fireAtUtc: r.fireAtUtc,
      firedAt: r.firedAt,
    })),
  }
}

/** Parse a stored JSON blob, degrading to null on malformed text (used for the viewPrefs column). */
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
