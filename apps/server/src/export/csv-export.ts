/**
 * Todoist-compatible CSV export (phase 9 Task P, spec §2.6).
 *
 * One CSV per non-archived project, using the exact per-project column header Todoist's backup ZIP
 * uses (and that the Task-E importer round-trips): sections become `section` rows, tasks depth-first
 * with `INDENT` = depth + 1 and labels appended to `CONTENT` as ` @name`, priority inverted to
 * Todoist's `5 - ours`, and comments as trailing `note` rows. `buildCsvFiles` returns the per-project
 * files; `zipCsvFiles` packs them into the download the route serves. Active tasks only
 * (non-deleted, non-completed) — the canonical/completed record lives in the JSON export.
 */
import archiver from 'archiver'
import { and, eq, isNull } from 'drizzle-orm'
import type { Db } from '../db/db'
import { comments, labels, projects, sections, taskLabels, tasks } from '../db/schema'
import type { ExportDeps } from './json-export'

/** Todoist per-project CSV header — MUST match the Task-E importer's expected columns verbatim. */
export const TODOIST_CSV_HEADER =
  'TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT,DEADLINE,DEADLINE_LANG'

const COLUMN_COUNT = 14

export interface CsvComment {
  content: string
  createdAt: string
}
export interface CsvTask {
  id: string
  parentId: string | null
  sectionId: string | null
  childOrder: number
  content: string
  description: string
  /** OpenTask convention (1 = highest); emitted as `5 - priority` */
  priority: number
  dueString: string | null
  dueDate: string | null
  durationMin: number | null
  deadlineDate: string | null
  labels: string[]
  comments: CsvComment[]
}
export interface CsvSection {
  id: string
  name: string
  sectionOrder: number
}
export interface RenderProjectInput {
  sections: CsvSection[]
  tasks: CsvTask[]
}

/** RFC-4180 field quoting: wrap in double quotes (doubling any interior quote) when required. */
export function escapeCsvField(value: string): string {
  return /["\r\n,]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** Join a row's fields, padding to the full column count so every row has all 14 columns. */
function csvRow(fields: string[]): string {
  const padded =
    fields.length >= COLUMN_COUNT
      ? fields.slice(0, COLUMN_COUNT)
      : [...fields, ...Array<string>(COLUMN_COUNT - fields.length).fill('')]
  return padded.map(escapeCsvField).join(',')
}

const byOrder = (a: { childOrder: number; id: string }, b: { childOrder: number; id: string }) =>
  a.childOrder - b.childOrder || a.id.localeCompare(b.id)
const bySectionOrder = (
  a: { sectionOrder: number; id: string },
  b: { sectionOrder: number; id: string },
) => a.sectionOrder - b.sectionOrder || a.id.localeCompare(b.id)

function sectionRow(name: string): string {
  return csvRow(['section', name])
}

function noteRow(comment: CsvComment): string {
  // DATE column carries the comment's ISO instant (Todoist `note` rows store the post time there).
  return csvRow(['note', comment.content, '', '', '', '', '', comment.createdAt])
}

function taskRow(task: CsvTask, depth: number): string {
  const content =
    task.labels.length === 0
      ? task.content
      : `${task.content}${task.labels.map((l) => ` @${l}`).join('')}`
  const date = task.dueString ?? task.dueDate ?? ''
  const duration = task.durationMin === null ? '' : String(task.durationMin)
  const deadline = task.deadlineDate ?? ''
  return csvRow([
    'task',
    content,
    task.description,
    String(5 - task.priority), // OpenTask 1=highest → Todoist 4=urgent
    String(depth + 1), // INDENT is 1-based
    '', // AUTHOR — single-user export, left blank
    '', // RESPONSIBLE — no assignees
    date,
    date === '' ? '' : 'en', // DATE_LANG
    '', // TIMEZONE — dues are floating wall-clock
    duration,
    duration === '' ? '' : 'minute', // DURATION_UNIT
    deadline,
    deadline === '' ? '' : 'en', // DEADLINE_LANG
  ])
}

/** Render one project's tasks + sections to a Todoist-compatible CSV string. */
export function renderProjectCsv(input: RenderProjectInput): string {
  const taskById = new Map(input.tasks.map((t) => [t.id, t]))
  const childrenByParent = new Map<string, CsvTask[]>()
  const roots: CsvTask[] = []
  for (const t of input.tasks) {
    // A task is a root when it has no parent, or its parent is not in this project's set.
    if (t.parentId === null || !taskById.has(t.parentId)) {
      roots.push(t)
      continue
    }
    const siblings = childrenByParent.get(t.parentId)
    if (siblings === undefined) childrenByParent.set(t.parentId, [t])
    else siblings.push(t)
  }

  const sectionIds = new Set(input.sections.map((s) => s.id))
  const groupOf = (t: CsvTask) =>
    t.sectionId !== null && sectionIds.has(t.sectionId) ? t.sectionId : null
  const rootsBySection = new Map<string | null, CsvTask[]>()
  for (const r of roots) {
    const key = groupOf(r)
    const list = rootsBySection.get(key)
    if (list === undefined) rootsBySection.set(key, [r])
    else list.push(r)
  }

  const lines: string[] = [TODOIST_CSV_HEADER]
  let emittedGroup = false

  const emitTask = (task: CsvTask, depth: number): void => {
    lines.push(taskRow(task, depth))
    for (const comment of task.comments) lines.push(noteRow(comment))
    for (const child of (childrenByParent.get(task.id) ?? []).sort(byOrder)) {
      emitTask(child, depth + 1)
    }
  }

  // Section-less tasks come first (as in Todoist exports), with no section header.
  const nullRoots = (rootsBySection.get(null) ?? []).sort(byOrder)
  for (const r of nullRoots) emitTask(r, 0)
  if (nullRoots.length > 0) emittedGroup = true

  // Then each section as a `section` row, blank-separated from the previous group.
  for (const section of [...input.sections].sort(bySectionOrder)) {
    if (emittedGroup) lines.push(csvRow([]))
    lines.push(sectionRow(section.name))
    for (const r of (rootsBySection.get(section.id) ?? []).sort(byOrder)) emitTask(r, 0)
    emittedGroup = true
  }

  return `${lines.join('\n')}\n`
}

/** taskId → ordered label names, for every live task of the user (single junction query). */
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

/** taskId → ordered comments, for every live comment of the user (single query). */
function loadCommentsByTask(db: Db, userId: string): Map<string, CsvComment[]> {
  const rows = db
    .select({ taskId: comments.taskId, content: comments.content, createdAt: comments.createdAt })
    .from(comments)
    .where(and(eq(comments.userId, userId), isNull(comments.deletedAt)))
    .orderBy(comments.createdAt, comments.id)
    .all()
  const byTask = new Map<string, CsvComment[]>()
  for (const r of rows) {
    const entry = { content: r.content, createdAt: r.createdAt }
    const list = byTask.get(r.taskId)
    if (list === undefined) byTask.set(r.taskId, [entry])
    else list.push(entry)
  }
  return byTask
}

/** Reduce a project name to a safe zip-entry basename (path separators only; spaces/hyphens kept). */
function safeBaseName(name: string): string {
  const cleaned = name.replace(/[/\\]/g, ' ').trim()
  return cleaned === '' ? 'project' : cleaned
}

/** De-duplicate identical base names by appending ` (2)`, ` (3)`, … before the `.csv` extension. */
function uniqueName(base: string, used: Map<string, number>): string {
  const seen = used.get(base) ?? 0
  used.set(base, seen + 1)
  return seen === 0 ? `${base}.csv` : `${base} (${seen + 1}).csv`
}

/** Build one `{ name, content }` CSV per non-archived project (active tasks only). */
export function buildCsvFiles(deps: ExportDeps): { name: string; content: string }[] {
  const { db, userId } = deps

  const projectRows = db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(
      and(eq(projects.userId, userId), isNull(projects.deletedAt), eq(projects.isArchived, false)),
    )
    .orderBy(projects.childOrder, projects.id)
    .all()

  const sectionRows = db
    .select({
      id: sections.id,
      projectId: sections.projectId,
      name: sections.name,
      sectionOrder: sections.sectionOrder,
    })
    .from(sections)
    .where(
      and(eq(sections.userId, userId), isNull(sections.deletedAt), eq(sections.isArchived, false)),
    )
    .orderBy(sections.sectionOrder, sections.id)
    .all()

  const taskRows = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.userId, userId), isNull(tasks.deletedAt), isNull(tasks.completedAt)))
    .orderBy(tasks.childOrder, tasks.id)
    .all()

  const labelsByTask = loadLabelsByTask(db, userId)
  const commentsByTask = loadCommentsByTask(db, userId)

  const sectionsByProject = new Map<string, CsvSection[]>()
  for (const s of sectionRows) {
    const entry = { id: s.id, name: s.name, sectionOrder: s.sectionOrder }
    const list = sectionsByProject.get(s.projectId)
    if (list === undefined) sectionsByProject.set(s.projectId, [entry])
    else list.push(entry)
  }

  const tasksByProject = new Map<string, CsvTask[]>()
  for (const t of taskRows) {
    const entry: CsvTask = {
      id: t.id,
      parentId: t.parentId,
      sectionId: t.sectionId,
      childOrder: t.childOrder,
      content: t.content,
      description: t.description,
      priority: t.priority,
      dueString: t.dueString,
      dueDate: t.dueDate,
      durationMin: t.durationMin,
      deadlineDate: t.deadlineDate,
      labels: labelsByTask.get(t.id) ?? [],
      comments: commentsByTask.get(t.id) ?? [],
    }
    const list = tasksByProject.get(t.projectId)
    if (list === undefined) tasksByProject.set(t.projectId, [entry])
    else list.push(entry)
  }

  const used = new Map<string, number>()
  return projectRows.map((p) => ({
    name: uniqueName(safeBaseName(p.name), used),
    content: renderProjectCsv({
      sections: sectionsByProject.get(p.id) ?? [],
      tasks: tasksByProject.get(p.id) ?? [],
    }),
  }))
}

/** Pack the per-project CSV files into an in-memory zip buffer (data-only; small). */
export function zipCsvFiles(files: { name: string; content: string }[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } })
    const chunks: Buffer[] = []
    archive.on('data', (chunk: Buffer) => chunks.push(chunk))
    archive.on('warning', (err) => {
      if ((err as { code?: string }).code !== 'ENOENT') reject(err)
    })
    archive.on('error', reject)
    archive.on('end', () => resolve(Buffer.concat(chunks)))
    for (const f of files) archive.append(f.content, { name: f.name })
    void archive.finalize()
  })
}
