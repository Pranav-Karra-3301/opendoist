import type { Db } from '../db/db'
import { activityLog } from '../db/schema'
import { newId, nowIso } from './ids'

export const ActivityEventTypes = [
  'task_added',
  'task_updated',
  'task_completed',
  'task_uncompleted',
  'task_deleted',
  'task_restored',
  'task_moved',
  'project_added',
  'project_updated',
  'project_archived',
  'project_unarchived',
  'project_deleted',
  'project_restored',
  'section_added',
  'section_updated',
  'section_deleted',
  'section_restored',
  'label_added',
  'label_updated',
  'label_deleted',
  'filter_added',
  'filter_updated',
  'filter_deleted',
  'comment_added',
  'comment_updated',
  'comment_deleted',
] as const
export type ActivityEventType = (typeof ActivityEventTypes)[number]

export function logActivity(
  db: Db,
  row: {
    userId: string
    eventType: ActivityEventType
    entityType: string
    entityId: string
    projectId?: string | null
    payload?: unknown
  },
): void {
  db.insert(activityLog)
    .values({
      id: newId(),
      userId: row.userId,
      eventType: row.eventType,
      entityType: row.entityType,
      entityId: row.entityId,
      projectId: row.projectId ?? null,
      payload: row.payload === undefined ? null : JSON.stringify(row.payload),
      at: nowIso(),
    })
    .run()
}
