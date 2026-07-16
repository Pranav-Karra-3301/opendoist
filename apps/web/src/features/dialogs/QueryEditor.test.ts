import type { FilterContext, FilterTaskView } from '@opendoist/core'
import { describe, expect, it } from 'vitest'
import { computeQueryState } from './QueryEditor'

function taskView(overrides: Partial<FilterTaskView> = {}): FilterTaskView {
  return {
    id: 't1',
    content: 'Task',
    description: '',
    dueDate: null,
    dueTime: null,
    isRecurring: false,
    deadline: null,
    priority: 4,
    labels: [],
    projectId: 'p1',
    projectName: 'Inbox',
    sectionName: null,
    parentId: null,
    createdAt: '2026-07-15T00:00:00Z',
    uncompletable: false,
    ...overrides,
  }
}

const ctx: FilterContext = {
  now: '2026-07-15T12:00:00Z', // today (UTC) = 2026-07-15
  timezone: 'UTC',
  weekStart: 1,
  nextWeekDay: 1,
  weekendDay: 6,
  projects: new Map([['p1', { name: 'Inbox', parentId: null }]]),
}

const dueToday = taskView({ id: 'today1', dueDate: '2026-07-15' })
const overdue = taskView({ id: 'od1', dueDate: '2026-07-10' })

describe('computeQueryState', () => {
  it('reports an empty query', () => {
    expect(computeQueryState('', [dueToday], ctx)).toEqual({ status: 'empty' })
    expect(computeQueryState('   ', [dueToday], ctx)).toEqual({ status: 'empty' })
  })

  it('reports a syntax error with the caret position from the core parser', () => {
    const state = computeQueryState('today &', [dueToday], ctx)
    expect(state.status).toBe('error')
    if (state.status !== 'error') throw new Error('expected error state')
    // '&' with no right operand: the parser flags the end-of-query position (input length 7).
    expect(state.position).toBe(7)
    expect(state.message.length).toBeGreaterThan(0)
  })

  it('splits a comma query into one pane per parsed pane (plan: `a, b` → 2 panes)', () => {
    const state = computeQueryState('a, b', [dueToday, overdue], ctx)
    expect(state.status).toBe('ok')
    if (state.status !== 'ok') throw new Error('expected ok state')
    expect(state.panes).toHaveLength(2)
  })

  it('reports live per-pane match counts', () => {
    const state = computeQueryState('today, overdue', [dueToday, overdue], ctx)
    expect(state.status).toBe('ok')
    if (state.status !== 'ok') throw new Error('expected ok state')
    expect(state.panes).toHaveLength(2)
    expect(state.panes[0]?.count).toBe(1) // only dueToday matches `today`
    expect(state.panes[1]?.count).toBe(1) // only overdue matches `overdue`
  })

  it('returns a single pane for a comma-free query', () => {
    const state = computeQueryState('today', [dueToday, overdue], ctx)
    expect(state.status).toBe('ok')
    if (state.status !== 'ok') throw new Error('expected ok state')
    expect(state.panes).toHaveLength(1)
    expect(state.panes[0]?.count).toBe(1)
  })
})
