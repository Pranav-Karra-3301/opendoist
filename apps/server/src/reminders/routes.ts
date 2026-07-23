import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { DueSchema } from '@opentask/core'
import { and, eq, isNull } from 'drizzle-orm'
import { IdSchema } from '../api/schemas'
import type { AppEnv } from '../app'
import { reminders, tasks } from '../db/schema'
import { newId, nowIso } from '../lib/ids'
import { problem } from '../lib/problem'
import {
  CreateReminderBodySchema,
  type ReminderDto,
  ReminderDtoSchema,
  type ReminderPayload,
  TestFireResultSchema,
  UpdateReminderBodySchema,
} from './contracts'
import { dispatchTestPayload } from './dispatch'
import { syncTaskReminders } from './materialize'

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

const ReminderListSchema = z.object({
  results: z.array(ReminderDtoSchema),
  next_cursor: z.string().nullable(),
})

type ReminderRow = typeof reminders.$inferSelect

/** Wire DTO for one reminder row (dueJson is parsed back into a core `Due`). */
function reminderToDto(row: ReminderRow): ReminderDto {
  return {
    id: row.id,
    task_id: row.taskId,
    type: row.type,
    minute_offset: row.minuteOffset,
    due: row.dueJson === null ? null : DueSchema.parse(JSON.parse(row.dueJson)),
    is_auto: row.isAuto,
    fire_at_utc: row.fireAtUtc,
    fired_at: row.firedAt,
    created_at: row.createdAt,
  }
}

const listRoute = createRoute({
  method: 'get',
  path: '/reminders',
  tags: ['reminders'],
  summary: 'List reminders',
  description: 'All of the caller’s reminders, optionally scoped to one task via `task_id`.',
  security,
  request: { query: z.object({ task_id: IdSchema.optional() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: ReminderListSchema } },
      description: 'Reminders',
    },
    400: problemResponse('Invalid query parameters'),
  },
})

const createReminderRoute = createRoute({
  method: 'post',
  path: '/reminders',
  tags: ['reminders'],
  summary: 'Create a reminder',
  description:
    'Attaches a reminder to a task. `relative` fires `minute_offset` minutes before the task’s due ' +
    'time and requires the task to have a due date+time; `absolute` fires at its own due date+time; ' +
    '`recurring` fires on its own recurrence. The next fire instant is (re)computed from the task’s ' +
    'timezone-aware due.',
  security,
  request: { body: { content: { 'application/json': { schema: CreateReminderBodySchema } } } },
  responses: {
    201: {
      content: { 'application/json': { schema: ReminderDtoSchema } },
      description: 'Created reminder',
    },
    400: problemResponse('Validation failed, or a relative reminder on a task with no due time'),
    404: problemResponse('Task not found'),
  },
})

const testRoute = createRoute({
  method: 'post',
  path: '/reminders/test',
  tags: ['reminders'],
  summary: 'Send a test notification',
  description:
    'Dispatches a canned "Reminders are working." notification to every push subscription and ' +
    'enabled notification channel, returning a per-sink delivery summary. Bypasses the scheduler ' +
    'and never touches any channel’s failure counters.',
  security,
  responses: {
    200: {
      content: { 'application/json': { schema: TestFireResultSchema } },
      description: 'Per-sink delivery summary',
    },
    401: problemResponse('Unauthorized'),
  },
})

const updateReminderRoute = createRoute({
  method: 'patch',
  path: '/reminders/{id}',
  tags: ['reminders'],
  summary: 'Update a reminder',
  description:
    'Changes a relative reminder’s `minute_offset` or an absolute/recurring reminder’s `due`, then ' +
    'recomputes the fire instant (re-arming the reminder when the instant changes).',
  security,
  request: {
    params: z.object({ id: IdSchema }),
    body: { content: { 'application/json': { schema: UpdateReminderBodySchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ReminderDtoSchema } },
      description: 'Updated reminder',
    },
    404: problemResponse('Reminder not found'),
  },
})

const deleteReminderRoute = createRoute({
  method: 'delete',
  path: '/reminders/{id}',
  tags: ['reminders'],
  summary: 'Delete a reminder',
  description:
    'Hard-deletes the reminder. Deleting an automatic reminder does not disable auto-reminders — ' +
    'the next write to the task recreates it while the user’s `autoReminderMinutes` still calls for one.',
  security,
  request: { params: z.object({ id: IdSchema }) },
  responses: {
    204: { description: 'Deleted' },
    404: problemResponse('Reminder not found'),
  },
})

export const remindersRoutes = () => {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return problem(c, 400, 'validation failed', undefined, { errors: result.error.issues })
      }
    },
  })

  // GET /reminders — all of the user's reminders, optionally scoped to one task.
  app.openapi(listRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db } = c.get('deps')
    const { task_id } = c.req.valid('query')
    const conds = [eq(reminders.userId, auth.userId)]
    if (task_id !== undefined) conds.push(eq(reminders.taskId, task_id))
    const rows = db
      .select()
      .from(reminders)
      .where(and(...conds))
      .orderBy(reminders.createdAt, reminders.id)
      .all()
    return c.json({ results: rows.map(reminderToDto), next_cursor: null }, 200)
  })

  // POST /reminders/test — MUST be registered before POST /reminders/{id} equivalents; distinct path.
  app.openapi(testRoute, async (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, config } = c.get('deps')
    const base = (config.publicUrl ?? 'http://localhost:7968').replace(/\/+$/, '')
    const payload: ReminderPayload = {
      title: 'Test notification from OpenTask',
      body: 'Reminders are working.',
      url: base,
      tag: 'reminder-test',
      task_id: 'test',
      reminder_id: 'test',
      fired_at: nowIso(),
      priority: 4,
      due: null,
      test: true,
    }
    const result = await dispatchTestPayload(db, auth.userId, payload)
    return c.json(result, 200)
  })

  // POST /reminders
  app.openapi(createReminderRoute, async (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus } = c.get('deps')
    const userId = auth.userId
    const body = c.req.valid('json')

    const task = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, body.task_id), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
      .get()
    if (task === undefined) return problem(c, 404, 'not found')
    if (body.type === 'relative' && (task.dueDate === null || task.dueTime === null)) {
      return problem(
        c,
        400,
        'reminder requires timed due',
        'a relative reminder needs the task to have a due date and time',
      )
    }

    const now = nowIso()
    const id = newId()
    db.insert(reminders)
      .values({
        id,
        userId,
        taskId: body.task_id,
        type: body.type,
        minuteOffset: body.type === 'relative' ? (body.minute_offset ?? 0) : null,
        dueJson: body.due === undefined ? null : JSON.stringify(body.due),
        isAuto: false,
        fireAtUtc: null,
        firedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    // Recompute this task's fire instants (and materialize/dedupe the auto-reminder).
    await syncTaskReminders(db, body.task_id)

    const row = db.select().from(reminders).where(eq(reminders.id, id)).get()
    if (row === undefined) return problem(c, 404, 'not found')
    bus.publish({ userId, type: 'reminder.created', entity: 'reminders', ids: [id] })
    return c.json(reminderToDto(row), 201)
  })

  // PATCH /reminders/{id}
  app.openapi(updateReminderRoute, async (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus } = c.get('deps')
    const userId = auth.userId
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')

    const existing = db
      .select()
      .from(reminders)
      .where(and(eq(reminders.id, id), eq(reminders.userId, userId)))
      .get()
    if (existing === undefined) return problem(c, 404, 'not found')

    const updates: Partial<typeof reminders.$inferInsert> = { updatedAt: nowIso() }
    if (body.minute_offset !== undefined) updates.minuteOffset = body.minute_offset
    if (body.due !== undefined) updates.dueJson = JSON.stringify(body.due)
    db.update(reminders)
      .set(updates)
      .where(and(eq(reminders.id, id), eq(reminders.userId, userId)))
      .run()
    // syncTaskReminders recomputes fireAtUtc and resets firedAt when the instant changed.
    await syncTaskReminders(db, existing.taskId)

    const row = db.select().from(reminders).where(eq(reminders.id, id)).get()
    if (row === undefined) return problem(c, 404, 'not found')
    bus.publish({ userId, type: 'reminder.updated', entity: 'reminders', ids: [id] })
    return c.json(reminderToDto(row), 200)
  })

  // DELETE /reminders/{id} — hard delete; auto-reminders are recreated on the next task write.
  app.openapi(deleteReminderRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus } = c.get('deps')
    const userId = auth.userId
    const { id } = c.req.valid('param')
    const existing = db
      .select({ id: reminders.id })
      .from(reminders)
      .where(and(eq(reminders.id, id), eq(reminders.userId, userId)))
      .get()
    if (existing === undefined) return problem(c, 404, 'not found')
    db.delete(reminders)
      .where(and(eq(reminders.id, id), eq(reminders.userId, userId)))
      .run()
    bus.publish({ userId, type: 'reminder.deleted', entity: 'reminders', ids: [id] })
    return c.body(null, 204)
  })

  return app
}
