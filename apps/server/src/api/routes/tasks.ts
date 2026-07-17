import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import {
  type ParseContext,
  parseRecurrenceText,
  type RecurrenceSpec,
  resolveNaturalDate,
} from '@opendoist/core'
import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import type { AppEnv } from '../../app'
import type { Db } from '../../db/db'
import { labels as labelsTable, projects, sections, taskLabels, tasks } from '../../db/schema'
import { logActivity } from '../../lib/activity'
import { nowIso } from '../../lib/ids'
import { decodeCursor, encodeCursor, ListQuerySchema } from '../../lib/pagination'
import { parseContextFor } from '../../lib/parse-context'
import { problem } from '../../lib/problem'
import { recordDeletion } from '../../productivity/rollup'
import { syncTaskReminders } from '../../reminders/materialize'
import { type TaskDto, type TaskRow, tasksToDtos } from '../../services/task-read'
import { createTask, getSettings, resolveLabelIds } from '../../services/task-write'
import { CreateTaskSchema, IdSchema, TaskDtoSchema, UpdateTaskSchema } from '../schemas'

const security: Array<Record<string, string[]>> = [{ cookieAuth: [] }, { bearerAuth: [] }]
const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
})
const problemResponse = (description: string) => ({
  content: { 'application/problem+json': { schema: ProblemSchema } },
  description,
})
const TaskListSchema = z.object({
  results: z.array(TaskDtoSchema),
  next_cursor: z.string().nullable(),
})
const OkSchema = z.object({ ok: z.boolean() })

interface ResolvedDue {
  dueDate: string | null
  dueTime: string | null
  dueString: string | null
  recurrence: RecurrenceSpec | null
}

/**
 * Turn a `due` input into stored columns. A `due.string` is parsed against the user's
 * ParseContext — first as a recurrence phrase, then as a one-off natural date; the raw
 * string is always kept so recurring tasks can be re-parsed later. An explicit `date`
 * pins the resolved occurrence (parsing only supplies the recurrence spec), so a restore
 * of `{string, date, time?}` round-trips the exact prior due even when the phrase would
 * re-resolve differently by then (undo §2.4). `null`/absent/unparseable clears the due.
 */
function resolveDue(
  due: { string?: string; date?: string; time?: string } | null | undefined,
  ctx: ParseContext,
): ResolvedDue {
  const clear: ResolvedDue = { dueDate: null, dueTime: null, dueString: null, recurrence: null }
  if (due === null || due === undefined) return clear
  if (due.string !== undefined && due.string.trim() !== '') {
    const rec = parseRecurrenceText(due.string, ctx)
    if (rec !== null) {
      return {
        dueDate: due.date ?? rec.firstDate,
        dueTime: due.date !== undefined ? (due.time ?? rec.firstTime) : rec.firstTime,
        dueString: due.string,
        recurrence: rec.spec,
      }
    }
    if (due.date !== undefined) {
      // Non-recurring phrase with explicit values: store the phrase verbatim, values exact.
      return {
        dueDate: due.date,
        dueTime: due.time ?? null,
        dueString: due.string,
        recurrence: null,
      }
    }
    const nat = resolveNaturalDate(due.string, ctx)
    if (nat !== null) {
      return { dueDate: nat.date, dueTime: nat.time, dueString: due.string, recurrence: null }
    }
    return clear
  }
  if (due.date !== undefined) {
    return { dueDate: due.date, dueTime: due.time ?? null, dueString: null, recurrence: null }
  }
  return clear
}

/** Assemble the wire DTO for one freshly read/written task row (labels joined). */
function toDto(db: Db, row: TaskRow): TaskDto {
  const [dto] = tasksToDtos(db, [row])
  if (dto === undefined) throw new Error('task DTO assembly returned no row')
  return dto
}

/** All ids in the subtree rooted at `rootId` (inclusive), following non-deleted parent links. */
function collectSubtreeIds(db: Db, userId: string, rootId: string): string[] {
  const all: string[] = [rootId]
  let frontier: string[] = [rootId]
  while (frontier.length > 0) {
    const children = db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(eq(tasks.userId, userId), isNull(tasks.deletedAt), inArray(tasks.parentId, frontier)),
      )
      .all()
    const next = children.map((r) => r.id).filter((id) => !all.includes(id))
    if (next.length === 0) break
    all.push(...next)
    frontier = next
  }
  return all
}

/**
 * Ownership/existence checks for the ids a task write may reference. Every referenced row must
 * be the caller's own non-deleted row — otherwise a user could plant tasks in another tenant's
 * project/section/parent, and unknown ids would surface as raw SQLite FK 500s.
 */
function ownsProject(db: Db, userId: string, id: string): boolean {
  return (
    db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, userId), isNull(projects.deletedAt)))
      .get() !== undefined
  )
}

function ownsSection(db: Db, userId: string, id: string): boolean {
  return (
    db
      .select({ id: sections.id })
      .from(sections)
      .where(and(eq(sections.id, id), eq(sections.userId, userId), isNull(sections.deletedAt)))
      .get() !== undefined
  )
}

function ownsTask(db: Db, userId: string, id: string): boolean {
  return (
    db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
      .get() !== undefined
  )
}

/**
 * Validates the project/section/parent references of a create or update body.
 * Returns a problem-detail string for the first invalid reference, or null when all are fine.
 */
function invalidTaskRefs(
  db: Db,
  userId: string,
  refs: { projectId?: string; sectionId?: string | null; parentId?: string | null },
): string | null {
  if (refs.projectId !== undefined && !ownsProject(db, userId, refs.projectId)) {
    return 'project_id not found'
  }
  if (refs.sectionId != null && !ownsSection(db, userId, refs.sectionId)) {
    return 'section_id not found'
  }
  if (refs.parentId != null && !ownsTask(db, userId, refs.parentId)) {
    return 'parent_id not found'
  }
  return null
}

const ListTasksQuerySchema = ListQuerySchema.extend({
  project_id: IdSchema.optional(),
  section_id: IdSchema.optional(),
  parent_id: IdSchema.optional(),
  label: z.string().optional(),
})
const CompletedQuerySchema = ListQuerySchema.extend({
  project_id: IdSchema.optional(),
  /** ISO date/instant compared against completed_at (mirrors the activities params) */
  since: z.string().optional(),
  until: z.string().optional(),
})
const MoveBodySchema = z
  .object({
    project_id: IdSchema.optional(),
    section_id: IdSchema.nullable().optional(),
    parent_id: IdSchema.nullable().optional(),
    /** Explicit position among the destination siblings; omitted = append at the end.
     *  Undo sends the captured pre-move value so an inverse move is an exact restore. */
    child_order: z.number().int().optional(),
  })
  .refine(
    (b) => b.project_id !== undefined || b.section_id !== undefined || b.parent_id !== undefined,
    { message: 'at least one of project_id, section_id, parent_id is required' },
  )
const ReorderBodySchema = z.object({
  items: z.array(z.object({ id: IdSchema, child_order: z.number().int() })).min(1),
})
const IdParamSchema = z.object({ id: IdSchema })

const listRoute = createRoute({
  method: 'get',
  path: '/tasks',
  tags: ['tasks'],
  summary: 'List open tasks',
  security,
  request: { query: ListTasksQuerySchema },
  responses: {
    200: { content: { 'application/json': { schema: TaskListSchema } }, description: 'Open tasks' },
    400: problemResponse('Invalid cursor'),
  },
})

const completedRoute = createRoute({
  method: 'get',
  path: '/tasks/completed',
  tags: ['tasks'],
  summary: 'List completed tasks',
  security,
  request: { query: CompletedQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: TaskListSchema } },
      description: 'Completed tasks',
    },
    400: problemResponse('Invalid cursor'),
  },
})

const createTaskRoute = createRoute({
  method: 'post',
  path: '/tasks',
  tags: ['tasks'],
  summary: 'Create a task',
  security,
  request: { body: { content: { 'application/json': { schema: CreateTaskSchema } } } },
  responses: {
    201: {
      content: { 'application/json': { schema: TaskDtoSchema } },
      description: 'Created task',
    },
    400: problemResponse('Validation failed'),
  },
})

const reorderRoute = createRoute({
  method: 'post',
  path: '/tasks/reorder',
  tags: ['tasks'],
  summary: 'Batch-update task child_order',
  security,
  request: { body: { content: { 'application/json': { schema: ReorderBodySchema } } } },
  responses: {
    204: { description: 'Reordered' },
    404: problemResponse('A task id does not belong to the user'),
  },
})

const getTaskRoute = createRoute({
  method: 'get',
  path: '/tasks/{id}',
  tags: ['tasks'],
  summary: 'Get a task',
  security,
  request: { params: IdParamSchema },
  responses: {
    200: { content: { 'application/json': { schema: TaskDtoSchema } }, description: 'Task' },
    404: problemResponse('Task not found'),
  },
})

const patchTaskRoute = createRoute({
  method: 'patch',
  path: '/tasks/{id}',
  tags: ['tasks'],
  summary: 'Update a task',
  security,
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: UpdateTaskSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: TaskDtoSchema } },
      description: 'Updated task',
    },
    400: problemResponse('Invalid reference (foreign/unknown id, or a parent cycle)'),
    404: problemResponse('Task not found'),
  },
})

const deleteTaskRoute = createRoute({
  method: 'delete',
  path: '/tasks/{id}',
  tags: ['tasks'],
  summary: 'Soft-delete a task and its subtree',
  security,
  request: { params: IdParamSchema },
  responses: {
    204: { description: 'Deleted' },
    404: problemResponse('Task not found'),
  },
})

const moveTaskRoute = createRoute({
  method: 'post',
  path: '/tasks/{id}/move',
  tags: ['tasks'],
  summary: 'Move a task (project/section/parent)',
  security,
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: MoveBodySchema } } },
  },
  responses: {
    200: { content: { 'application/json': { schema: TaskDtoSchema } }, description: 'Moved task' },
    400: problemResponse('Invalid move'),
    404: problemResponse('Task not found'),
  },
})

const restoreTaskRoute = createRoute({
  method: 'post',
  path: '/tasks/{id}/restore',
  tags: ['tasks'],
  summary: 'Restore a soft-deleted task and its subtree',
  description:
    'Clears `deleted_at` on the task and every row deleted in the same cascade (delete stamps an ' +
    'identical `deleted_at` across the subtree). Powers the delete-task undo.',
  security,
  request: { params: IdParamSchema },
  responses: {
    200: { content: { 'application/json': { schema: OkSchema } }, description: 'Restored' },
    404: problemResponse('No soft-deleted task with that id'),
  },
})

export const tasksRoutes = () => {
  const app = new OpenAPIHono<AppEnv>()

  // GET /tasks — open tasks, keyset (child_order, id) ascending, filters ANDed.
  app.openapi(listRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db } = c.get('deps')
    const { cursor, limit, project_id, section_id, parent_id, label } = c.req.valid('query')

    let cursorCond: SQL | undefined
    if (cursor !== undefined) {
      const dec = decodeCursor(cursor)
      const co = dec?.childOrder
      const cid = dec?.id
      if (dec === null || typeof co !== 'number' || typeof cid !== 'string') {
        return problem(c, 400, 'invalid cursor')
      }
      cursorCond = or(gt(tasks.childOrder, co), and(eq(tasks.childOrder, co), gt(tasks.id, cid)))
    }

    const conds: (SQL | undefined)[] = [
      eq(tasks.userId, auth.userId),
      isNull(tasks.completedAt),
      isNull(tasks.deletedAt),
      cursorCond,
    ]
    if (project_id !== undefined) conds.push(eq(tasks.projectId, project_id))
    if (section_id !== undefined) conds.push(eq(tasks.sectionId, section_id))
    if (parent_id !== undefined) conds.push(eq(tasks.parentId, parent_id))
    if (label !== undefined) {
      const sub = db
        .select({ id: taskLabels.taskId })
        .from(taskLabels)
        .innerJoin(labelsTable, eq(taskLabels.labelId, labelsTable.id))
        .where(
          and(
            eq(labelsTable.userId, auth.userId),
            isNull(labelsTable.deletedAt),
            sql`lower(${labelsTable.name}) = lower(${label})`,
          ),
        )
      conds.push(inArray(tasks.id, sub))
    }

    const rows = db
      .select()
      .from(tasks)
      .where(and(...conds))
      .orderBy(tasks.childOrder, tasks.id)
      .limit(limit + 1)
      .all()
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const last = page.at(-1)
    const next_cursor =
      hasMore && last ? encodeCursor({ childOrder: last.childOrder, id: last.id }) : null
    return c.json({ results: tasksToDtos(db, page), next_cursor }, 200)
  })

  // GET /tasks/completed — MUST be registered before /tasks/{id}.
  app.openapi(completedRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db } = c.get('deps')
    const { cursor, limit, project_id, since, until } = c.req.valid('query')

    let cursorCond: SQL | undefined
    if (cursor !== undefined) {
      const dec = decodeCursor(cursor)
      const cc = dec?.completedAt
      const cid = dec?.id
      if (dec === null || typeof cc !== 'string' || typeof cid !== 'string') {
        return problem(c, 400, 'invalid cursor')
      }
      cursorCond = or(lt(tasks.completedAt, cc), and(eq(tasks.completedAt, cc), lt(tasks.id, cid)))
    }

    const conds: (SQL | undefined)[] = [
      eq(tasks.userId, auth.userId),
      isNotNull(tasks.completedAt),
      isNull(tasks.deletedAt),
      cursorCond,
    ]
    if (project_id !== undefined) conds.push(eq(tasks.projectId, project_id))
    if (since !== undefined) conds.push(gte(tasks.completedAt, since))
    if (until !== undefined) conds.push(lte(tasks.completedAt, until))

    const rows = db
      .select()
      .from(tasks)
      .where(and(...conds))
      .orderBy(desc(tasks.completedAt), desc(tasks.id))
      .limit(limit + 1)
      .all()
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const last = page.at(-1)
    const next_cursor =
      hasMore && last ? encodeCursor({ completedAt: last.completedAt ?? '', id: last.id }) : null
    return c.json({ results: tasksToDtos(db, page), next_cursor }, 200)
  })

  // POST /tasks
  app.openapi(createTaskRoute, async (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus } = c.get('deps')
    const body = c.req.valid('json')
    const invalidRef = invalidTaskRefs(db, auth.userId, {
      projectId: body.project_id,
      sectionId: body.section_id,
      parentId: body.parent_id,
    })
    if (invalidRef !== null) return problem(c, 400, 'invalid reference', invalidRef)
    const ctx = parseContextFor(getSettings(db, auth.userId))
    const due = resolveDue(body.due, ctx)
    const row = createTask(db, auth.userId, {
      content: body.content,
      description: body.description,
      projectId: body.project_id ?? null,
      sectionId: body.section_id ?? null,
      parentId: body.parent_id ?? null,
      childOrder: body.child_order ?? null,
      priority: body.priority as 1 | 2 | 3 | 4,
      dueDate: due.dueDate,
      dueTime: due.dueTime,
      dueString: due.dueString,
      recurrence: due.recurrence,
      deadlineDate: body.deadline_date ?? null,
      durationMin: body.duration_min ?? null,
      labels: body.labels,
      uncompletable: body.uncompletable ?? null,
    })
    logActivity(db, {
      userId: auth.userId,
      eventType: 'task_added',
      entityType: 'task',
      entityId: row.id,
      projectId: row.projectId,
    })
    bus.publish({ userId: auth.userId, type: 'task.created', entity: 'task', ids: [row.id] })
    // phase 6: materialize the auto-reminder + fire instants for the new due.
    await syncTaskReminders(db, row.id)
    return c.json(toDto(db, row), 201)
  })

  // POST /tasks/reorder — MUST be registered before /tasks/{id}/move (distinct path, ordered for clarity).
  app.openapi(reorderRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus } = c.get('deps')
    const { items } = c.req.valid('json')
    const ids = items.map((i) => i.id)
    const found = db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.userId, auth.userId), isNull(tasks.deletedAt), inArray(tasks.id, ids)))
      .all()
    const foundSet = new Set(found.map((f) => f.id))
    for (const id of ids) {
      if (!foundSet.has(id)) return problem(c, 404, 'not found')
    }
    const now = nowIso()
    for (const item of items) {
      db.update(tasks)
        .set({ childOrder: item.child_order, updatedAt: now })
        .where(and(eq(tasks.id, item.id), eq(tasks.userId, auth.userId)))
        .run()
    }
    bus.publish({ userId: auth.userId, type: 'task.updated', entity: 'task', ids })
    return c.body(null, 204)
  })

  // GET /tasks/{id}
  app.openapi(getTaskRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db } = c.get('deps')
    const { id } = c.req.valid('param')
    const row = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, auth.userId), isNull(tasks.deletedAt)))
      .get()
    if (row === undefined) return problem(c, 404, 'not found')
    return c.json(toDto(db, row), 200)
  })

  // PATCH /tasks/{id}
  app.openapi(patchTaskRoute, async (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus } = c.get('deps')
    const { id } = c.req.valid('param')
    const existing = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, auth.userId), isNull(tasks.deletedAt)))
      .get()
    if (existing === undefined) return problem(c, 404, 'not found')

    // Zod .partial() still applies field .default()s, so an omitted `priority`/`labels` arrives
    // populated in the validated body. Detect the fields the client actually sent from the raw body.
    const raw = (await c.req.json()) as Record<string, unknown>
    const has = (k: string) => Object.hasOwn(raw, k)
    const body = c.req.valid('json')

    // Referenced ids must be the caller's own rows (same rules as POST /tasks and /move) …
    const invalidRef = invalidTaskRefs(db, auth.userId, {
      projectId: has('project_id') ? body.project_id : undefined,
      sectionId: has('section_id') ? body.section_id : undefined,
      parentId: has('parent_id') ? body.parent_id : undefined,
    })
    if (invalidRef !== null) return problem(c, 400, 'invalid reference', invalidRef)
    // … and re-parenting may not point a task at itself or its own subtree.
    if (has('parent_id') && body.parent_id != null) {
      const subtree = collectSubtreeIds(db, auth.userId, id)
      if (body.parent_id === id || subtree.includes(body.parent_id)) {
        return problem(c, 400, 'invalid reference', 'parent_id would create a cycle')
      }
    }
    const ctx = parseContextFor(getSettings(db, auth.userId))

    const updates: Partial<typeof tasks.$inferInsert> = {}
    if (has('content')) updates.content = body.content
    if (has('description')) updates.description = body.description
    if (has('priority')) updates.priority = body.priority
    if (has('project_id')) updates.projectId = body.project_id
    if (has('section_id')) updates.sectionId = body.section_id ?? null
    if (has('parent_id')) updates.parentId = body.parent_id ?? null
    if (has('child_order')) updates.childOrder = body.child_order
    if (has('deadline_date')) updates.deadlineDate = body.deadline_date ?? null
    if (has('duration_min')) updates.durationMin = body.duration_min ?? null
    if (has('uncompletable')) updates.uncompletable = body.uncompletable
    if (has('day_order')) updates.dayOrder = body.day_order
    if (has('is_collapsed')) updates.isCollapsed = body.is_collapsed
    if (has('due')) {
      const due = resolveDue(body.due, ctx)
      updates.dueDate = due.dueDate
      updates.dueTime = due.dueTime
      updates.dueString = due.dueString
      updates.recurrence = due.recurrence === null ? null : JSON.stringify(due.recurrence)
    }
    updates.updatedAt = nowIso()
    db.update(tasks)
      .set(updates)
      .where(and(eq(tasks.id, id), eq(tasks.userId, auth.userId)))
      .run()

    if (has('labels')) {
      db.delete(taskLabels).where(eq(taskLabels.taskId, id)).run()
      for (const labelId of resolveLabelIds(db, auth.userId, body.labels ?? [])) {
        db.insert(taskLabels).values({ taskId: id, labelId }).onConflictDoNothing().run()
      }
    }

    logActivity(db, {
      userId: auth.userId,
      eventType: 'task_updated',
      entityType: 'task',
      entityId: id,
      projectId: updates.projectId ?? existing.projectId,
      payload: Object.keys(raw),
    })
    bus.publish({ userId: auth.userId, type: 'task.updated', entity: 'task', ids: [id] })
    // phase 6: a due change re-arms this task's reminders (and re-materializes the auto-reminder).
    await syncTaskReminders(db, id)

    const updated = db.select().from(tasks).where(eq(tasks.id, id)).get()
    if (updated === undefined) return problem(c, 404, 'not found')
    return c.json(toDto(db, updated), 200)
  })

  // DELETE /tasks/{id} — soft-delete the task and every descendant.
  app.openapi(deleteTaskRoute, async (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus } = c.get('deps')
    const { id } = c.req.valid('param')
    const root = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, auth.userId), isNull(tasks.deletedAt)))
      .get()
    if (root === undefined) return problem(c, 404, 'not found')
    const ids = collectSubtreeIds(db, auth.userId, id)
    const now = nowIso()
    db.update(tasks)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(inArray(tasks.id, ids), eq(tasks.userId, auth.userId)))
      .run()
    // Karma penalty for deleting an overdue task (root only, mirroring completion's root-only count).
    try {
      recordDeletion(db, { userId: auth.userId, taskId: id, dueDate: root.dueDate, deletedAt: now })
    } catch (err) {
      c.get('deps').logger.error({ err, taskId: id }, 'recordDeletion hook failed')
    }
    logActivity(db, {
      userId: auth.userId,
      eventType: 'task_deleted',
      entityType: 'task',
      entityId: id,
      projectId: root.projectId,
    })
    bus.publish({ userId: auth.userId, type: 'task.deleted', entity: 'task', ids })
    // phase 6: soft-delete unarms this task's reminders (subtree rows are skipped at fire time).
    await syncTaskReminders(db, id)
    return c.body(null, 204)
  })

  // POST /tasks/{id}/move
  app.openapi(moveTaskRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus } = c.get('deps')
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const root = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, auth.userId), isNull(tasks.deletedAt)))
      .get()
    if (root === undefined) return problem(c, 404, 'not found')

    const subtree = collectSubtreeIds(db, auth.userId, id)
    const newParentId = body.parent_id !== undefined ? body.parent_id : root.parentId
    if (newParentId !== null) {
      if (newParentId === id || subtree.includes(newParentId)) {
        return problem(c, 400, 'invalid move', 'parent_id would create a cycle')
      }
      const parent = db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(eq(tasks.id, newParentId), eq(tasks.userId, auth.userId), isNull(tasks.deletedAt)),
        )
        .get()
      if (parent === undefined) return problem(c, 400, 'invalid move', 'parent_id not found')
    }

    const newProjectId = body.project_id !== undefined ? body.project_id : root.projectId
    const projectChanged = newProjectId !== root.projectId
    if (projectChanged) {
      const proj = db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.id, newProjectId),
            eq(projects.userId, auth.userId),
            isNull(projects.deletedAt),
          ),
        )
        .get()
      if (proj === undefined) return problem(c, 400, 'invalid move', 'project_id not found')
    }
    const newSectionId =
      body.section_id !== undefined ? body.section_id : projectChanged ? null : root.sectionId
    if (
      body.section_id !== undefined &&
      body.section_id !== null &&
      !ownsSection(db, auth.userId, body.section_id)
    ) {
      return problem(c, 400, 'invalid move', 'section_id not found')
    }

    const maxOrder = db
      .select({ m: max(tasks.childOrder) })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, auth.userId),
          eq(tasks.projectId, newProjectId),
          newParentId === null ? isNull(tasks.parentId) : eq(tasks.parentId, newParentId),
          isNull(tasks.deletedAt),
          ne(tasks.id, id),
        ),
      )
      .get()
    const now = nowIso()
    db.update(tasks)
      .set({
        projectId: newProjectId,
        sectionId: newSectionId,
        parentId: newParentId,
        // Explicit child_order (the undo path restoring the pre-move position) wins;
        // otherwise append after the destination container's last sibling.
        childOrder: body.child_order ?? (maxOrder?.m ?? -1) + 1,
        updatedAt: now,
      })
      .where(eq(tasks.id, id))
      .run()

    if (projectChanged) {
      const descendants = subtree.filter((x) => x !== id)
      if (descendants.length > 0) {
        db.update(tasks)
          .set({ projectId: newProjectId, sectionId: null, updatedAt: now })
          .where(and(inArray(tasks.id, descendants), eq(tasks.userId, auth.userId)))
          .run()
      }
    }

    logActivity(db, {
      userId: auth.userId,
      eventType: 'task_moved',
      entityType: 'task',
      entityId: id,
      // project_id is the destination, so the feed's `project_name` reads "Moved to <dest>".
      projectId: newProjectId,
      payload: { from_project_id: root.projectId, to_project_id: newProjectId },
    })
    bus.publish({
      userId: auth.userId,
      type: 'task.updated',
      entity: 'task',
      ids: projectChanged ? subtree : [id],
    })

    const updated = db.select().from(tasks).where(eq(tasks.id, id)).get()
    if (updated === undefined) return problem(c, 404, 'not found')
    return c.json(toDto(db, updated), 200)
  })

  // POST /tasks/{id}/restore — un-delete the task and its whole delete-cascade.
  app.openapi(restoreTaskRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus } = c.get('deps')
    const { id } = c.req.valid('param')
    const root = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, auth.userId), isNotNull(tasks.deletedAt)))
      .get()
    if (root === undefined || root.deletedAt === null) return problem(c, 404, 'not found')
    const marker = root.deletedAt

    const now = nowIso()
    // The delete handler stamps an identical `deleted_at` across the subtree, so the marker
    // selects exactly that cascade (unique per delete request for a single user).
    const restored = db
      .update(tasks)
      .set({ deletedAt: null, updatedAt: now })
      .where(and(eq(tasks.userId, auth.userId), eq(tasks.deletedAt, marker)))
      .returning({ id: tasks.id })
      .all()
    const ids = restored.map((r) => r.id)
    logActivity(db, {
      userId: auth.userId,
      eventType: 'task_restored',
      entityType: 'task',
      entityId: id,
      projectId: root.projectId,
    })
    bus.publish({ userId: auth.userId, type: 'task.restored', entity: 'task', ids })
    return c.json({ ok: true }, 200)
  })

  return app
}
