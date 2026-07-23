import type { FilterTaskView } from '@opentask/core'
import { describe, expect, it } from 'vitest'
import type { Task } from '@/api/schemas'
import { labelViewTasks, pickDtos } from './FilterPane'

function view(id: string, labels: string[]): FilterTaskView {
  return {
    id,
    content: id,
    description: '',
    dueDate: null,
    dueTime: null,
    isRecurring: false,
    deadline: null,
    priority: 4,
    labels,
    projectId: 'p1',
    projectName: 'Inbox',
    sectionName: null,
    parentId: null,
    createdAt: '2026-07-15T00:00:00Z',
    uncompletable: false,
  }
}

function dto(id: string): Task {
  return {
    id,
    project_id: 'p1',
    section_id: null,
    parent_id: null,
    child_order: 0,
    day_order: 0,
    content: id,
    description: '',
    priority: 4,
    due: null,
    deadline_date: null,
    duration_min: null,
    labels: [],
    is_collapsed: false,
    uncompletable: false,
    completed_at: null,
    created_at: '2026-07-15T00:00:00Z',
    updated_at: '2026-07-15T00:00:00Z',
  }
}

describe('labelViewTasks', () => {
  it('matches the label name case-insensitively', () => {
    const tasks = [view('a', ['Work']), view('b', ['work', 'home']), view('c', [])]
    expect(labelViewTasks(tasks, 'work').map((t) => t.id)).toEqual(['a', 'b'])
    expect(labelViewTasks(tasks, 'HOME').map((t) => t.id)).toEqual(['b'])
    expect(labelViewTasks(tasks, 'missing')).toEqual([])
  })
})

describe('pickDtos', () => {
  it('maps views to DTOs in order, dropping ids not in the cache', () => {
    const byId = new Map([dto('a'), dto('c')].map((t) => [t.id, t]))
    const result = pickDtos([view('a', []), view('b', []), view('c', [])], byId)
    expect(result.map((t) => t.id)).toEqual(['a', 'c'])
  })

  it('returns an empty array when nothing resolves', () => {
    expect(pickDtos([view('x', [])], new Map())).toEqual([])
  })
})
