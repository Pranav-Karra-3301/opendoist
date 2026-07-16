import { describe, expect, it } from 'vitest'
import { ActivityEventSchema, CompletedTaskSchema, CreatedApiTokenSchema } from './dtos'

describe('ActivityEventSchema', () => {
  it('tolerates unknown event_type strings', () => {
    const event = ActivityEventSchema.parse({
      id: 'a1',
      event_type: 'task_teleported',
      entity_id: 't1',
      at: '2026-07-15T10:00:00.000Z',
    })
    expect(event.event_type).toBe('task_teleported')
  })

  it('defaults a missing payload and optional top-level fields', () => {
    const event = ActivityEventSchema.parse({
      id: 'a2',
      event_type: 'task_added',
      entity_id: 't2',
      at: '2026-07-15T10:00:00.000Z',
    })
    expect(event.payload).toEqual({ content: '', project_name: null, meta: {} })
    expect(event.entity_type).toBe('')
    expect(event.project_id).toBeNull()
  })

  it('keeps event-specific payload data under payload.meta', () => {
    const event = ActivityEventSchema.parse({
      id: 'a3',
      event_type: 'task_moved',
      entity_type: 'task',
      entity_id: 't3',
      project_id: 'p1',
      at: '2026-07-15T11:00:00.000Z',
      payload: { content: 'Buy milk', project_name: 'Chores', meta: { from_project_id: 'p0' } },
    })
    expect(event.payload.content).toBe('Buy milk')
    expect(event.payload.project_name).toBe('Chores')
    expect(event.payload.meta).toEqual({ from_project_id: 'p0' })
  })
})

describe('CompletedTaskSchema', () => {
  it('parses a full phase-3 TaskDto row, stripping the fields it does not need', () => {
    const fullTaskDto = {
      id: 't1',
      project_id: 'p1',
      section_id: null,
      parent_id: null,
      child_order: 3,
      day_order: -1,
      content: 'Ship phase 5',
      description: 'all of it',
      priority: 2,
      due: { date: '2026-07-14', time: null, string: 'jul 14', is_recurring: false },
      deadline_date: null,
      duration_min: null,
      labels: ['work'],
      is_collapsed: false,
      uncompletable: false,
      completed_at: '2026-07-15T12:34:56.000Z',
      created_at: '2026-07-10T09:00:00.000Z',
      updated_at: '2026-07-15T12:34:56.000Z',
    }
    expect(CompletedTaskSchema.parse(fullTaskDto)).toEqual({
      id: 't1',
      content: 'Ship phase 5',
      project_id: 'p1',
      priority: 2,
      completed_at: '2026-07-15T12:34:56.000Z',
    })
  })
})

describe('CreatedApiTokenSchema', () => {
  const base = {
    id: 'k1',
    name: 'ci token',
    scope: 'read' as const,
    start: 'od_3fa9',
    createdAt: '2026-07-15T10:00:00.000Z',
    lastUsedAt: null,
  }

  it('accepts tokens with the od_ prefix', () => {
    expect(CreatedApiTokenSchema.parse({ ...base, token: 'od_abc123' }).token).toBe('od_abc123')
  })

  it('rejects tokens not starting with od_', () => {
    expect(() => CreatedApiTokenSchema.parse({ ...base, token: 'sk_abc123' })).toThrow()
  })
})
