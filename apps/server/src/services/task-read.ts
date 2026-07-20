import type { z } from '@hono/zod-openapi'
import { eq, inArray } from 'drizzle-orm'
import type { TaskDtoSchema } from '../api/schemas'
import type { Db } from '../db/db'
import { labels as labelsTable, taskLabels, type tasks } from '../db/schema'

export type TaskRow = typeof tasks.$inferSelect
export type TaskDto = z.infer<typeof TaskDtoSchema>

/** Assemble the wire DTO for one task row; `labels` are label NAMES. */
export function taskToDto(row: TaskRow, labels: string[]): TaskDto {
  const recurrence = row.recurrence === null ? null : (JSON.parse(row.recurrence) as unknown)
  return {
    id: row.id,
    project_id: row.projectId,
    section_id: row.sectionId,
    parent_id: row.parentId,
    child_order: row.childOrder,
    content: row.content,
    description: row.description,
    priority: row.priority,
    due:
      row.dueDate === null
        ? null
        : {
            date: row.dueDate,
            time: row.dueTime,
            string: row.dueString ?? row.dueDate,
            is_recurring: recurrence !== null,
            recurrence,
          },
    deadline_date: row.deadlineDate,
    deadline_time: row.deadlineTime,
    duration_min: row.durationMin,
    day_order: row.dayOrder,
    labels,
    is_collapsed: row.isCollapsed,
    uncompletable: row.uncompletable,
    completed_at: row.completedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

/** Batch-map rows to DTOs with a single junction query over task_labels ⋈ labels. */
export function tasksToDtos(db: Db, rows: TaskRow[]): TaskDto[] {
  if (rows.length === 0) return []
  const junction = db
    .select({ taskId: taskLabels.taskId, name: labelsTable.name })
    .from(taskLabels)
    .innerJoin(labelsTable, eq(taskLabels.labelId, labelsTable.id))
    .where(
      inArray(
        taskLabels.taskId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(labelsTable.itemOrder)
    .all()
  const byTask = new Map<string, string[]>()
  for (const j of junction) {
    const list = byTask.get(j.taskId)
    if (list === undefined) byTask.set(j.taskId, [j.name])
    else list.push(j.name)
  }
  return rows.map((r) => taskToDto(r, byTask.get(r.id) ?? []))
}
