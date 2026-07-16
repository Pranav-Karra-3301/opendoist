import { describe, expect, test } from 'vitest'
import type { FilterContext, FilterTaskView } from './types'
import { applyViewFilter, groupTasks, sortTasks, splitPanesRaw } from './view'

// Wed 2026-07-15, 17:00 wall clock in New York.
const ctx: FilterContext = {
  now: '2026-07-15T21:00:00Z',
  timezone: 'America/New_York',
  weekStart: 1,
  nextWeekDay: 1,
  weekendDay: 6,
  projects: new Map([
    ['P1', { name: 'Work', parentId: null }],
    ['P2', { name: 'Home', parentId: null }],
    ['P3', { name: 'Errands', parentId: null }],
  ]),
}

type Seed = Pick<FilterTaskView, 'id' | 'content' | 'projectId' | 'projectName'>
function makeTask(over: Partial<FilterTaskView> & Seed): FilterTaskView {
  return {
    description: '',
    dueDate: null,
    dueTime: null,
    isRecurring: false,
    deadline: null,
    priority: 4,
    labels: [],
    sectionName: null,
    parentId: null,
    createdAt: '2026-07-01T12:00:00Z',
    uncompletable: false,
    ...over,
  }
}
const ids = (tasks: FilterTaskView[]) => tasks.map((t) => t.id)

// 8-task fixture spanning every date bucket (§ plan Task C).
const o1 = makeTask({
  id: 'o1',
  content: 'Overdue past date',
  projectId: 'P1',
  projectName: 'Work',
  dueDate: '2026-07-13',
  priority: 1,
  labels: ['work'],
  createdAt: '2026-07-01T08:00:00Z',
})
const o2 = makeTask({
  id: 'o2',
  content: 'Overdue today by time',
  projectId: 'P1',
  projectName: 'Work',
  dueDate: '2026-07-15',
  dueTime: '16:00', // one hour before now → overdue
  priority: 2,
  labels: ['home'],
  createdAt: '2026-07-02T08:00:00Z',
})
const td = makeTask({
  id: 'td',
  content: 'Today all-day',
  projectId: 'P2',
  projectName: 'Home',
  dueDate: '2026-07-15',
  priority: 1,
  labels: ['work', 'home'],
  createdAt: '2026-07-03T08:00:00Z',
})
const tm = makeTask({
  id: 'tm',
  content: 'Tomorrow morning',
  projectId: 'P2',
  projectName: 'Home',
  dueDate: '2026-07-16',
  dueTime: '09:00',
  priority: 3,
  createdAt: '2026-07-04T08:00:00Z',
})
const su = makeTask({
  id: 'su',
  content: 'Sunday chore',
  projectId: 'P1',
  projectName: 'Work',
  dueDate: '2026-07-19', // diff 4 → Sunday
  priority: 4,
  labels: ['errands'],
  createdAt: '2026-07-05T08:00:00Z',
})
const mo = makeTask({
  id: 'mo',
  content: 'Monday chore',
  projectId: 'P3',
  projectName: 'Errands',
  dueDate: '2026-07-20', // diff 5 → Monday
  priority: 2,
  labels: ['home'],
  createdAt: '2026-07-06T08:00:00Z',
})
const lt = makeTask({
  id: 'lt',
  content: 'Later task',
  projectId: 'P3',
  projectName: 'Errands',
  dueDate: '2026-07-25', // diff 10 → Later
  priority: 1,
  createdAt: '2026-07-07T08:00:00Z',
})
const nd = makeTask({
  id: 'nd',
  content: 'Someday',
  projectId: 'P2',
  projectName: 'Home',
  priority: 4,
  labels: ['work'],
  createdAt: '2026-07-08T08:00:00Z',
})
const fixture = [o1, o2, td, tm, su, mo, lt, nd]

describe('applyViewFilter', () => {
  const none = { priority: null, label: null, due: null } as const

  test('all-null filter is a no-op', () => {
    expect(applyViewFilter(fixture, none, ctx)).toHaveLength(8)
  })
  test('priority → exact match', () => {
    expect(ids(applyViewFilter(fixture, { ...none, priority: 1 }, ctx))).toEqual(['o1', 'td', 'lt'])
  })
  test('label membership is case-insensitive', () => {
    expect(ids(applyViewFilter(fixture, { ...none, label: 'HOME' }, ctx))).toEqual([
      'o2',
      'td',
      'mo',
    ])
  })
  test('due has-date drops undated tasks', () => {
    const out = applyViewFilter(fixture, { ...none, due: 'has-date' }, ctx)
    expect(out).toHaveLength(7)
    expect(ids(out)).not.toContain('nd')
  })
  test('due no-date keeps only undated tasks', () => {
    expect(ids(applyViewFilter(fixture, { ...none, due: 'no-date' }, ctx))).toEqual(['nd'])
  })
  test('due overdue = past date or today with a passed time', () => {
    expect(ids(applyViewFilter(fixture, { ...none, due: 'overdue' }, ctx))).toEqual(['o1', 'o2'])
  })
  test('all-day task due today is not overdue', () => {
    expect(ids(applyViewFilter([td], { ...none, due: 'overdue' }, ctx))).toEqual([])
  })
  test('fields AND together', () => {
    expect(ids(applyViewFilter(fixture, { ...none, priority: 1, label: 'work' }, ctx))).toEqual([
      'o1',
      'td',
    ])
  })
  test('is non-mutating', () => {
    const input = [...fixture]
    applyViewFilter(input, { ...none, priority: 1 }, ctx)
    expect(ids(input)).toEqual(ids(fixture))
  })
})

describe('sortTasks', () => {
  test('manual keeps input order; desc reverses it', () => {
    const input = [td, o1, nd]
    expect(ids(sortTasks(input, 'manual', 'asc', ctx))).toEqual(['td', 'o1', 'nd'])
    expect(ids(sortTasks(input, 'manual', 'desc', ctx))).toEqual(['nd', 'o1', 'td'])
  })
  test('date asc orders by date then time with all-day first, no-date last', () => {
    // same date 2026-07-15: td (all-day = 00:00) precedes o2 (16:00)
    expect(ids(sortTasks(fixture, 'date', 'asc', ctx))).toEqual([
      'o1',
      'td',
      'o2',
      'tm',
      'su',
      'mo',
      'lt',
      'nd',
    ])
  })
  test('date desc is the exact reverse (no-date first)', () => {
    expect(ids(sortTasks(fixture, 'date', 'desc', ctx))).toEqual([
      'nd',
      'lt',
      'mo',
      'su',
      'tm',
      'o2',
      'td',
      'o1',
    ])
  })
  test('added sorts by createdAt ascending', () => {
    const a = makeTask({
      id: 'a',
      content: 'a',
      projectId: 'P1',
      projectName: 'Work',
      createdAt: '2026-07-05T00:00:00Z',
    })
    const b = makeTask({
      id: 'b',
      content: 'b',
      projectId: 'P1',
      projectName: 'Work',
      createdAt: '2026-07-01T00:00:00Z',
    })
    const c = makeTask({
      id: 'c',
      content: 'c',
      projectId: 'P1',
      projectName: 'Work',
      createdAt: '2026-07-03T00:00:00Z',
    })
    expect(ids(sortTasks([a, b, c], 'added', 'asc', ctx))).toEqual(['b', 'c', 'a'])
    expect(ids(sortTasks([a, b, c], 'added', 'desc', ctx))).toEqual(['a', 'c', 'b'])
  })
  test('priority puts p1 first and breaks ties by due date', () => {
    const p1a = makeTask({
      id: 'p1a',
      content: 'later',
      projectId: 'P1',
      projectName: 'Work',
      priority: 1,
      dueDate: '2026-07-20',
    })
    const p1b = makeTask({
      id: 'p1b',
      content: 'sooner',
      projectId: 'P1',
      projectName: 'Work',
      priority: 1,
      dueDate: '2026-07-10',
    })
    const p2 = makeTask({
      id: 'p2',
      content: 'low',
      projectId: 'P1',
      projectName: 'Work',
      priority: 2,
      dueDate: '2026-07-01',
    })
    expect(ids(sortTasks([p1a, p1b, p2], 'priority', 'asc', ctx))).toEqual(['p1b', 'p1a', 'p2'])
  })
  test('alphabetical is case-insensitive', () => {
    const banana = makeTask({ id: '1', content: 'banana', projectId: 'P1', projectName: 'Work' })
    const apple = makeTask({ id: '2', content: 'Apple', projectId: 'P1', projectName: 'Work' })
    const cherry = makeTask({ id: '3', content: 'cherry', projectId: 'P1', projectName: 'Work' })
    expect(ids(sortTasks([banana, apple, cherry], 'alphabetical', 'asc', ctx))).toEqual([
      '2',
      '1',
      '3',
    ])
    expect(ids(sortTasks([banana, apple, cherry], 'alphabetical', 'desc', ctx))).toEqual([
      '3',
      '1',
      '2',
    ])
  })
  test('is stable for equal keys', () => {
    const s1 = makeTask({
      id: 's1',
      content: 'x',
      projectId: 'P1',
      projectName: 'Work',
      priority: 2,
    })
    const s2 = makeTask({
      id: 's2',
      content: 'x',
      projectId: 'P1',
      projectName: 'Work',
      priority: 2,
    })
    expect(ids(sortTasks([s1, s2], 'priority', 'asc', ctx))).toEqual(['s1', 's2'])
  })
  test('does not mutate the input array', () => {
    const input = [...fixture]
    sortTasks(input, 'date', 'asc', ctx)
    expect(ids(input)).toEqual(ids(fixture))
  })
})

describe('groupTasks', () => {
  test('none returns a single "all" group', () => {
    const groups = groupTasks(fixture, 'none', ctx)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.key).toBe('all')
    expect(groups[0]?.label).toBe('')
    expect(groups[0]?.tasks).toHaveLength(8)
  })
  test('none yields one empty group for no tasks', () => {
    expect(groupTasks([], 'none', ctx)).toEqual([{ key: 'all', label: '', tasks: [] }])
  })
  test('project groups in first-appearance order, keyed by id', () => {
    const groups = groupTasks(fixture, 'project', ctx)
    expect(groups.map((g) => g.key)).toEqual(['project:P1', 'project:P2', 'project:P3'])
    expect(groups.map((g) => g.label)).toEqual(['Work', 'Home', 'Errands'])
    expect(ids(groups[0]?.tasks ?? [])).toEqual(['o1', 'o2', 'su'])
    expect(ids(groups[1]?.tasks ?? [])).toEqual(['td', 'tm', 'nd'])
  })
  test('priority groups P1..P4 in order, skipping empties', () => {
    const groups = groupTasks(fixture, 'priority', ctx)
    expect(groups.map((g) => g.label)).toEqual([
      'Priority 1',
      'Priority 2',
      'Priority 3',
      'Priority 4',
    ])
    expect(ids(groups[0]?.tasks ?? [])).toEqual(['o1', 'td', 'lt'])
    expect(ids(groups[3]?.tasks ?? [])).toEqual(['su', 'nd'])
  })
  test('priority skips an empty bucket', () => {
    const only = [td, nd] // priorities 1 and 4
    expect(groupTasks(only, 'priority', ctx).map((g) => g.label)).toEqual([
      'Priority 1',
      'Priority 4',
    ])
  })
  test('label groups alpha, multi-label tasks appear in each, No label trails', () => {
    const groups = groupTasks(fixture, 'label', ctx)
    expect(groups.map((g) => g.label)).toEqual(['errands', 'home', 'work', 'No label'])
    // td carries both work and home → present in both
    expect(ids(groups[1]?.tasks ?? [])).toEqual(['o2', 'td', 'mo']) // home
    expect(ids(groups[2]?.tasks ?? [])).toEqual(['o1', 'td', 'nd']) // work
    expect(ids(groups[3]?.tasks ?? [])).toEqual(['tm', 'lt']) // No label
  })
  test('label omits the No label group when every task is labelled', () => {
    const groups = groupTasks([o1, o2], 'label', ctx)
    expect(groups.map((g) => g.label)).toEqual(['home', 'work'])
  })
  test('date buckets in canonical order against ctx.now', () => {
    const groups = groupTasks(fixture, 'date', ctx)
    // Sunday (07-19) precedes Monday (07-20) by date, not alphabetically.
    expect(groups.map((g) => g.label)).toEqual([
      'Overdue',
      'Today',
      'Tomorrow',
      'Sunday',
      'Monday',
      'Later',
      'No date',
    ])
    expect(ids(groups[0]?.tasks ?? [])).toEqual(['o1', 'o2']) // Overdue
    expect(ids(groups[1]?.tasks ?? [])).toEqual(['td']) // Today (all-day)
    expect(groups.at(-1)?.key).toBe('no-date')
  })
  test('date skips empty buckets', () => {
    expect(groupTasks([nd], 'date', ctx).map((g) => g.label)).toEqual(['No date'])
  })
  test('does not mutate the input array', () => {
    const input = [...fixture]
    groupTasks(input, 'date', ctx)
    expect(ids(input)).toEqual(ids(fixture))
  })
})

describe('splitPanesRaw', () => {
  test('splits on a top-level comma and trims', () => {
    expect(splitPanesRaw('#Inbox & no date, view all & !#Inbox')).toEqual([
      '#Inbox & no date',
      'view all & !#Inbox',
    ])
  })
  test('a single pane with no comma is returned as-is', () => {
    expect(splitPanesRaw('today & p1')).toEqual(['today & p1'])
  })
  test('an escaped comma does not split and the escape is preserved', () => {
    expect(splitPanesRaw('a \\, b')).toEqual(['a \\, b'])
  })
  test('commas inside parentheses do not split', () => {
    expect(splitPanesRaw('(a, b) & today, tomorrow')).toEqual(['(a, b) & today', 'tomorrow'])
  })
  test('nested parentheses keep inner commas together', () => {
    expect(splitPanesRaw('((x, y), z), w')).toEqual(['((x, y), z)', 'w'])
  })
  test('surrounding whitespace is trimmed per pane', () => {
    expect(splitPanesRaw('  today ,  tomorrow  ')).toEqual(['today', 'tomorrow'])
  })
  test('a trailing comma yields no empty pane', () => {
    expect(splitPanesRaw('today,')).toEqual(['today'])
  })
  test('empty input yields a single empty pane', () => {
    expect(splitPanesRaw('')).toEqual([''])
  })
  test('a query of only commas floors to one empty pane', () => {
    expect(splitPanesRaw(',,,')).toEqual([''])
  })
  test('a trailing lone backslash is preserved', () => {
    expect(splitPanesRaw('today\\')).toEqual(['today\\'])
  })
  test('result length is always at least 1', () => {
    for (const q of ['', ',', ',,', 'x', 'x,y']) {
      expect(splitPanesRaw(q).length).toBeGreaterThanOrEqual(1)
    }
  })
})
