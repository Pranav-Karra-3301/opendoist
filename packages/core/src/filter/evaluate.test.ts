import { describe, expect, test } from 'vitest'
import type { FilterContext, FilterTaskView } from '../types'
import { evaluateFilter, filterTasks, parseFilter } from './index'

// Wed 2026-07-15, 17:00 wall clock in New York
const ctx: FilterContext = {
  now: '2026-07-15T21:00:00Z',
  timezone: 'America/New_York',
  weekStart: 1,
  nextWeekDay: 1,
  weekendDay: 6,
  projects: new Map([
    ['P1', { name: 'Work', parentId: null }],
    ['P2', { name: 'Inbox', parentId: null }],
    ['P3', { name: 'School', parentId: null }],
    ['P4', { name: 'Science', parentId: 'P3' }],
    ['P5', { name: 'One & Two', parentId: null }],
  ]),
}

type Required = Pick<FilterTaskView, 'id' | 'content' | 'projectId' | 'projectName'>

function makeTask(over: Partial<FilterTaskView> & Required): FilterTaskView {
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

const t1 = makeTask({
  id: 't1',
  content: 'Pay invoices',
  projectId: 'P1',
  projectName: 'Work',
  dueDate: '2026-07-15',
  priority: 1,
  labels: ['email'],
  sectionName: 'Admin',
})
const t2 = makeTask({
  id: 't2',
  content: 'Standup prep',
  projectId: 'P1',
  projectName: 'Work',
  dueDate: '2026-07-15',
  dueTime: '16:00', // an hour in the past → overdue
  priority: 2,
  labels: ['home'],
})
const t3 = makeTask({
  id: 't3',
  content: 'Expense report',
  projectId: 'P1',
  projectName: 'Work',
  dueDate: '2026-07-14',
  parentId: 't1',
})
const t4 = makeTask({ id: 't4', content: 'Sort mail', projectId: 'P2', projectName: 'Inbox' })
const t5 = makeTask({
  id: 't5',
  content: 'Reading list',
  projectId: 'P2',
  projectName: 'Inbox',
  dueDate: '2026-07-16',
  priority: 1,
  labels: ['homework'],
  createdAt: '2026-07-15T14:00:00Z', // 10:00 in New York → created today
})
const t6 = makeTask({
  id: 't6',
  content: 'Movie night',
  projectId: 'P3',
  projectName: 'School',
  dueDate: '2026-07-18', // Saturday
  priority: 3,
  labels: ['night'],
  isRecurring: true,
  sectionName: 'Homework',
})
const t7 = makeTask({
  id: 't7',
  content: 'Lab write-up',
  projectId: 'P4',
  projectName: 'Science',
  dueDate: '2026-07-22',
  priority: 2,
  deadline: '2026-07-30',
  labels: ['study'],
})
const t8 = makeTask({
  id: 't8',
  content: 'Team Meeting notes',
  projectId: 'P1',
  projectName: 'Work',
  dueDate: '2026-07-20',
  deadline: '2026-07-16',
  uncompletable: true,
})
const t9 = makeTask({
  id: 't9',
  content: 'Weekly sync',
  projectId: 'P5',
  projectName: 'One & Two',
  dueDate: '2026-07-15',
  dueTime: '18:00', // an hour in the future → today but not overdue
  priority: 2,
  description: 'Meeting agenda',
})
const t10 = makeTask({
  id: 't10',
  content: 'Archive binder',
  projectId: 'P3',
  projectName: 'School',
  createdAt: '2025-01-01T12:00:00Z',
})

const tasks = [t1, t2, t3, t4, t5, t6, t7, t8, t9, t10]

const panes = (query: string): string[][] =>
  filterTasks(parseFilter(query), tasks, ctx).map((pane) => pane.map((task) => task.id))
const ids = (query: string): string[] => panes(query)[0] ?? []

describe('canonical queries (dossier §1.7)', () => {
  test('(today | overdue) & #Work', () => {
    expect(ids('(today | overdue) & #Work')).toEqual(['t1', 't2', 't3'])
  })

  test('(P1 | P2) & 14 days', () => {
    expect(ids('(P1 | P2) & 14 days')).toEqual(['t1', 't2', 't5', 't7', 't9'])
  })

  test('#Inbox & no date, All & !#Inbox & !no date — two panes', () => {
    expect(panes('#Inbox & no date, All & !#Inbox & !no date')).toEqual([
      ['t4'],
      ['t1', 't2', 't3', 't6', 't7', 't8', 't9'],
    ])
  })

  test('saturday & @night', () => {
    expect(ids('saturday & @night')).toEqual(['t6'])
  })

  test('search: Meeting & today', () => {
    expect(ids('search: Meeting & today')).toEqual(['t9'])
  })

  test('##School & !#Science', () => {
    expect(ids('##School & !#Science')).toEqual(['t6', 't10'])
  })
})

describe('date predicates', () => {
  test('today / tomorrow / yesterday', () => {
    expect(ids('today')).toEqual(['t1', 't2', 't9'])
    expect(ids('tomorrow')).toEqual(['t5'])
    expect(ids('yesterday')).toEqual(['t3'])
  })

  test('overdue: earlier dates, or today with a time already past', () => {
    expect(ids('overdue')).toEqual(['t2', 't3'])
    expect(ids('od')).toEqual(['t2', 't3'])
  })

  test('7 days = due within the next 7 days including today', () => {
    expect(ids('7 days')).toEqual(['t1', 't2', 't5', 't6', 't8', 't9'])
    expect(ids('next 7 days')).toEqual(['t1', 't2', 't5', 't6', 't8', 't9'])
  })

  test('no date / no time / recurring', () => {
    expect(ids('no date')).toEqual(['t4', 't10'])
    expect(ids('no time')).toEqual(['t1', 't3', 't5', 't6', 't7', 't8'])
    expect(ids('recurring')).toEqual(['t6'])
    expect(ids('!recurring & #School')).toEqual(['t10'])
  })

  test('date refs resolve at eval time', () => {
    expect(ids('date before: next week')).toEqual(['t1', 't2', 't3', 't5', 't6', 't9'])
    expect(ids('date after: today')).toEqual(['t5', 't6', 't7', 't8'])
    expect(ids('date: saturday')).toEqual(['t6'])
    expect(ids('date: 22')).toEqual(['t7']) // bare day-of-month → next 22nd
  })

  test('time-of-day comparisons; all-day tasks count as start of day', () => {
    expect(ids('date: today at 6pm')).toEqual(['t9'])
    expect(ids('date before: today at 5pm')).toEqual(['t1', 't2', 't3'])
    expect(ids('date after: today at 5pm')).toEqual(['t5', 't6', 't7', 't8', 't9'])
  })

  test('unresolvable date refs match nothing', () => {
    expect(ids('date: notarealdate')).toEqual([])
  })
})

describe('deadline and created predicates', () => {
  test('deadline on/before/after and no deadline', () => {
    expect(ids('deadline: july 16')).toEqual(['t8'])
    expect(ids('deadline before: aug 1')).toEqual(['t7', 't8'])
    expect(ids('deadline after: july 20')).toEqual(['t7'])
    expect(ids('no deadline')).toEqual(['t1', 't2', 't3', 't4', 't5', 't6', 't9', 't10'])
  })

  test('created compares the calendar date of createdAt in the user timezone', () => {
    expect(ids('created: today')).toEqual(['t5'])
    expect(ids('created before: -365 days')).toEqual(['t10'])
    expect(ids('created after: 2026-07-01')).toEqual(['t5'])
  })
})

describe('priority, labels, projects, sections', () => {
  test('priority and no priority (= p4)', () => {
    expect(ids('p1')).toEqual(['t1', 't5'])
    expect(ids('no priority')).toEqual(['t3', 't4', 't8', 't10'])
  })

  test('label wildcard @home* matches home and homework', () => {
    expect(ids('@home*')).toEqual(['t2', 't5'])
    expect(ids('@home')).toEqual(['t2'])
    expect(ids('@NIGHT')).toEqual(['t6']) // case-insensitive
    expect(ids('no labels')).toEqual(['t3', 't4', 't8', 't9', 't10'])
  })

  test('#Project vs ##Project descendant matching', () => {
    expect(ids('#School')).toEqual(['t6', 't10'])
    expect(ids('##School')).toEqual(['t6', 't7', 't10'])
    expect(ids('##Work')).toEqual(['t1', 't2', 't3', 't8'])
    expect(ids('#One \\& Two')).toEqual(['t9'])
  })

  test('sections: /Name, /#Name, !/*, no section', () => {
    expect(ids('/Admin')).toEqual(['t1'])
    expect(ids('#Work & /Admin')).toEqual(['t1'])
    expect(ids('/#Homework')).toEqual(['t6'])
    expect(ids('!/*')).toEqual(['t2', 't3', 't4', 't5', 't7', 't8', 't9', 't10'])
    expect(ids('no section')).toEqual(['t2', 't3', 't4', 't5', 't7', 't8', 't9', 't10'])
  })
})

describe('content and structure predicates', () => {
  test('search matches content and description case-insensitively', () => {
    expect(ids('search: meeting')).toEqual(['t8', 't9'])
  })

  test('subtask / uncompletable / view all', () => {
    expect(ids('subtask')).toEqual(['t3'])
    expect(ids('uncompletable')).toEqual(['t8'])
    expect(ids('view all')).toEqual(tasks.map((task) => task.id))
  })
})

describe('evaluateFilter', () => {
  test('evaluates one expression against one task', () => {
    const expr = parseFilter('today').panes[0]
    if (!expr) throw new Error('expected a pane')
    expect(evaluateFilter(expr, t1, ctx)).toBe(true)
    expect(evaluateFilter(expr, t4, ctx)).toBe(false)
  })
})
