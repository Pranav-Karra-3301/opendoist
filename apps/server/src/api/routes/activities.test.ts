import { describe, expect, it } from 'vitest'
import { user } from '../../db/auth-schema'
import type { Db } from '../../db/db'
import { activityLog } from '../../db/schema'
import { type ActivityEventType, logActivity } from '../../lib/activity'
import { newId } from '../../lib/ids'
import { createTestApp, json } from '../../test/helpers'

interface ActivityDto {
  id: string
  event_type: string
  entity_type: string
  entity_id: string
  project_id: string | null
  payload: unknown
  at: string
}
type ActivitiesResponse = { results: ActivityDto[]; next_cursor: string | null }

// Task G tests its own router in isolation: activity rows are logged by the OTHER
// routers (tasks, projects, …) which run as parallel stubs here, so we seed
// `activity_log` directly with controlled `at` values for deterministic ordering.
function seed(
  db: Db,
  row: {
    userId: string
    eventType: ActivityEventType
    entityType: string
    entityId: string
    projectId?: string | null
    payload?: unknown
    at: string
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
      at: row.at,
    })
    .run()
}

describe('activities router', () => {
  it('lists a task lifecycle in DESC-time order and filters by event_type', async () => {
    const t = await createTestApp()
    try {
      const { db } = t.deps
      const base = '2026-07-15T10:00:0'
      seed(db, {
        userId: t.userId,
        eventType: 'task_added',
        entityType: 'task',
        entityId: 'task1',
        projectId: 'proj1',
        at: `${base}0.000Z`,
      })
      seed(db, {
        userId: t.userId,
        eventType: 'task_updated',
        entityType: 'task',
        entityId: 'task1',
        projectId: 'proj1',
        at: `${base}1.000Z`,
      })
      seed(db, {
        userId: t.userId,
        eventType: 'task_completed',
        entityType: 'task',
        entityId: 'task1',
        projectId: 'proj1',
        at: `${base}2.000Z`,
      })
      seed(db, {
        userId: t.userId,
        eventType: 'task_deleted',
        entityType: 'task',
        entityId: 'task1',
        projectId: 'proj1',
        at: `${base}3.000Z`,
      })

      const res = await t.get('/api/v1/activities')
      expect(res.status).toBe(200)
      const body = await json<ActivitiesResponse>(res)
      expect(body.results.map((r) => r.event_type)).toEqual([
        'task_deleted',
        'task_completed',
        'task_updated',
        'task_added',
      ])
      expect(body.next_cursor).toBeNull()

      const completed = await json<ActivitiesResponse>(
        await t.get('/api/v1/activities?event_type=task_completed'),
      )
      expect(completed.results).toHaveLength(1)
      expect(completed.results[0]?.event_type).toBe('task_completed')
      expect(completed.results[0]?.entity_id).toBe('task1')
    } finally {
      t.close()
    }
  })

  it('preserves the JSON payload and entity_type filter', async () => {
    const t = await createTestApp()
    try {
      const { db } = t.deps
      seed(db, {
        userId: t.userId,
        eventType: 'task_completed',
        entityType: 'task',
        entityId: 'k1',
        projectId: 'p',
        payload: { recurring: true, next_due: '2026-07-16' },
        at: '2026-07-15T09:00:00.000Z',
      })
      seed(db, {
        userId: t.userId,
        eventType: 'label_added',
        entityType: 'label',
        entityId: 'l1',
        at: '2026-07-15T09:00:01.000Z',
      })

      const all = await json<ActivitiesResponse>(await t.get('/api/v1/activities'))
      const completed = all.results.find((r) => r.entity_id === 'k1')
      expect(completed?.payload).toEqual({ recurring: true, next_due: '2026-07-16' })

      const labels = await json<ActivitiesResponse>(
        await t.get('/api/v1/activities?entity_type=label'),
      )
      expect(labels.results).toHaveLength(1)
      expect(labels.results[0]?.entity_id).toBe('l1')
      expect(labels.results[0]?.project_id).toBeNull()
    } finally {
      t.close()
    }
  })

  it('filters by project_id', async () => {
    const t = await createTestApp()
    try {
      const { db } = t.deps
      seed(db, {
        userId: t.userId,
        eventType: 'task_added',
        entityType: 'task',
        entityId: 'x1',
        projectId: 'projA',
        at: '2026-07-15T08:00:00.000Z',
      })
      seed(db, {
        userId: t.userId,
        eventType: 'task_added',
        entityType: 'task',
        entityId: 'x2',
        projectId: 'projA',
        at: '2026-07-15T08:00:01.000Z',
      })
      seed(db, {
        userId: t.userId,
        eventType: 'task_added',
        entityType: 'task',
        entityId: 'x3',
        projectId: 'projB',
        at: '2026-07-15T08:00:02.000Z',
      })

      const res = await json<ActivitiesResponse>(await t.get('/api/v1/activities?project_id=projB'))
      expect(res.results).toHaveLength(1)
      expect(res.results[0]?.entity_id).toBe('x3')
      expect(res.results[0]?.project_id).toBe('projB')

      const a = await json<ActivitiesResponse>(await t.get('/api/v1/activities?project_id=projA'))
      expect(a.results.map((r) => r.entity_id).sort()).toEqual(['x1', 'x2'])
    } finally {
      t.close()
    }
  })

  it('walks all rows with keyset cursor pagination', async () => {
    const t = await createTestApp()
    try {
      const { db } = t.deps
      for (let i = 1; i <= 5; i++) {
        seed(db, {
          userId: t.userId,
          eventType: 'task_added',
          entityType: 'task',
          entityId: `a${i}`,
          projectId: 'proj1',
          at: `2026-07-15T10:00:00.00${i}Z`,
        })
      }

      const seen: string[] = []
      let cursor: string | null = null
      let pages = 0
      do {
        const path = `/api/v1/activities?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
        const body: ActivitiesResponse = await json<ActivitiesResponse>(await t.get(path))
        expect(body.results.length).toBeGreaterThan(0)
        expect(body.results.length).toBeLessThanOrEqual(2)
        for (const r of body.results) seen.push(r.entity_id)
        cursor = body.next_cursor
        pages++
        expect(pages).toBeLessThanOrEqual(10)
      } while (cursor !== null)

      // DESC time order, every row once, no duplicates.
      expect(seen).toEqual(['a5', 'a4', 'a3', 'a2', 'a1'])
    } finally {
      t.close()
    }
  })

  it('rejects an invalid cursor with a 400 problem', async () => {
    const t = await createTestApp()
    try {
      const res = await t.get('/api/v1/activities?cursor=%21%21%21not-b64json')
      expect(res.status).toBe(400)
      expect(res.headers.get('content-type')).toContain('application/problem+json')
      expect((await json<{ title: string }>(res)).title).toBe('invalid cursor')
    } finally {
      t.close()
    }
  })

  it('never leaks another user rows', async () => {
    const t = await createTestApp()
    try {
      const { db } = t.deps
      db.insert(user)
        .values({ id: 'foreign-user', name: 'Other', email: 'other@example.com' })
        .run()
      seed(db, {
        userId: t.userId,
        eventType: 'task_added',
        entityType: 'task',
        entityId: 'mine1',
        projectId: 'proj1',
        at: '2026-07-15T07:00:00.000Z',
      })
      seed(db, {
        userId: t.userId,
        eventType: 'task_added',
        entityType: 'task',
        entityId: 'mine2',
        projectId: 'proj1',
        at: '2026-07-15T07:00:01.000Z',
      })
      seed(db, {
        userId: 'foreign-user',
        eventType: 'task_added',
        entityType: 'task',
        entityId: 'theirs1',
        projectId: 'proj9',
        at: '2026-07-15T07:00:02.000Z',
      })
      seed(db, {
        userId: 'foreign-user',
        eventType: 'task_deleted',
        entityType: 'task',
        entityId: 'theirs2',
        projectId: 'proj9',
        at: '2026-07-15T07:00:03.000Z',
      })

      const res = await json<ActivitiesResponse>(await t.get('/api/v1/activities'))
      const ids = res.results.map((r) => r.entity_id)
      expect(ids.sort()).toEqual(['mine1', 'mine2'])
      expect(ids).not.toContain('theirs1')
      expect(ids).not.toContain('theirs2')
    } finally {
      t.close()
    }
  })

  it('logActivity rows surface through the endpoint', async () => {
    const t = await createTestApp()
    try {
      logActivity(t.deps.db, {
        userId: t.userId,
        eventType: 'filter_added',
        entityType: 'filter',
        entityId: 'f1',
        projectId: null,
        payload: { name: 'Work' },
      })
      const res = await json<ActivitiesResponse>(
        await t.get('/api/v1/activities?event_type=filter_added'),
      )
      expect(res.results).toHaveLength(1)
      expect(res.results[0]?.entity_id).toBe('f1')
      expect(res.results[0]?.payload).toEqual({ name: 'Work' })
    } finally {
      t.close()
    }
  })
})
