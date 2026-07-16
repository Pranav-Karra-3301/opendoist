import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, asc, eq, gt, isNull, or, type SQL } from 'drizzle-orm'
import type { AppEnv } from '../../app'
import type { Db } from '../../db/db'
import { attachments, comments, tasks } from '../../db/schema'
import { logActivity } from '../../lib/activity'
import { newId, nowIso } from '../../lib/ids'
import { decodeCursor, encodeCursor, ListQuerySchema } from '../../lib/pagination'
import { problem } from '../../lib/problem'
import { CommentDtoSchema, IdSchema } from '../schemas'
import { attachmentToDto } from './attachments'

type CommentRow = typeof comments.$inferSelect
type AttachmentRow = typeof attachments.$inferSelect

const CommentListSchema = z.object({
  results: z.array(CommentDtoSchema),
  next_cursor: z.string().nullable(),
})
const CreateCommentSchema = z.object({
  task_id: IdSchema,
  content: z.string().min(1),
  attachment_id: IdSchema.optional(),
})
const UpdateCommentSchema = z.object({ content: z.string().min(1) })
const IdParam = z.object({
  id: z
    .string()
    .min(1)
    .openapi({ param: { name: 'id', in: 'path' } }),
})
// Annotate the element type so each object is `{ [scheme]: string[] }`; a bare array literal
// infers each entry with the *other* key as `?: undefined`, which is not a SecurityRequirementObject.
const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }]

function commentToDto(comment: CommentRow, attachment: AttachmentRow | null) {
  return {
    id: comment.id,
    task_id: comment.taskId,
    content: comment.content,
    attachment: attachment === null ? null : attachmentToDto(attachment),
    created_at: comment.createdAt,
    updated_at: comment.updatedAt,
  }
}

/** The task, if it exists, belongs to the user, and is not soft-deleted; else undefined. */
function resolveTask(db: Db, userId: string, taskId: string) {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
    .get()
}

function loadAttachment(db: Db, attachmentId: string | null): AttachmentRow | null {
  if (attachmentId === null) return null
  return db.select().from(attachments).where(eq(attachments.id, attachmentId)).get() ?? null
}

const listRoute = createRoute({
  method: 'get',
  path: '/comments',
  tags: ['comments'],
  security,
  request: { query: ListQuerySchema.extend({ task_id: IdSchema }) },
  responses: {
    200: {
      description: 'Comments on a task, oldest first',
      content: { 'application/json': { schema: CommentListSchema } },
    },
    400: { description: 'Invalid cursor' },
    404: { description: 'Task not found' },
  },
})

const createCommentRoute = createRoute({
  method: 'post',
  path: '/comments',
  tags: ['comments'],
  security,
  request: {
    body: { required: true, content: { 'application/json': { schema: CreateCommentSchema } } },
  },
  responses: {
    201: {
      description: 'Created comment',
      content: { 'application/json': { schema: CommentDtoSchema } },
    },
    400: { description: 'Unknown attachment' },
    404: { description: 'Task not found' },
  },
})

const patchRoute = createRoute({
  method: 'patch',
  path: '/comments/{id}',
  tags: ['comments'],
  security,
  request: {
    params: IdParam,
    body: { required: true, content: { 'application/json': { schema: UpdateCommentSchema } } },
  },
  responses: {
    200: {
      description: 'Updated comment',
      content: { 'application/json': { schema: CommentDtoSchema } },
    },
    404: { description: 'Comment not found' },
  },
})

const deleteRoute = createRoute({
  method: 'delete',
  path: '/comments/{id}',
  tags: ['comments'],
  security,
  request: { params: IdParam },
  responses: {
    204: { description: 'Deleted' },
    404: { description: 'Comment not found' },
  },
})

export const commentsRoutes = () => {
  const app = new OpenAPIHono<AppEnv>()

  app.openapi(listRoute, (c) => {
    const { db } = c.get('deps')
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { task_id, cursor, limit } = c.req.valid('query')
    if (resolveTask(db, auth.userId, task_id) === undefined) return problem(c, 404, 'not found')

    const conditions: (SQL | undefined)[] = [
      eq(comments.taskId, task_id),
      isNull(comments.deletedAt),
    ]
    if (cursor !== undefined) {
      const cur = decodeCursor(cursor)
      if (cur === null || cur.created_at === undefined || cur.id === undefined) {
        return problem(c, 400, 'invalid cursor')
      }
      const curAt = String(cur.created_at)
      const curId = String(cur.id)
      conditions.push(
        or(
          gt(comments.createdAt, curAt),
          and(eq(comments.createdAt, curAt), gt(comments.id, curId)),
        ),
      )
    }

    const rows = db
      .select()
      .from(comments)
      .leftJoin(attachments, eq(comments.attachmentId, attachments.id))
      .where(and(...conditions))
      .orderBy(asc(comments.createdAt), asc(comments.id))
      .limit(limit + 1)
      .all()
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const results = page.map((r) => commentToDto(r.comments, r.attachments))
    const last = page.at(-1)
    const next_cursor =
      hasMore && last !== undefined
        ? encodeCursor({ created_at: last.comments.createdAt, id: last.comments.id })
        : null
    return c.json({ results, next_cursor }, 200)
  })

  app.openapi(createCommentRoute, (c) => {
    const { db, bus } = c.get('deps')
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const body = c.req.valid('json')
    const task = resolveTask(db, auth.userId, body.task_id)
    if (task === undefined) return problem(c, 404, 'not found')

    let attachment: AttachmentRow | null = null
    if (body.attachment_id !== undefined) {
      attachment =
        db
          .select()
          .from(attachments)
          .where(and(eq(attachments.id, body.attachment_id), eq(attachments.userId, auth.userId)))
          .get() ?? null
      if (attachment === null) return problem(c, 400, 'invalid attachment')
    }

    const now = nowIso()
    const id = newId()
    const row = db
      .insert(comments)
      .values({
        id,
        userId: auth.userId,
        taskId: body.task_id,
        content: body.content,
        attachmentId: body.attachment_id ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()
    logActivity(db, {
      userId: auth.userId,
      eventType: 'comment_added',
      entityType: 'comment',
      entityId: id,
      projectId: task.projectId,
    })
    bus.publish({
      userId: auth.userId,
      type: 'comment.created',
      entity: 'comment',
      ids: [id, body.task_id],
    })
    return c.json(commentToDto(row, attachment), 201)
  })

  app.openapi(patchRoute, (c) => {
    const { db, bus } = c.get('deps')
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { id } = c.req.valid('param')
    const { content } = c.req.valid('json')
    const existing = db
      .select()
      .from(comments)
      .where(and(eq(comments.id, id), eq(comments.userId, auth.userId), isNull(comments.deletedAt)))
      .get()
    if (existing === undefined) return problem(c, 404, 'not found')

    const row = db
      .update(comments)
      .set({ content, updatedAt: nowIso() })
      .where(eq(comments.id, id))
      .returning()
      .get()
    const task = db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, existing.taskId))
      .get()
    logActivity(db, {
      userId: auth.userId,
      eventType: 'comment_updated',
      entityType: 'comment',
      entityId: id,
      projectId: task?.projectId ?? null,
    })
    bus.publish({
      userId: auth.userId,
      type: 'comment.updated',
      entity: 'comment',
      ids: [id, existing.taskId],
    })
    return c.json(commentToDto(row, loadAttachment(db, row.attachmentId)), 200)
  })

  app.openapi(deleteRoute, (c) => {
    const { db, bus } = c.get('deps')
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { id } = c.req.valid('param')
    const existing = db
      .select()
      .from(comments)
      .where(and(eq(comments.id, id), eq(comments.userId, auth.userId), isNull(comments.deletedAt)))
      .get()
    if (existing === undefined) return problem(c, 404, 'not found')

    db.update(comments).set({ deletedAt: nowIso() }).where(eq(comments.id, id)).run()
    const task = db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, existing.taskId))
      .get()
    logActivity(db, {
      userId: auth.userId,
      eventType: 'comment_deleted',
      entityType: 'comment',
      entityId: id,
      projectId: task?.projectId ?? null,
    })
    bus.publish({
      userId: auth.userId,
      type: 'comment.deleted',
      entity: 'comment',
      ids: [id, existing.taskId],
    })
    return c.body(null, 204)
  })

  return app
}
