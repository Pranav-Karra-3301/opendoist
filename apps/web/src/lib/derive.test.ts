import { describe, expect, it } from 'vitest'
import type { Task } from '@/api/schemas'
import {
  activeTasks,
  buildTaskTree,
  byChildOrder,
  byDayOrder,
  dueOn,
  inboxCount,
  overdue,
  subtreeOf,
  tasksInProject,
  tasksWithLabel,
  todayCount,
  topLevel,
} from './derive'

let seq = 0
function task(overrides: Partial<Task> = {}): Task {
  seq += 1
  return {
    id: `t${String(seq).padStart(2, '0')}`,
    project_id: 'p1',
    section_id: null,
    parent_id: null,
    child_order: seq,
    day_order: seq,
    content: `task ${seq}`,
    description: '',
    priority: 4,
    due: null,
    deadline_date: null,
    duration_min: null,
    labels: [],
    is_collapsed: false,
    uncompletable: false,
    completed_at: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

function due(date: string, time: string | null = null) {
  return { date, time, string: date, recurrence: null }
}

const TODAY = '2026-07-15'

describe('derive selectors', () => {
  it('activeTasks drops completed tasks', () => {
    const open = task()
    const done = task({ completed_at: '2026-07-14T10:00:00.000Z' })
    expect(activeTasks([open, done])).toEqual([open])
  })

  it('tasksInProject filters by project id', () => {
    const a = task({ project_id: 'pA' })
    const b = task({ project_id: 'pB' })
    expect(tasksInProject([a, b], 'pA')).toEqual([a])
  })

  it('tasksWithLabel matches by name', () => {
    const a = task({ labels: ['home', 'urgent'] })
    const b = task({ labels: ['work'] })
    expect(tasksWithLabel([a, b], 'urgent')).toEqual([a])
  })

  it('dueOn matches exact date and ignores undated tasks', () => {
    const a = task({ due: due(TODAY) })
    const b = task({ due: due('2026-07-16') })
    const c = task()
    expect(dueOn([a, b, c], TODAY)).toEqual([a])
  })

  it('overdue = strictly before today', () => {
    const past = task({ due: due('2026-07-14') })
    const today = task({ due: due(TODAY) })
    const undated = task()
    expect(overdue([past, today, undated], TODAY)).toEqual([past])
  })

  it('inboxCount counts active inbox tasks only', () => {
    const inInbox = task({ project_id: 'inbox' })
    const doneInbox = task({ project_id: 'inbox', completed_at: '2026-07-14T10:00:00.000Z' })
    const elsewhere = task({ project_id: 'other' })
    expect(inboxCount([inInbox, doneInbox, elsewhere], 'inbox')).toBe(1)
  })

  it('todayCount = due today + overdue, active only', () => {
    const today = task({ due: due(TODAY) })
    const past = task({ due: due('2026-07-01') })
    const future = task({ due: due('2026-08-01') })
    const doneToday = task({ due: due(TODAY), completed_at: '2026-07-15T08:00:00.000Z' })
    expect(todayCount([today, past, future, doneToday], TODAY)).toBe(2)
  })

  it('byChildOrder sorts by child_order with stable id tiebreak', () => {
    const a = task({ child_order: 2 })
    const b = task({ child_order: 1 })
    const c = task({ child_order: 1 })
    expect(byChildOrder([a, b, c]).map((t) => t.id)).toEqual([b.id, c.id, a.id])
  })

  it('byDayOrder sorts by day_order', () => {
    const a = task({ day_order: 3 })
    const b = task({ day_order: 1 })
    expect(byDayOrder([a, b]).map((t) => t.id)).toEqual([b.id, a.id])
  })

  it('subtreeOf returns all descendants depth-first, excluding the root', () => {
    const root = task()
    const child1 = task({ parent_id: root.id, child_order: 1 })
    const child2 = task({ parent_id: root.id, child_order: 2 })
    const grand = task({ parent_id: child1.id })
    const stranger = task()
    const all = [root, child1, child2, grand, stranger]
    expect(subtreeOf(all, root.id).map((t) => t.id)).toEqual([child1.id, grand.id, child2.id])
  })

  it('topLevel keeps only parentless tasks', () => {
    const root = task()
    const child = task({ parent_id: root.id })
    expect(topLevel([root, child])).toEqual([root])
  })

  it('buildTaskTree flattens depth-first by child_order with depths', () => {
    const rootB = task({ child_order: 2 })
    const rootA = task({ child_order: 1 })
    const childA1 = task({ parent_id: rootA.id, child_order: 1 })
    const tree = buildTaskTree([rootB, rootA, childA1])
    expect(tree.map((n) => [n.task.id, n.depth])).toEqual([
      [rootA.id, 0],
      [childA1.id, 1],
      [rootB.id, 0],
    ])
  })

  it('buildTaskTree emits a collapsed node but skips its descendants', () => {
    const root = task({ is_collapsed: true })
    const child = task({ parent_id: root.id })
    const tree = buildTaskTree([root, child])
    expect(tree.map((n) => n.task.id)).toEqual([root.id])
  })

  it('buildTaskTree treats orphans (parent not in input) as roots', () => {
    const orphan = task({ parent_id: 'missing' })
    const tree = buildTaskTree([orphan])
    expect(tree).toEqual([{ task: orphan, depth: 0 }])
  })
})
