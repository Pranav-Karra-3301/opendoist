import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { dateInTz, nextOccurrence, parseQuickAdd, RecurrenceSpecSchema } from '@opendoist/core'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { AppEnv } from '../../app'
import type { Db } from '../../db/db'
import { reminders, tasks } from '../../db/schema'
import { logActivity } from '../../lib/activity'
import { newId, nowIso } from '../../lib/ids'
import { parseContextFor } from '../../lib/parse-context'
import { problem } from '../../lib/problem'
import { recordCompletion, recordUncompletion } from '../../productivity/rollup'
import { syncTaskReminders } from '../../reminders/materialize'
import { resolveProject, resolveSection } from '../../services/quick-resolve'
import type { TaskDto, TaskRow } from '../../services/task-read'
import { tasksToDtos } from '../../services/task-read'
import { type CreateTaskInput, createTask, getSettings } from '../../services/task-write'
import { IdSchema, TaskDtoSchema } from '../schemas'

const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }]

/** RFC 9457 problem-details body (matches `lib/problem.ts`). */
const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string().optional(),
})
const problemResponse = (description: string) => ({
  content: { 'application/problem+json': { schema: ProblemSchema } },
  description,
})

/** Breadth-first walk of a task's still-open, non-deleted descendants. */
function collectOpenDescendants(db: Db, userId: string, rootId: string): TaskRow[] {
  const out: TaskRow[] = []
  const seen = new Set<string>([rootId])
  let frontier = [rootId]
  while (frontier.length > 0) {
    const children = db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          inArray(tasks.parentId, frontier),
          isNull(tasks.deletedAt),
          isNull(tasks.completedAt),
        ),
      )
      .all()
    frontier = []
    for (const child of children) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      out.push(child)
      frontier.push(child.id)
    }
  }
  return out
}

function loadTask(db: Db, userId: string, id: string): TaskRow | undefined {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
    .get()
}

function currentDto(db: Db, userId: string, id: string): TaskDto | undefined {
  const row = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, userId)))
    .get()
  if (row === undefined) return undefined
  return tasksToDtos(db, [row])[0]
}

const quickRoute = createRoute({
  method: 'post',
  path: '/tasks/quick',
  tags: ['tasks'],
  security,
  summary: 'Create a task from a raw Quick Add line',
  description:
    'Parses the Quick Add grammar (natural-language due, `{deadline}`, `#project`, `/section`, ' +
    '`@label`, `p1`–`p4`, `// description`, leading `* ` uncompletable, `!` reminders). Missing ' +
    'projects/sections/labels are auto-created. Parsed `!` reminder tokens are persisted; a relative ' +
    'reminder is skipped when the task has no due time.',
  request: {
    body: {
      content: { 'application/json': { schema: z.object({ text: z.string().min(1) }) } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: TaskDtoSchema } },
      description: 'Created task',
    },
    400: problemResponse('Invalid Quick Add text'),
  },
})

const CloseBodySchema = z.object({ complete_series: z.boolean().default(false) })

const closeRoute = createRoute({
  method: 'post',
  path: '/tasks/{id}/close',
  tags: ['tasks'],
  security,
  summary: 'Complete a task',
  description:
    'Completes a non-recurring task (and its open subtasks). A recurring task advances to its next ' +
    'occurrence and stays open unless the (optional) JSON body `{ "complete_series": true }` forces ' +
    'a final completion, or the recurrence has passed its `until` bound.',
  request: {
    params: z.object({ id: IdSchema }),
    body: {
      required: false,
      description: 'Optional. Omit entirely (or send `{}`) to complete one task/occurrence.',
      content: {
        'application/json': {
          // Documentation-only raw schema (kept in sync with CloseBodySchema): a zod schema here
          // would attach Hono's json validator, which 400s the body-less-but-json-content-type
          // requests this optional-body endpoint accepts. The handler validates strictly by hand.
          schema: {
            type: 'object',
            properties: {
              complete_series: {
                type: 'boolean',
                default: false,
                description: 'Fully complete a recurring task instead of advancing it.',
              },
            },
          },
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: TaskDtoSchema } },
      description: 'Completed or advanced task',
    },
    400: problemResponse('Invalid request body'),
    404: problemResponse('Task not found'),
    409: problemResponse('Task is uncompletable or already completed'),
  },
})

const reopenRoute = createRoute({
  method: 'post',
  path: '/tasks/{id}/reopen',
  tags: ['tasks'],
  security,
  summary: 'Reopen a completed task',
  description:
    'Clears `completed_at`, reopens any completed ancestors, and decrements that day’s completion count.',
  request: { params: z.object({ id: IdSchema }) },
  responses: {
    200: {
      content: { 'application/json': { schema: TaskDtoSchema } },
      description: 'Reopened task',
    },
    404: problemResponse('Task not found'),
    409: problemResponse('Task is not completed'),
  },
})

export const taskActionsRoutes = () => {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return problem(c, 400, 'validation failed', undefined, { errors: result.error.issues })
      }
    },
  })

  app.openapi(quickRoute, async (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus } = c.get('deps')
    const userId = auth.userId
    const { text } = c.req.valid('json')

    const ctx = parseContextFor(getSettings(db, userId))
    const parsed = parseQuickAdd(text, ctx)

    let projectId: string | null = null
    if (parsed.project !== null) projectId = resolveProject(db, userId, parsed.project).id
    let sectionId: string | null = null
    if (parsed.section !== null && projectId !== null) {
      sectionId = resolveSection(db, userId, projectId, parsed.section).id
    }

    const input: CreateTaskInput = {
      content: parsed.title,
      description: parsed.description ?? '',
      projectId,
      sectionId,
      parentId: null,
      childOrder: null,
      priority: parsed.priority,
      dueDate: parsed.due?.date ?? null,
      dueTime: parsed.due?.time ?? null,
      // persist the raw due token text so a recurring due can always be re-parsed
      dueString: parsed.due?.string ?? null,
      recurrence: parsed.due?.recurrence ?? null,
      // A `{…}` deadline may carry a wall-clock time (`{next friday 5pm}`); persist both. The
      // parser resolves the time (Task B); createTask drops the time if there is no date.
      deadlineDate: parsed.deadline?.date ?? null,
      deadlineTime: parsed.deadline?.time ?? null,
      durationMin: parsed.durationMin,
      labels: parsed.labels,
      uncompletable: parsed.uncompletable,
    }
    const row = createTask(db, userId, input)
    logActivity(db, {
      userId,
      eventType: 'task_added',
      entityType: 'task',
      entityId: row.id,
      projectId: row.projectId,
      payload: { via: 'quick' },
    })
    bus.publish({ userId, type: 'task.created', entity: 'task', ids: [row.id] })

    // phase 6: persist the parsed `!` reminder tokens, then materialize the auto-reminder + fire
    // instants for the whole task. A relative reminder is skipped (not an error) when the task has
    // no due time — there is nothing to fire relative to (Todoist behaves the same way).
    const remNow = nowIso()
    for (const draft of parsed.reminders) {
      if (draft.kind === 'relative') {
        if (row.dueDate === null || row.dueTime === null) continue
        db.insert(reminders)
          .values({
            id: newId(),
            userId,
            taskId: row.id,
            type: 'relative',
            minuteOffset: draft.minutesBefore,
            dueJson: null,
            isAuto: false,
            fireAtUtc: null,
            firedAt: null,
            createdAt: remNow,
            updatedAt: remNow,
          })
          .run()
      } else if (draft.kind === 'absolute') {
        const due = {
          date: draft.date,
          time: draft.time,
          string: `${draft.date} ${draft.time}`,
          recurrence: null,
        }
        db.insert(reminders)
          .values({
            id: newId(),
            userId,
            taskId: row.id,
            type: 'absolute',
            minuteOffset: null,
            dueJson: JSON.stringify(due),
            isAuto: false,
            fireAtUtc: null,
            firedAt: null,
            createdAt: remNow,
            updatedAt: remNow,
          })
          .run()
      } else {
        db.insert(reminders)
          .values({
            id: newId(),
            userId,
            taskId: row.id,
            type: 'recurring',
            minuteOffset: null,
            dueJson: JSON.stringify(draft.due),
            isAuto: false,
            fireAtUtc: null,
            firedAt: null,
            createdAt: remNow,
            updatedAt: remNow,
          })
          .run()
      }
    }
    await syncTaskReminders(db, row.id)

    const dto = tasksToDtos(db, [row])[0]
    if (dto === undefined) return problem(c, 404, 'not found')
    return c.json(dto, 201)
  })

  app.openapi(closeRoute, async (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus } = c.get('deps')
    const userId = auth.userId
    const { id } = c.req.valid('param')

    const task = loadTask(db, userId, id)
    if (task === undefined) return problem(c, 404, 'not found')
    if (task.uncompletable) return problem(c, 409, 'task is uncompletable')
    // Re-closing a completed task must not re-run completion (it would inflate day_stats/karma
    // and duplicate activity rows). Recurring tasks stay open on close, so they never hit this.
    if (task.completedAt !== null) return problem(c, 409, 'already completed')

    // Optional JSON body: absent or empty means complete_series = false, but a body that IS
    // present must validate — malformed values are a 400, same as every other zod-typed body.
    const rawText = await c.req.text()
    let rawBody: unknown = {}
    if (rawText.trim() !== '') {
      try {
        rawBody = JSON.parse(rawText)
      } catch {
        return problem(c, 400, 'validation failed', 'request body is not valid JSON')
      }
    }
    const parsedBody = CloseBodySchema.safeParse(rawBody)
    if (!parsedBody.success) {
      return problem(c, 400, 'validation failed', undefined, { errors: parsedBody.error.issues })
    }
    const completeSeries = parsedBody.data.complete_series

    const now = nowIso()
    const ctx = parseContextFor(getSettings(db, userId), now)
    const todayTz = dateInTz(ctx.now, ctx.timezone)

    // Recurring occurrence: advance the due, keep the task open (unless completing the series).
    if (task.recurrence !== null && !completeSeries) {
      const spec = RecurrenceSpecSchema.parse(JSON.parse(task.recurrence))
      const after =
        spec.anchor === 'completion'
          ? { date: todayTz, time: task.dueTime }
          : { date: task.dueDate ?? todayTz, time: task.dueTime }
      const next = nextOccurrence(spec, { after, ctx })
      if (next !== null) {
        db.update(tasks)
          .set({ dueDate: next.date, dueTime: next.time, updatedAt: now })
          .where(and(eq(tasks.id, task.id), eq(tasks.userId, userId)))
          .run()
        logActivity(db, {
          userId,
          eventType: 'task_completed',
          entityType: 'task',
          entityId: task.id,
          projectId: task.projectId,
          payload: { recurring: true, next_due: next.date },
        })
        // Recurring occurrence still counts as a completion; the occurrence's due is task.dueDate.
        try {
          recordCompletion(db, { userId, taskId: task.id, dueDate: task.dueDate, completedAt: now })
        } catch (err) {
          c.get('deps').logger.error({ err, taskId: task.id }, 'recordCompletion hook failed')
        }
        bus.publish({ userId, type: 'task.completed', entity: 'task', ids: [task.id] })
        bus.publish({ userId, type: 'task.updated', entity: 'task', ids: [task.id] })
        // phase 6: the advanced due re-arms this task's reminders around the next occurrence.
        await syncTaskReminders(db, task.id)
        const dto = currentDto(db, userId, task.id)
        if (dto === undefined) return problem(c, 404, 'not found')
        return c.json(dto, 200)
      }
      // next === null: recurrence exhausted its `until` bound → fall through to final completion.
    }

    // Final completion: close the task and every open descendant; count only the root.
    const descendants = collectOpenDescendants(db, userId, task.id)
    const closedIds = [task.id, ...descendants.map((d) => d.id)]
    db.update(tasks)
      .set({ completedAt: now, updatedAt: now })
      .where(and(eq(tasks.userId, userId), inArray(tasks.id, closedIds)))
      .run()
    logActivity(db, {
      userId,
      eventType: 'task_completed',
      entityType: 'task',
      entityId: task.id,
      projectId: task.projectId,
    })
    for (const d of descendants) {
      logActivity(db, {
        userId,
        eventType: 'task_completed',
        entityType: 'task',
        entityId: d.id,
        projectId: d.projectId,
      })
    }
    // Karma/day_stats count only the root task, mirroring the single day_stats increment.
    try {
      recordCompletion(db, { userId, taskId: task.id, dueDate: task.dueDate, completedAt: now })
    } catch (err) {
      c.get('deps').logger.error({ err, taskId: task.id }, 'recordCompletion hook failed')
    }
    bus.publish({ userId, type: 'task.completed', entity: 'task', ids: closedIds })
    // phase 6: completing a non-recurring task unarms its relative/auto reminders.
    await syncTaskReminders(db, task.id)

    const dto = currentDto(db, userId, task.id)
    if (dto === undefined) return problem(c, 404, 'not found')
    return c.json(dto, 200)
  })

  app.openapi(reopenRoute, async (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus } = c.get('deps')
    const userId = auth.userId
    const { id } = c.req.valid('param')

    const task = loadTask(db, userId, id)
    if (task === undefined) return problem(c, 404, 'not found')
    if (task.completedAt === null) return problem(c, 409, 'not completed')

    // Capture the completion instant BEFORE the update below clears it (karma reversal keys off it).
    const previousCompletedAt = task.completedAt
    const now = nowIso()

    const reopenedIds = [task.id]
    db.update(tasks)
      .set({ completedAt: null, updatedAt: now })
      .where(and(eq(tasks.id, task.id), eq(tasks.userId, userId)))
      .run()

    // Reopen any completed ancestors so an open child never sits under a completed parent.
    const seen = new Set<string>([task.id])
    let parentId = task.parentId
    while (parentId !== null && !seen.has(parentId)) {
      seen.add(parentId)
      const parent = loadTask(db, userId, parentId)
      if (parent === undefined) break
      if (parent.completedAt !== null) {
        db.update(tasks)
          .set({ completedAt: null, updatedAt: now })
          .where(and(eq(tasks.id, parent.id), eq(tasks.userId, userId)))
          .run()
        reopenedIds.push(parent.id)
      }
      parentId = parent.parentId
    }

    try {
      recordUncompletion(db, { userId, taskId: task.id, previousCompletedAt })
    } catch (err) {
      c.get('deps').logger.error({ err, taskId: task.id }, 'recordUncompletion hook failed')
    }
    logActivity(db, {
      userId,
      eventType: 'task_uncompleted',
      entityType: 'task',
      entityId: task.id,
      projectId: task.projectId,
    })
    bus.publish({ userId, type: 'task.uncompleted', entity: 'task', ids: reopenedIds })
    // phase 6: reopening a task re-arms its relative/auto reminders around the (unchanged) due.
    await syncTaskReminders(db, task.id)

    const dto = currentDto(db, userId, task.id)
    if (dto === undefined) return problem(c, 404, 'not found')
    return c.json(dto, 200)
  })

  return app
}
