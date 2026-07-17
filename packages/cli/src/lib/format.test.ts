import { describe, expect, it } from 'vitest'
import type { FilterDto, LabelDto, ProjectDto, SectionDto, TaskDto } from './api'
import type { FmtOpts } from './context'
import {
  dueLabel,
  filterTable,
  groupHeader,
  jsonOut,
  labelTable,
  priorityLabel,
  projectTable,
  relativeDate,
  sectionTable,
  taskLine,
  taskTable,
} from './format'

// Fixed contexts: `color` forces ANSI, `plain` never colors. today is a Wednesday.
const color: FmtOpts = { color: true, today: '2026-07-15', timezone: 'America/New_York' }
const plain: FmtOpts = { color: false, today: '2026-07-15', timezone: 'America/New_York' }

// ANSI escape prefixes built at runtime (no control chars in source / regex).
const ESC = String.fromCharCode(27)
const RED = `${ESC}[31m`
const GREEN = `${ESC}[32m`
const DIM = `${ESC}[2m`

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: 'tsk_1',
    content: 'Buy milk',
    description: '',
    project_id: 'prj_groc',
    section_id: null,
    parent_id: null,
    priority: 4,
    due: null,
    deadline_date: null,
    duration_min: null,
    labels: [],
    child_order: 1,
    day_order: 1,
    uncompletable: false,
    completed_at: null,
    created_at: '2026-07-15T12:00:00Z',
    ...overrides,
  }
}
function project(overrides: Partial<ProjectDto> = {}): ProjectDto {
  return {
    id: 'prj_1',
    name: 'Work',
    color: 'blue',
    parent_id: null,
    child_order: 1,
    is_favorite: false,
    is_archived: false,
    is_inbox: false,
    ...overrides,
  }
}
function label(overrides: Partial<LabelDto> = {}): LabelDto {
  return {
    id: 'lbl_1',
    name: 'errands',
    color: 'yellow',
    item_order: 1,
    is_favorite: false,
    ...overrides,
  }
}
function filter(overrides: Partial<FilterDto> = {}): FilterDto {
  return {
    id: 'flt_1',
    name: 'Urgent',
    query: 'p1 | p2',
    color: 'red',
    item_order: 1,
    is_favorite: false,
    ...overrides,
  }
}
function section(overrides: Partial<SectionDto> = {}): SectionDto {
  return { id: 'sec_1', project_id: 'prj_1', name: 'Planning', section_order: 1, ...overrides }
}

/** Every line of `output` is free of trailing whitespace. */
function expectNoTrailingWhitespace(output: string): void {
  for (const line of output.split('\n')) expect(line).toBe(line.trimEnd())
}

describe('relativeDate', () => {
  it('names today, tomorrow, and near weekdays', () => {
    expect(relativeDate('2026-07-15', '2026-07-15')).toBe('today')
    expect(relativeDate('2026-07-16', '2026-07-15')).toBe('tomorrow')
    expect(relativeDate('2026-07-17', '2026-07-15')).toBe('Friday')
  })
  it('uses month-day for dates a week or more out', () => {
    expect(relativeDate('2026-07-30', '2026-07-15')).toBe('Jul 30')
  })
  it('adds the year when it differs from today', () => {
    expect(relativeDate('2027-03-30', '2026-07-15')).toBe('Mar 30 2027')
  })
  it('renders past dates as month-day', () => {
    expect(relativeDate('2026-07-01', '2026-07-15')).toBe('Jul 1')
  })
})

describe('priorityLabel', () => {
  it('colors p1 red when color is on', () => {
    const out = priorityLabel(1, color)
    expect(out).toContain(RED)
    expect(out).toContain('p1')
  })
  it('is plain text with color off', () => {
    expect(priorityLabel(1, plain)).toBe('p1')
    expect(priorityLabel(4, plain)).toBe('p4')
  })
})

describe('dueLabel', () => {
  it('returns empty string when there is no due', () => {
    expect(dueLabel(task(), plain)).toBe('')
  })
  it('colors overdue dates red', () => {
    const out = dueLabel(
      task({ due: { date: '2026-07-14', time: null, string: 'yesterday', is_recurring: false } }),
      color,
    )
    expect(out).toContain(RED)
  })
  it('colors today green', () => {
    const out = dueLabel(
      task({ due: { date: '2026-07-15', time: null, string: 'today', is_recurring: false } }),
      color,
    )
    expect(out).toContain(GREEN)
  })
  it('appends a time suffix', () => {
    const out = dueLabel(
      task({
        due: { date: '2026-07-15', time: '09:00', string: 'today 9am', is_recurring: false },
      }),
      plain,
    )
    expect(out).toBe('today 09:00')
  })
  it('marks recurring dues with a dim (recurring) suffix', () => {
    const out = dueLabel(
      task({ due: { date: '2026-07-15', time: null, string: 'every day', is_recurring: true } }),
      plain,
    )
    expect(out).toContain('(recurring)')
    const colored = dueLabel(
      task({ due: { date: '2026-07-15', time: null, string: 'every day', is_recurring: true } }),
      color,
    )
    expect(colored).toContain(DIM)
  })
})

describe('taskLine', () => {
  it('shows id, checkbox, content, and labels but never the project', () => {
    const line = taskLine(task({ labels: ['home'] }), plain)
    expect(line).toContain('tsk_1')
    expect(line).toContain('○')
    expect(line).toContain('Buy milk')
    expect(line).toContain('@home')
    expect(line).not.toContain('#')
  })
  it('shows a priority label only when priority differs from 4', () => {
    expect(taskLine(task({ priority: 4 }), plain)).not.toContain('p4')
    expect(taskLine(task({ priority: 1 }), plain)).toContain('p1')
  })
})

describe('taskTable', () => {
  it('renders project names only when opts request them', () => {
    const names = new Map([['prj_groc', 'Groceries']])
    const tasks = [task()]
    const withProject = taskTable(tasks, plain, { showProject: true, projectNames: names })
    expect(withProject).toContain('Groceries')
    const withoutProject = taskTable(tasks, plain)
    expect(withoutProject).not.toContain('Groceries')
    expect(withoutProject).toContain('Buy milk')
  })
  it('returns an empty string for no tasks', () => {
    expect(taskTable([], color)).toBe('')
  })
  it('emits no trailing whitespace', () => {
    const names = new Map([['prj_groc', 'Groceries']])
    const tasks = [
      task({ id: 'tsk_a', content: 'Short', priority: 1 }),
      task({ id: 'tsk_b', content: 'A much longer task title here', labels: ['home', 'work'] }),
    ]
    expectNoTrailingWhitespace(taskTable(tasks, color, { showProject: true, projectNames: names }))
    expectNoTrailingWhitespace(taskTable(tasks, plain))
  })
})

describe('projectTable', () => {
  const projects = [
    project({ id: 'prj_inbox', name: 'Inbox', is_inbox: true, child_order: 0 }),
    project({ id: 'prj_work', name: 'Work', child_order: 1 }),
    project({ id: 'prj_sub', name: 'Subproj', parent_id: 'prj_work', child_order: 0 }),
    project({ id: 'prj_fav', name: 'Errands', is_favorite: true, child_order: 2 }),
  ]
  it('orders parents before their indented children', () => {
    const lines = projectTable(projects, plain).split('\n')
    const workIdx = lines.findIndex((l) => l.startsWith('Work'))
    const subIdx = lines.findIndex((l) => l.trimStart().startsWith('Subproj'))
    expect(workIdx).toBeGreaterThanOrEqual(0)
    expect(subIdx).toBeGreaterThan(workIdx)
    expect(lines[subIdx]).toMatch(/^ {2}Subproj/)
  })
  it('marks the inbox and favorites', () => {
    const out = projectTable(projects, plain)
    expect(out).toContain('(inbox)')
    expect(out).toContain('★')
  })
  it('puts the inbox first', () => {
    const lines = projectTable(projects, plain).split('\n')
    expect(lines[0]).toContain('Inbox')
  })
  it('emits no trailing whitespace', () => {
    expectNoTrailingWhitespace(projectTable(projects, color))
    expectNoTrailingWhitespace(projectTable(projects, plain))
  })
  it('returns an empty string for no projects', () => {
    expect(projectTable([], plain)).toBe('')
  })
})

describe('sectionTable / labelTable / filterTable', () => {
  const names = new Map([['prj_1', 'Work']])
  it('sectionTable includes name and project columns', () => {
    const out = sectionTable([section()], names, plain)
    expect(out).toContain('Planning')
    expect(out).toContain('#Work')
  })
  it('labelTable includes name and color columns', () => {
    const out = labelTable(
      [label(), label({ id: 'lbl_2', name: 'home', color: 'green', item_order: 2 })],
      plain,
    )
    expect(out).toContain('@errands')
    expect(out).toContain('yellow')
    expect(out).toContain('@home')
    expect(out).toContain('green')
  })
  it('filterTable includes name, query, and favorite marker', () => {
    const out = filterTable([filter({ is_favorite: true })], plain)
    expect(out).toContain('Urgent')
    expect(out).toContain('p1 | p2')
    expect(out).toContain('★')
  })
  it('orders labels by item_order', () => {
    const lines = labelTable(
      [
        label({ id: 'lbl_b', name: 'beta', item_order: 2 }),
        label({ id: 'lbl_a', name: 'alpha', item_order: 1 }),
      ],
      plain,
    ).split('\n')
    expect(lines[0]).toContain('alpha')
    expect(lines[1]).toContain('beta')
  })
  it('emits no trailing whitespace', () => {
    expectNoTrailingWhitespace(sectionTable([section()], names, color))
    expectNoTrailingWhitespace(labelTable([label()], color))
    expectNoTrailingWhitespace(filterTable([filter()], color))
  })
})

describe('groupHeader', () => {
  it('is bold with color and plain otherwise', () => {
    expect(groupHeader('#Work', plain)).toBe('#Work')
    expect(groupHeader('#Work', color)).toContain('#Work')
    expect(groupHeader('#Work', color)).toContain(`${ESC}[1m`)
  })
})

describe('jsonOut', () => {
  it('is JSON.stringify with two-space indent', () => {
    const value = { ok: true, items: [1, 2] }
    expect(jsonOut(value)).toBe(JSON.stringify(value, null, 2))
  })
})
