import { DEFAULT_VIEW_PREFS, type ParseContext, type ViewPrefs } from '@opentask/core'
import { describe, expect, it } from 'vitest'
import type { Task } from '@/api/schemas'
import {
  buildFilterContext,
  type ProjectsMap,
  pipelineDeviates,
  pipelineGroups,
  pipelineSortFilter,
  prefsAreDefault,
} from './pipeline'

const PARSE: ParseContext = {
  now: '2026-07-16T12:00:00Z',
  timezone: 'UTC',
  weekStart: 1,
  nextWeekDay: 1,
  weekendDay: 6,
  smartDate: true,
}
const PROJECTS: ProjectsMap = new Map([['p1', { name: 'Work', parentId: null }]])
const CTX = buildFilterContext(PARSE, PROJECTS)

function makeTask(id: string, over: Partial<Task> = {}): Task {
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
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...over,
  }
}

function withPrefs(over: Partial<ViewPrefs>): ViewPrefs {
  return { ...DEFAULT_VIEW_PREFS, ...over }
}

describe('prefsAreDefault', () => {
  it('is true for the defaults', () => {
    expect(prefsAreDefault(DEFAULT_VIEW_PREFS)).toBe(true)
  })
  it('is false when any active-list field differs', () => {
    expect(prefsAreDefault(withPrefs({ groupBy: 'priority' }))).toBe(false)
    expect(prefsAreDefault(withPrefs({ sortBy: 'alphabetical' }))).toBe(false)
    expect(prefsAreDefault(withPrefs({ sortDir: 'desc' }))).toBe(false)
    expect(prefsAreDefault(withPrefs({ filterBy: { priority: 1, label: null, due: null } }))).toBe(
      false,
    )
  })
  it('is false when only showCompleted is on (the menu dot reflects it)', () => {
    expect(prefsAreDefault(withPrefs({ showCompleted: true }))).toBe(false)
  })
})

describe('pipelineDeviates', () => {
  it('is false for defaults', () => {
    expect(pipelineDeviates(DEFAULT_VIEW_PREFS)).toBe(false)
  })
  it('EXCLUDES showCompleted (it only appends a completed section)', () => {
    expect(pipelineDeviates(withPrefs({ showCompleted: true }))).toBe(false)
  })
  it('is true for group/sort/dir/filter deviations', () => {
    expect(pipelineDeviates(withPrefs({ groupBy: 'project' }))).toBe(true)
    expect(pipelineDeviates(withPrefs({ sortBy: 'priority' }))).toBe(true)
    expect(pipelineDeviates(withPrefs({ sortDir: 'desc' }))).toBe(true)
    expect(
      pipelineDeviates(withPrefs({ filterBy: { priority: null, label: 'x', due: null } })),
    ).toBe(true)
  })
})

describe('buildFilterContext', () => {
  it('carries the ParseContext fields (minus smartDate) and the projects map', () => {
    expect(CTX.now).toBe(PARSE.now)
    expect(CTX.timezone).toBe('UTC')
    expect(CTX.weekStart).toBe(1)
    expect(CTX.nextWeekDay).toBe(1)
    expect(CTX.weekendDay).toBe(6)
    expect(CTX.projects.get('p1')).toEqual({ name: 'Work', parentId: null })
  })
})

describe('pipeline task mapping', () => {
  const tasks = [makeTask('a'), makeTask('b'), makeTask('c')]

  it('pipelineGroups returns groups whose tasks are the ORIGINAL Task objects, none dropped', () => {
    const groups = pipelineGroups(tasks, DEFAULT_VIEW_PREFS, CTX, CTX.projects)
    const flat = groups.flatMap((g) => g.tasks)
    expect(flat.map((t) => t.id).sort()).toEqual(['a', 'b', 'c'])
    // identity preserved (rendering reuses phase-4 Task rows, not re-created objects)
    for (const t of flat) expect(tasks).toContain(t)
    for (const g of groups) {
      expect(typeof g.key).toBe('string')
      expect(typeof g.label).toBe('string')
    }
  })

  it('pipelineSortFilter returns a flat Task[] preserving manual order + identity', () => {
    const out = pipelineSortFilter(tasks, DEFAULT_VIEW_PREFS, CTX, CTX.projects)
    expect(out.map((t) => t.id)).toEqual(['a', 'b', 'c'])
    for (const t of out) expect(tasks).toContain(t)
  })

  it('handles an empty task list', () => {
    expect(pipelineSortFilter([], DEFAULT_VIEW_PREFS, CTX, CTX.projects)).toEqual([])
    const groups = pipelineGroups([], DEFAULT_VIEW_PREFS, CTX, CTX.projects)
    expect(groups.flatMap((g) => g.tasks)).toEqual([])
  })
})
