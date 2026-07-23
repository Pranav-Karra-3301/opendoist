import { type Due, type ParseContext, parseRecurrenceText } from '@opentask/core'
import { describe, expect, it } from 'vitest'
import {
  applyClose,
  applyCreate,
  applyMove,
  applyPatch,
  applyRemove,
  applyReopen,
  dueEqual,
  findTask,
  optimisticTaskFromCreate,
  taskToCreate,
} from './cache-updates'
import type { Task } from './schemas'

const ctx: ParseContext = {
  now: '2026-07-16T12:00:00Z',
  timezone: 'UTC',
  weekStart: 1,
  nextWeekDay: 1,
  weekendDay: 6,
  smartDate: true,
}

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    project_id: 'p1',
    section_id: null,
    parent_id: null,
    child_order: 0,
    day_order: 0,
    content: 'task',
    description: '',
    priority: 4,
    due: null,
    deadline_date: null,
    duration_min: null,
    labels: [],
    is_collapsed: false,
    uncompletable: false,
    completed_at: null,
    created_at: '2026-07-16T00:00:00Z',
    updated_at: '2026-07-16T00:00:00Z',
    ...overrides,
  }
}

/** A genuine `every day` due built through the core recurrence parser. */
function everyDayDue(date: string): Due {
  const rec = parseRecurrenceText('every day', ctx)
  if (rec === null) throw new Error('expected "every day" to parse')
  return { date, time: null, string: 'every day', recurrence: rec.spec }
}

describe('applyPatch', () => {
  it('updates only the targeted task and only the provided fields', () => {
    const tasks = [task({ id: 'a', content: 'old', priority: 4 }), task({ id: 'b' })]
    const out = applyPatch(tasks, 'a', { content: 'new' })
    expect(out.find((t) => t.id === 'a')?.content).toBe('new')
    expect(out.find((t) => t.id === 'a')?.priority).toBe(4)
    expect(out.find((t) => t.id === 'b')).toBe(tasks[1])
  })

  it('applies priority and due together', () => {
    const due = everyDayDue('2026-07-20')
    const out = applyPatch([task({ id: 'a' })], 'a', { priority: 1, due })
    expect(out[0]?.priority).toBe(1)
    expect(out[0]?.due).toEqual(due)
  })

  it('is a no-op for an unknown id', () => {
    const tasks = [task({ id: 'a' })]
    expect(applyPatch(tasks, 'zzz', { content: 'x' })).toEqual(tasks)
  })
})

describe('applyClose', () => {
  it('removes a non-recurring task from the active list', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' })]
    const out = applyClose(tasks, 'a', ctx)
    expect(out.map((t) => t.id)).toEqual(['b'])
  })

  it('advances a recurring "every day" due by one day and keeps the task', () => {
    const tasks = [task({ id: 'r', due: everyDayDue('2026-07-16') })]
    const out = applyClose(tasks, 'r', ctx)
    expect(out).toHaveLength(1)
    expect(out[0]?.due?.date).toBe('2026-07-17')
    expect(out[0]?.due?.string).toBe('every day')
    expect(out[0]?.due?.recurrence).not.toBeNull()
  })

  it('removes a completed parent AND its whole subtree (mirrors the server close cascade)', () => {
    const tasks = [
      task({ id: 'root' }),
      task({ id: 'child', parent_id: 'root' }),
      task({ id: 'grandchild', parent_id: 'child' }),
      task({ id: 'other' }),
    ]
    // The server close route completes the whole open subtree; the optimistic cache must match so
    // buildTaskTree never promotes an orphaned child to a top-level root (the subtasks glitch).
    expect(applyClose(tasks, 'root', ctx).map((t) => t.id)).toEqual(['other'])
  })

  it('removes only the completed leaf subtask, leaving its parent and siblings', () => {
    const tasks = [
      task({ id: 'p' }),
      task({ id: 'a', parent_id: 'p' }),
      task({ id: 'b', parent_id: 'p' }),
    ]
    expect(applyClose(tasks, 'a', ctx).map((t) => t.id)).toEqual(['p', 'b'])
  })

  it('advances a recurring parent and keeps its subtree (no cascade on the advance branch)', () => {
    const tasks = [
      task({ id: 'r', due: everyDayDue('2026-07-16') }),
      task({ id: 'kid', parent_id: 'r' }),
    ]
    const out = applyClose(tasks, 'r', ctx)
    // A recurring occurrence advances (the server does not complete children here), so the child
    // must stay put — the cascade applies only to a final completion.
    expect(out.map((t) => t.id)).toEqual(['r', 'kid'])
    expect(out.find((t) => t.id === 'r')?.due?.date).toBe('2026-07-17')
  })

  it('removes a recurring task whose series has ended (past `until`)', () => {
    const rec = parseRecurrenceText('every day', ctx)
    if (rec === null) throw new Error('expected "every day" to parse')
    const ended: Due = {
      date: '2026-07-16',
      time: null,
      string: 'every day',
      recurrence: { ...rec.spec, until: '2026-07-16' },
    }
    const out = applyClose([task({ id: 'r', due: ended })], 'r', ctx)
    expect(out).toHaveLength(0)
  })

  it('is a no-op for an unknown id', () => {
    const tasks = [task({ id: 'a' })]
    expect(applyClose(tasks, 'zzz', ctx)).toBe(tasks)
  })
})

describe('applyReopen', () => {
  it('clears completed_at on a task present in the cache', () => {
    const tasks = [task({ id: 'a', completed_at: '2026-07-16T10:00:00Z' })]
    expect(applyReopen(tasks, 'a')[0]?.completed_at).toBeNull()
  })

  it('is a no-op when the task is absent', () => {
    const tasks = [task({ id: 'a' })]
    expect(applyReopen(tasks, 'zzz')).toEqual(tasks)
  })
})

describe('applyRemove', () => {
  it('drops the task and its whole subtree', () => {
    const tasks = [
      task({ id: 'root' }),
      task({ id: 'child', parent_id: 'root' }),
      task({ id: 'grandchild', parent_id: 'child' }),
      task({ id: 'other' }),
    ]
    expect(applyRemove(tasks, 'root').map((t) => t.id)).toEqual(['other'])
  })

  it('leaves unrelated tasks intact when removing a leaf', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b', parent_id: 'a' }), task({ id: 'c' })]
    expect(applyRemove(tasks, 'b').map((t) => t.id)).toEqual(['a', 'c'])
  })
})

describe('applyMove', () => {
  it('rewrites project/section/parent on the moved task only', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' })]
    const out = applyMove(tasks, 'a', { project_id: 'p2', section_id: 's9', parent_id: null })
    expect(out[0]).toMatchObject({ project_id: 'p2', section_id: 's9', parent_id: null })
    expect(out[1]).toBe(tasks[1])
  })

  it('applies child_order when provided', () => {
    const out = applyMove([task({ id: 'a', child_order: 0 })], 'a', { child_order: 5 })
    expect(out[0]?.child_order).toBe(5)
  })
})

describe('applyCreate', () => {
  it('appends a new task', () => {
    const tasks = [task({ id: 'a' })]
    expect(applyCreate(tasks, task({ id: 'b' })).map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('replaces an existing task with the same id', () => {
    const tasks = [task({ id: 'a', content: 'old' })]
    const out = applyCreate(tasks, task({ id: 'a', content: 'new' }))
    expect(out).toHaveLength(1)
    expect(out[0]?.content).toBe('new')
  })
})

describe('optimisticTaskFromCreate', () => {
  it('fills defaults for a minimal input', () => {
    const t = optimisticTaskFromCreate({ content: 'buy milk' }, { id: 'temp-1', now: 'NOW' })
    expect(t).toMatchObject({
      id: 'temp-1',
      content: 'buy milk',
      priority: 4,
      description: '',
      labels: [],
      completed_at: null,
      created_at: 'NOW',
    })
  })

  it('carries explicit fields through', () => {
    const due = everyDayDue('2026-07-20')
    const t = optimisticTaskFromCreate(
      { content: 'x', project_id: 'p9', priority: 1, due, labels: ['home'] },
      { id: 'temp-2', now: 'NOW' },
    )
    expect(t).toMatchObject({ project_id: 'p9', priority: 1, due, labels: ['home'] })
  })
})

describe('taskToCreate', () => {
  it('extracts the create payload from a task', () => {
    const due = everyDayDue('2026-07-20')
    const t = task({ id: 'a', content: 'c', project_id: 'p2', priority: 2, labels: ['l'], due })
    expect(taskToCreate(t)).toEqual({
      content: 'c',
      description: '',
      project_id: 'p2',
      section_id: null,
      parent_id: null,
      priority: 2,
      due,
      deadline_date: null,
      deadline_time: null,
      duration_min: null,
      labels: ['l'],
      uncompletable: false,
    })
  })
})

describe('dueEqual', () => {
  it('treats null and undefined as equal to null', () => {
    expect(dueEqual(null, null)).toBe(true)
    expect(dueEqual(null, undefined)).toBe(true)
  })

  it('detects a change from a date to null', () => {
    expect(dueEqual(everyDayDue('2026-07-16'), null)).toBe(false)
  })

  it('compares structurally', () => {
    expect(dueEqual(everyDayDue('2026-07-16'), everyDayDue('2026-07-16'))).toBe(true)
    expect(dueEqual(everyDayDue('2026-07-16'), everyDayDue('2026-07-17'))).toBe(false)
  })
})

describe('findTask', () => {
  it('finds a task by id and tolerates undefined', () => {
    const tasks = [task({ id: 'a' })]
    expect(findTask(tasks, 'a')?.id).toBe('a')
    expect(findTask(tasks, 'zzz')).toBeUndefined()
    expect(findTask(undefined, 'a')).toBeUndefined()
  })
})
