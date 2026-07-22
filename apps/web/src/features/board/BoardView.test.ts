/**
 * Board View pass (Task B) — pure column-derivation contract.
 *
 * The board is a renderer over the SAME slices the list computes, so these lock the exact column
 * shape per view: the project `(No section)` column appears only when non-empty, section columns
 * follow the caller's order, cards are the top-level tasks (subtrees move with their parent), and
 * counts match the list. No DOM — the helpers are pure.
 */
import type { CompletedTask } from '@opendoist/core'
import { describe, expect, it } from 'vitest'
import type { Task } from '@/api/schemas'
import {
  completedForColumn,
  groupDropFromKey,
  inboxBoardColumns,
  projectBoardColumns,
  todayBoardColumns,
  upcomingBoardColumns,
} from './BoardView'

const BASE: Task = {
  id: 'x',
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
  deadline_time: null,
  duration_min: null,
  labels: [],
  is_collapsed: false,
  uncompletable: false,
  completed_at: null,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
}

function mk(o: Partial<Task>): Task {
  return { ...BASE, ...o }
}

function due(date: string, time: string | null = null): Task['due'] {
  return { date, time, string: date, recurrence: null, timezone: null } as Task['due']
}

describe('projectBoardColumns', () => {
  const sections = [
    { id: 's1', name: 'API' },
    { id: 's2', name: 'OS' },
  ]

  it('omits the (No section) column when there are no root tasks', () => {
    const active = [mk({ id: 'a', section_id: 's1' })]
    const cols = projectBoardColumns(active, sections, 'p1')
    expect(cols.map((c) => c.key)).toEqual(['section:s1', 'section:s2'])
  })

  it('leads with (No section) when root tasks exist, then sections in the given order', () => {
    const active = [mk({ id: 'root', section_id: null }), mk({ id: 'a', section_id: 's1' })]
    const cols = projectBoardColumns(active, sections, 'p1')
    expect(cols.map((c) => c.label)).toEqual(['(No section)', 'API', 'OS'])
    expect(cols[0]?.addContext).toEqual({ projectId: 'p1' })
    expect(cols[1]?.addContext).toEqual({ projectId: 'p1', sectionId: 's1' })
  })

  it('counts and renders only top-level cards (subtasks are excluded, they move with the parent)', () => {
    const active = [
      mk({ id: 'p', section_id: 's1', parent_id: null, child_order: 1 }),
      mk({ id: 'c', section_id: 's1', parent_id: 'p', child_order: 0 }),
    ]
    const col = projectBoardColumns(active, sections, 'p1').find((c) => c.key === 'section:s1')
    expect(col?.count).toBe(1)
    expect(col?.tasks.map((t) => t.id)).toEqual(['p'])
  })

  it('orders cards by child_order', () => {
    const active = [
      mk({ id: 'b', section_id: 's1', child_order: 2 }),
      mk({ id: 'a', section_id: 's1', child_order: 1 }),
    ]
    const col = projectBoardColumns(active, sections, 'p1').find((c) => c.key === 'section:s1')
    expect(col?.tasks.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('marks section columns with their section kind for the ⋯ menu', () => {
    const cols = projectBoardColumns([mk({ id: 'a', section_id: 's1' })], sections, 'p1')
    expect(cols[0]?.kind).toEqual({ type: 'section', sectionId: 's1', projectId: 'p1' })
  })

  it('drops move to the section (or root) and reorders by child_order', () => {
    const active = [mk({ id: 'root', section_id: null }), mk({ id: 'a', section_id: 's1' })]
    const cols = projectBoardColumns(active, sections, 'p1')
    expect(cols[0]?.drop).toEqual({ type: 'section', projectId: 'p1', sectionId: null })
    expect(cols[1]?.drop).toEqual({ type: 'section', projectId: 'p1', sectionId: 's1' })
    expect(cols.every((c) => c.reorder === 'child_order')).toBe(true)
  })
})

describe('inboxBoardColumns', () => {
  it('is one unlabeled column of top-level tasks, child-ordered', () => {
    const active = [
      mk({ id: 'b', child_order: 2 }),
      mk({ id: 'a', child_order: 1 }),
      mk({ id: 'sub', parent_id: 'a', child_order: 0 }),
    ]
    const cols = inboxBoardColumns(active, 'inbox')
    expect(cols).toHaveLength(1)
    expect(cols[0]?.label).toBe('')
    expect(cols[0]?.tasks.map((t) => t.id)).toEqual(['a', 'b'])
    expect(cols[0]?.addContext).toEqual({ projectId: 'inbox' })
    expect(cols[0]?.drop).toEqual({ type: 'section', projectId: 'inbox', sectionId: null })
    expect(cols[0]?.reorder).toBe('child_order')
  })
})

describe('todayBoardColumns', () => {
  const today = '2026-07-22'

  it('builds an Overdue column (no add tile) and a "‹Mon D› · Today" column implying today', () => {
    const active = [mk({ id: 'o1', due: due('2026-07-20') }), mk({ id: 't1', due: due(today) })]
    const cols = todayBoardColumns(active, today)
    expect(cols.map((c) => c.key)).toEqual(['overdue', 'today'])
    expect(cols[0]?.kind).toEqual({ type: 'overdue' })
    expect(cols[0]?.addContext).toBeUndefined()
    expect(cols[0]?.tasks.map((t) => t.id)).toEqual(['o1'])
    expect(cols[1]?.label).toBe('Jul 22 · Today')
    expect(cols[1]?.impliedDate).toBe(today)
    expect(cols[1]?.addContext).toEqual({ dueDate: today })
    expect(cols[1]?.tasks.map((t) => t.id)).toEqual(['t1'])
  })

  it('Overdue accepts no drop/reorder; the Today column reschedules-to-today and reorders by day_order', () => {
    const cols = todayBoardColumns([mk({ id: 't1', due: due(today) })], today)
    expect(cols[0]?.drop).toEqual({ type: 'none' })
    expect(cols[0]?.reorder).toBe('none')
    expect(cols[1]?.drop).toEqual({ type: 'due', date: today })
    expect(cols[1]?.reorder).toBe('day_order')
  })

  it('sorts overdue by date then time', () => {
    const active = [
      mk({ id: 'later', due: due('2026-07-21', '09:00') }),
      mk({ id: 'earlier', due: due('2026-07-20') }),
    ]
    const cols = todayBoardColumns(active, today)
    expect(cols[0]?.tasks.map((t) => t.id)).toEqual(['earlier', 'later'])
  })
})

describe('upcomingBoardColumns', () => {
  it('is one column per day, each implying its date with a dueDate add context', () => {
    const today = '2026-07-22'
    const days = [today, '2026-07-23']
    const byDay = new Map<string, Task[]>([
      [today, [mk({ id: 'a', due: due(today) })]],
      ['2026-07-23', []],
    ])
    const cols = upcomingBoardColumns(days, byDay, today)
    expect(cols.map((c) => c.key)).toEqual(['day:2026-07-22', 'day:2026-07-23'])
    expect(cols[0]?.label).toContain('Today')
    expect(cols[0]?.impliedDate).toBe(today)
    expect(cols[0]?.addContext).toEqual({ dueDate: today })
    expect(cols[1]?.count).toBe(0)
    expect(cols[0]?.drop).toEqual({ type: 'due', date: today })
    expect(cols[0]?.reorder).toBe('day_order')
  })
})

describe('completedForColumn', () => {
  function done(o: Partial<CompletedTask> & { id: string }): CompletedTask {
    return {
      content: 'done',
      project_id: 'p1',
      section_id: null,
      due: null,
      priority: 4,
      completed_at: '2026-07-21T10:00:00.000Z',
      ...o,
    }
  }

  const sections = [{ id: 's1', name: 'API' }]

  it('attributes section rows to their section column and null-section rows to (No section)', () => {
    const active = [mk({ id: 'root', section_id: null }), mk({ id: 'a', section_id: 's1' })]
    const cols = projectBoardColumns(active, sections, 'p1')
    const rows = [done({ id: 'c1', section_id: 's1' }), done({ id: 'c2', section_id: null })]
    const noSection = cols.find((c) => c.key === '__no_section__')
    const api = cols.find((c) => c.key === 'section:s1')
    expect(noSection && completedForColumn(noSection, rows).map((t) => t.id)).toEqual(['c2'])
    expect(api && completedForColumn(api, rows).map((t) => t.id)).toEqual(['c1'])
  })

  it('gives the single inbox column every row of its project-scoped list', () => {
    const col = inboxBoardColumns([mk({ id: 'a' })], 'inbox')[0]
    const rows = [done({ id: 'c1', section_id: 's1' }), done({ id: 'c2' })]
    expect(col && completedForColumn(col, rows).map((t) => t.id)).toEqual(['c1', 'c2'])
  })

  it('attributes rows to day-implied columns by due date, and none to Overdue', () => {
    const today = '2026-07-22'
    const cols = todayBoardColumns([mk({ id: 't1', due: due(today) })], today)
    const rows = [
      done({ id: 'c1', due: { date: today } }),
      done({ id: 'c2', due: { date: '2026-07-20' } }),
      done({ id: 'c3', due: null }),
    ]
    const [overdueCol, todayCol] = cols
    expect(overdueCol && completedForColumn(overdueCol, rows)).toEqual([])
    expect(todayCol && completedForColumn(todayCol, rows).map((t) => t.id)).toEqual(['c1'])
  })

  it('attributes nothing to grouped (pipeline) columns — the deviating list shows a flat section', () => {
    const col = {
      key: 'priority:1',
      label: 'Priority 1',
      count: 0,
      tasks: [],
      kind: { type: 'plain' } as const,
      drop: groupDropFromKey('priority:1'),
      reorder: 'none' as const,
    }
    expect(completedForColumn(col, [done({ id: 'c1', priority: 1 })])).toEqual([])
  })
})

describe('groupDropFromKey', () => {
  it('maps priority buckets to a priority drop (1..4 only)', () => {
    expect(groupDropFromKey('priority:1')).toEqual({ type: 'priority', priority: 1 })
    expect(groupDropFromKey('priority:4')).toEqual({ type: 'priority', priority: 4 })
    expect(groupDropFromKey('priority:9')).toEqual({ type: 'none' })
  })

  it('maps label buckets, with label:none carrying a null label', () => {
    expect(groupDropFromKey('label:work')).toEqual({ type: 'label', label: 'work' })
    expect(groupDropFromKey('label:none')).toEqual({ type: 'label', label: null })
  })

  it('maps date buckets: today/tomorrow relative, day:ISO absolute, no-date clears', () => {
    expect(groupDropFromKey('today')).toEqual({ type: 'dueToday' })
    expect(groupDropFromKey('tomorrow')).toEqual({ type: 'dueTomorrow' })
    expect(groupDropFromKey('day:2026-07-25')).toEqual({ type: 'due', date: '2026-07-25' })
    expect(groupDropFromKey('no-date')).toEqual({ type: 'due', date: null })
  })

  it('disables overdue, later, project, and none (all) buckets', () => {
    expect(groupDropFromKey('overdue')).toEqual({ type: 'none' })
    expect(groupDropFromKey('later')).toEqual({ type: 'none' })
    expect(groupDropFromKey('project:p1')).toEqual({ type: 'none' })
    expect(groupDropFromKey('all')).toEqual({ type: 'none' })
  })
})
