/**
 * Task C — reminders-dup guard (web side).
 *
 * The owner reported "adding a reminder duplicates the task". Task A's live recon could not
 * reproduce it; on the web the only path that could surface a task twice is the SSE stream
 * routing a `reminders` frame into the TASK cache (forcing a task refetch). It does not — a
 * `reminders` frame invalidates `qk.reminders` alone. These tests LOCK that routing so a future
 * refactor cannot silently re-point reminders at the task list.
 */
import { describe, expect, it } from 'vitest'
import { qk } from './keys'
import type { SseEvent } from './schemas'
import { sseInvalidationTarget } from './sse'

/** Every entity the SSE schema accepts (kept in lockstep with SseEventSchema). */
const ALL_ENTITIES: SseEvent['entity'][] = [
  'task',
  'project',
  'section',
  'label',
  'filter',
  'comment',
  'settings',
  'reminders',
  'push_subscriptions',
  'notification_channels',
]

describe('sseInvalidationTarget — reminders never touch the task cache', () => {
  it('routes a `reminders` frame to qk.reminders and NEVER qk.tasks', () => {
    const target = sseInvalidationTarget('reminders', ['rem-1'])
    expect(target).not.toBeNull()
    expect(target?.queryKey).toBe(qk.reminders)
    // structural guard: even a copy of the tasks key must not be what we invalidate here.
    expect(target?.queryKey).toEqual(['reminders'])
    expect(target?.queryKey).not.toEqual(qk.tasks)
  })

  it('routes a `task` frame to qk.tasks (control — the mapping is not simply broken)', () => {
    expect(sseInvalidationTarget('task', ['t-1'])?.queryKey).toBe(qk.tasks)
  })

  it('never maps any non-task entity onto the task cache', () => {
    for (const entity of ALL_ENTITIES) {
      if (entity === 'task') continue
      const target = sseInvalidationTarget(entity, ['x'])
      // may be null (e.g. filter), but if it invalidates anything it is not the task list.
      expect(target?.queryKey).not.toBe(qk.tasks)
      expect(target?.queryKey).not.toEqual(qk.tasks)
    }
  })

  it('drops a comment frame with no ids and otherwise scopes to that task', () => {
    expect(sseInvalidationTarget('comment', [])).toBeNull()
    expect(sseInvalidationTarget('comment', ['t-9'])?.queryKey).toEqual(qk.comments('t-9'))
  })
})
