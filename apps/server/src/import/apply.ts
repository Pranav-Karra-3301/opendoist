/**
 * Import plan application — phase 9 Task E (frozen signatures, plan Task A Step 5).
 *
 * Both importers (CSV = Task E, live API = Task F) produce ONE normalized ImportPlan; this module
 * writes it in a single better-sqlite3 transaction. `dryRunReport` runs the exact same write path
 * inside a transaction that always rolls back, so its `created` counts are byte-identical to apply
 * while nothing is persisted.
 *
 * AS-BUILT: rows are user-scoped (every table carries user_id NOT NULL) and there is no global
 * db/bus, so both functions take an `ImportApplyDeps` first parameter built by the job runner
 * (Task G) from `c.get('deps')` + the authed user.
 */
import {
  type ParseContext,
  parseRecurrenceText,
  type RecurrenceSpec,
  resolveNaturalDate,
} from '@opendoist/core'
import { and, eq, isNull, max, sql } from 'drizzle-orm'
import { PALETTE } from '../api/schemas'
import type { Db } from '../db/db'
import { comments, labels, projects, sections, taskLabels, tasks } from '../db/schema'
import type { EventBus } from '../events/bus'
import { newId, nowIso } from '../lib/ids'
import { parseContextFor } from '../lib/parse-context'
import { getSettings, inboxProjectId } from '../services/task-write'
import { type ImportCounts, type ImportPlan, type ImportReport, planCounts } from './types'

export interface ImportApplyDeps {
  db: Db
  /** owner of every created row */
  userId: string
  /** ONE `import.completed` event published after a successful apply (entity 'task') */
  bus: EventBus
}

/** The transaction handle drizzle hands to `db.transaction(cb)`. */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type ImportTask = ImportPlan['tasks'][number]
type ImportSkip = ImportPlan['skips'][number]

const PALETTE_SET = new Set<string>(PALETTE)

/** Sentinel used to force a dry-run transaction to roll back after computing its report. */
class DryRunRollback extends Error {}

function zeroCounts(): ImportCounts {
  return { projects: 0, sections: 0, labels: 0, tasks: 0, comments: 0, skips: 0 }
}

/** Validate an imported color against the palette; unknown → charcoal + skip note. */
function mapColor(color: string | null, entity: string, ref: string, skips: ImportSkip[]): string {
  if (color === null) return 'charcoal'
  if (PALETTE_SET.has(color)) return color
  skips.push({ entity, ref, reason: `unknown color '${color}' → charcoal` })
  return 'charcoal'
}

interface ResolvedDue {
  dueDate: string | null
  dueTime: string | null
  dueString: string | null
  recurrence: RecurrenceSpec | null
  dropped: boolean
}

/**
 * Turn an ImportTask's due hints into concrete columns:
 * recurring (`parseRecurrenceText`) → dated (`resolveNaturalDate`) → concrete dueDate fallback →
 * dropped (no due + skip note). Empty due strings with a concrete dueDate stay dated.
 */
function resolveDue(t: ImportTask, ctx: ParseContext): ResolvedDue {
  const raw = t.dueString?.trim() ?? ''
  if (raw !== '') {
    const rec = parseRecurrenceText(raw, ctx)
    if (rec !== null) {
      return {
        dueDate: t.dueDate ?? rec.firstDate,
        dueTime: t.dueTime ?? rec.firstTime,
        dueString: raw,
        recurrence: rec.spec,
        dropped: false,
      }
    }
    const nat = resolveNaturalDate(raw, ctx)
    if (nat !== null) {
      return {
        dueDate: nat.date,
        dueTime: t.dueTime ?? nat.time,
        dueString: raw,
        recurrence: null,
        dropped: false,
      }
    }
    if (t.dueDate !== null) {
      return {
        dueDate: t.dueDate,
        dueTime: t.dueTime,
        dueString: raw,
        recurrence: null,
        dropped: false,
      }
    }
    return { dueDate: null, dueTime: null, dueString: null, recurrence: null, dropped: true }
  }
  if (t.dueDate !== null) {
    return {
      dueDate: t.dueDate,
      dueTime: t.dueTime,
      dueString: t.dueDate,
      recurrence: null,
      dropped: false,
    }
  }
  return { dueDate: null, dueTime: null, dueString: null, recurrence: null, dropped: false }
}

interface WriteResult {
  report: ImportReport
  taskIds: string[]
}

/** Writes the entire plan through `tx`, accumulating the apply report as it goes. */
function writePlan(
  tx: Tx,
  userId: string,
  inboxId: string,
  ctx: ParseContext,
  plan: ImportPlan,
  mode: 'apply' | 'dry-run',
): WriteResult {
  const counts = planCounts(plan)
  const created = zeroCounts()
  const skips: ImportSkip[] = [...plan.skips]
  const taskIds: string[] = []

  // --- projects (isInbox merges into the existing Inbox; never a new row) ---
  const projectIdByKey = new Map<string, string>()
  const maxProjectOrder = tx
    .select({ m: max(projects.childOrder) })
    .from(projects)
    .where(eq(projects.userId, userId))
    .get()
  let projectOrder = (maxProjectOrder?.m ?? -1) + 1
  for (const p of plan.projects) {
    if (p.isInbox) {
      projectIdByKey.set(p.key, inboxId)
      continue
    }
    const id = newId()
    const now = nowIso()
    tx.insert(projects)
      .values({
        id,
        userId,
        name: p.name,
        color: mapColor(p.color, 'project', p.name, skips),
        parentId: null,
        childOrder: projectOrder,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    projectIdByKey.set(p.key, id)
    projectOrder += 1
    created.projects += 1
  }
  for (const p of plan.projects) {
    if (p.isInbox || p.parentKey === null) continue
    const id = projectIdByKey.get(p.key)
    const parentId = projectIdByKey.get(p.parentKey)
    if (id !== undefined && parentId !== undefined) {
      tx.update(projects).set({ parentId }).where(eq(projects.id, id)).run()
    }
  }

  // --- sections ---
  const sectionIdByKey = new Map<string, string>()
  for (const s of plan.sections) {
    const projectId = projectIdByKey.get(s.projectKey)
    if (projectId === undefined) {
      skips.push({ entity: 'section', ref: s.name, reason: 'unknown project' })
      continue
    }
    const id = newId()
    const now = nowIso()
    tx.insert(sections)
      .values({
        id,
        userId,
        projectId,
        name: s.name,
        sectionOrder: s.order,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    sectionIdByKey.set(s.key, id)
    created.sections += 1
  }

  // --- labels (existing non-deleted name, case-insensitive, is reused not created) ---
  const labelIdByName = new Map<string, string>()
  const maxLabelOrder = tx
    .select({ m: max(labels.itemOrder) })
    .from(labels)
    .where(and(eq(labels.userId, userId), isNull(labels.deletedAt)))
    .get()
  let labelOrder = (maxLabelOrder?.m ?? -1) + 1
  for (const l of plan.labels) {
    const existing = tx
      .select({ id: labels.id })
      .from(labels)
      .where(
        and(
          eq(labels.userId, userId),
          isNull(labels.deletedAt),
          sql`lower(${labels.name}) = lower(${l.name})`,
        ),
      )
      .get()
    if (existing !== undefined) {
      labelIdByName.set(l.name.toLowerCase(), existing.id)
      continue
    }
    const id = newId()
    const now = nowIso()
    tx.insert(labels)
      .values({
        id,
        userId,
        name: l.name,
        color: mapColor(l.color, 'label', l.name, skips),
        itemOrder: labelOrder,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    labelIdByName.set(l.name.toLowerCase(), id)
    labelOrder += 1
    created.labels += 1
  }

  // --- tasks (two-pass: insert with parentId null, then remap parents by key) ---
  const taskIdByKey = new Map<string, string>()
  for (const t of plan.tasks) {
    const projectId = projectIdByKey.get(t.projectKey)
    if (projectId === undefined) {
      skips.push({ entity: 'task', ref: t.content, reason: 'unknown project' })
      continue
    }
    const sectionId = t.sectionKey === null ? null : (sectionIdByKey.get(t.sectionKey) ?? null)
    const due = resolveDue(t, ctx)
    if (due.dropped) skips.push({ entity: 'task', ref: t.content, reason: 'due dropped' })

    const id = newId()
    const now = nowIso()
    tx.insert(tasks)
      .values({
        id,
        userId,
        projectId,
        sectionId,
        parentId: null,
        childOrder: t.childOrder,
        content: t.content,
        description: t.description,
        priority: t.priority,
        dueDate: due.dueDate,
        dueTime: due.dueTime,
        dueString: due.dueString,
        recurrence: due.recurrence === null ? null : JSON.stringify(due.recurrence),
        deadlineDate: t.deadline,
        durationMin: t.durationMin,
        uncompletable: t.content.startsWith('* '),
        completedAt: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    taskIdByKey.set(t.key, id)
    taskIds.push(id)
    created.tasks += 1

    for (const name of t.labels) {
      const labelId = labelIdByName.get(name.toLowerCase())
      if (labelId !== undefined) {
        tx.insert(taskLabels).values({ taskId: id, labelId }).onConflictDoNothing().run()
      }
    }
    for (const c of t.comments) {
      const at = c.postedAt ?? nowIso()
      tx.insert(comments)
        .values({
          id: newId(),
          userId,
          taskId: id,
          content: c.content,
          createdAt: at,
          updatedAt: at,
        })
        .run()
      created.comments += 1
    }
  }
  for (const t of plan.tasks) {
    if (t.parentKey === null) continue
    const id = taskIdByKey.get(t.key)
    const parentId = taskIdByKey.get(t.parentKey)
    if (id !== undefined && parentId !== undefined) {
      tx.update(tasks).set({ parentId }).where(eq(tasks.id, id)).run()
    }
  }

  created.skips = skips.length
  return { report: { mode, counts, created, skips }, taskIds }
}

/** Writes the whole plan in a single better-sqlite3 transaction; returns the apply report. */
export function applyImportPlan(deps: ImportApplyDeps, plan: ImportPlan): ImportReport {
  const inboxId = inboxProjectId(deps.db, deps.userId)
  const ctx = parseContextFor(getSettings(deps.db, deps.userId))
  let out: WriteResult | undefined
  deps.db.transaction((tx) => {
    out = writePlan(tx, deps.userId, inboxId, ctx, plan, 'apply')
  })
  if (out === undefined) throw new Error('import apply produced no result')
  deps.bus.publish({
    userId: deps.userId,
    type: 'import.completed',
    entity: 'task',
    ids: out.taskIds,
  })
  return out.report
}

/** Writes nothing; returns a report with `created` counts identical to what apply would write. */
export function dryRunReport(deps: ImportApplyDeps, plan: ImportPlan): ImportReport {
  const inboxId = inboxProjectId(deps.db, deps.userId)
  const ctx = parseContextFor(getSettings(deps.db, deps.userId))
  let out: WriteResult | undefined
  try {
    deps.db.transaction((tx) => {
      out = writePlan(tx, deps.userId, inboxId, ctx, plan, 'dry-run')
      throw new DryRunRollback()
    })
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e
  }
  if (out === undefined) throw new Error('import dry-run produced no result')
  return out.report
}
