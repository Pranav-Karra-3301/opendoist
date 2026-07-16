import { describe, expect, test } from 'vitest'
import { FilterSyntaxError } from '../types'
import { parseFilter } from './index'

const pane = (query: string) => {
  const parsed = parseFilter(query)
  expect(parsed.panes).toHaveLength(1)
  return parsed.panes[0]
}

describe('canonical queries (dossier §1.7)', () => {
  test('(today | overdue) & #Work', () => {
    expect(pane('(today | overdue) & #Work')).toEqual({
      t: 'and',
      children: [
        { t: 'or', children: [{ t: 'today' }, { t: 'overdue' }] },
        { t: 'project', name: 'Work', withDescendants: false },
      ],
    })
  })

  test('(P1 | P2) & 14 days — keywords are case-insensitive', () => {
    expect(pane('(P1 | P2) & 14 days')).toEqual({
      t: 'and',
      children: [
        {
          t: 'or',
          children: [
            { t: 'priority', value: 1 },
            { t: 'priority', value: 2 },
          ],
        },
        { t: 'dateWithin', days: 14 },
      ],
    })
  })

  test('#Inbox & no date, All & !#Inbox & !no date — comma splits panes, All = view all', () => {
    const inbox = { t: 'project', name: 'Inbox', withDescendants: false }
    expect(parseFilter('#Inbox & no date, All & !#Inbox & !no date')).toEqual({
      panes: [
        { t: 'and', children: [inbox, { t: 'noDate' }] },
        {
          t: 'and',
          children: [
            { t: 'viewAll' },
            { t: 'not', child: inbox },
            { t: 'not', child: { t: 'noDate' } },
          ],
        },
      ],
    })
    expect(pane('view all')).toEqual({ t: 'viewAll' })
  })

  test('saturday & @night — bare text becomes a raw date-on ref', () => {
    expect(pane('saturday & @night')).toEqual({
      t: 'and',
      children: [
        { t: 'dateOn', ref: 'saturday' },
        { t: 'label', name: 'night', wildcard: false },
      ],
    })
  })

  test('search: Meeting & today — search text stops at the operator', () => {
    expect(pane('search: Meeting & today')).toEqual({
      t: 'and',
      children: [{ t: 'search', text: 'Meeting' }, { t: 'today' }],
    })
  })

  test('##School & !#Science — descendant matching', () => {
    expect(pane('##School & !#Science')).toEqual({
      t: 'and',
      children: [
        { t: 'project', name: 'School', withDescendants: true },
        { t: 'not', child: { t: 'project', name: 'Science', withDescendants: false } },
      ],
    })
  })

  test('@home* — wildcard label', () => {
    expect(pane('@home*')).toEqual({ t: 'label', name: 'home*', wildcard: true })
  })

  test('#One \\& Two — escaped operator inside a name', () => {
    expect(pane('#One \\& Two')).toEqual({
      t: 'project',
      name: 'One & Two',
      withDescendants: false,
    })
  })
})

describe('operators and precedence', () => {
  test('| binds looser than &', () => {
    expect(pane('p1 | p2 & p3')).toEqual({
      t: 'or',
      children: [
        { t: 'priority', value: 1 },
        {
          t: 'and',
          children: [
            { t: 'priority', value: 2 },
            { t: 'priority', value: 3 },
          ],
        },
      ],
    })
  })

  test('chained & flattens to one n-ary node', () => {
    expect(pane('p1 & p2 & p3')).toEqual({
      t: 'and',
      children: [
        { t: 'priority', value: 1 },
        { t: 'priority', value: 2 },
        { t: 'priority', value: 3 },
      ],
    })
  })

  test('! binds tighter than & and distributes over parens', () => {
    expect(pane('!p1 & p2')).toEqual({
      t: 'and',
      children: [
        { t: 'not', child: { t: 'priority', value: 1 } },
        { t: 'priority', value: 2 },
      ],
    })
    expect(pane('!(p1 | p2)')).toEqual({
      t: 'not',
      child: {
        t: 'or',
        children: [
          { t: 'priority', value: 1 },
          { t: 'priority', value: 2 },
        ],
      },
    })
  })

  test('escaped comma stays inside a name instead of splitting panes', () => {
    expect(pane('#A\\, B')).toEqual({ t: 'project', name: 'A, B', withDescendants: false })
  })
})

describe('keywords', () => {
  test('date-state and task-state keywords', () => {
    expect(pane('no date & no time & no labels & no priority & no deadline & no section')).toEqual({
      t: 'and',
      children: [
        { t: 'noDate' },
        { t: 'noTime' },
        { t: 'noLabels' },
        { t: 'noPriority' },
        { t: 'noDeadline' },
        { t: 'noSection' },
      ],
    })
    expect(pane('recurring & subtask & uncompletable')).toEqual({
      t: 'and',
      children: [{ t: 'recurring' }, { t: 'subtask' }, { t: 'uncompletable' }],
    })
  })

  test('od is an alias of overdue; tomorrow/yesterday keywords', () => {
    expect(pane('od | overdue')).toEqual({
      t: 'or',
      children: [{ t: 'overdue' }, { t: 'overdue' }],
    })
    expect(pane('tomorrow | yesterday')).toEqual({
      t: 'or',
      children: [{ t: 'tomorrow' }, { t: 'yesterday' }],
    })
  })

  test('N days and next N days both mean date-within', () => {
    expect(pane('3 days')).toEqual({ t: 'dateWithin', days: 3 })
    expect(pane('next 5 days')).toEqual({ t: 'dateWithin', days: 5 })
  })
})

describe('date/deadline/created operators keep raw refs', () => {
  test('date ops with due aliases', () => {
    expect(pane('date before: next week & due after: sat')).toEqual({
      t: 'and',
      children: [
        { t: 'dateBefore', ref: 'next week' },
        { t: 'dateAfter', ref: 'sat' },
      ],
    })
    expect(pane('date: 10/5/2022')).toEqual({ t: 'dateOn', ref: '10/5/2022' })
    expect(pane('date: today at 2pm')).toEqual({ t: 'dateOn', ref: 'today at 2pm' })
  })

  test('deadline ops', () => {
    expect(pane('deadline: aug 1 & deadline before: sep 1 & deadline after: jul 1')).toEqual({
      t: 'and',
      children: [
        { t: 'deadlineOn', ref: 'aug 1' },
        { t: 'deadlineBefore', ref: 'sep 1' },
        { t: 'deadlineAfter', ref: 'jul 1' },
      ],
    })
  })

  test('created ops accept signed relative refs', () => {
    expect(pane('created: today & created before: -365 days & created after: -30 days')).toEqual({
      t: 'and',
      children: [
        { t: 'createdOn', ref: 'today' },
        { t: 'createdBefore', ref: '-365 days' },
        { t: 'createdAfter', ref: '-30 days' },
      ],
    })
  })
})

describe('projects, sections, labels', () => {
  test('names may contain spaces and stop at operators', () => {
    expect(pane('#Movie Watchlist')).toEqual({
      t: 'project',
      name: 'Movie Watchlist',
      withDescendants: false,
    })
    expect(pane('#Work & /Meetings')).toEqual({
      t: 'and',
      children: [
        { t: 'project', name: 'Work', withDescendants: false },
        { t: 'section', name: 'Meetings', anyProject: false },
      ],
    })
  })

  test('/#Section matches across projects; !/* means no section', () => {
    expect(pane('/#Meetings')).toEqual({ t: 'section', name: 'Meetings', anyProject: true })
    expect(pane('!/*')).toEqual({
      t: 'not',
      child: { t: 'section', name: '*', anyProject: false },
    })
  })

  test('project name case is preserved', () => {
    expect(pane('#work')).toEqual({ t: 'project', name: 'work', withDescendants: false })
  })
})

describe('syntax errors carry a position', () => {
  const failsAt = (query: string, position: number) => {
    let caught: unknown
    try {
      parseFilter(query)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(FilterSyntaxError)
    const err = caught as FilterSyntaxError
    expect(err.name).toBe('FilterSyntaxError')
    expect(err.position).toBe(position)
  }

  test('dangling operator: today &', () => {
    failsAt('today &', 7)
  })
  test('unclosed paren', () => {
    failsAt('(today', 6)
  })
  test('empty query', () => {
    failsAt('', 0)
  })
  test('empty pane after comma', () => {
    failsAt('today,,p1', 6)
  })
  test('two expressions without an operator', () => {
    failsAt('today p1', 6)
  })
  test('sigil without a name', () => {
    failsAt('#', 1)
  })
  test('date operator without a value', () => {
    failsAt('date:', 5)
  })
  test('stray closing paren', () => {
    failsAt('today)', 5)
  })
})
