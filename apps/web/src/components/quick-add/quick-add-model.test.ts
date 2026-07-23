import type { ParseContext } from '@opentask/core'
import { describe, expect, it } from 'vitest'
import type { Label, Project, Section } from '@/api/schemas'
import {
  ignoreToken,
  needsStructuredSubmit,
  parseState,
  pruneIgnored,
  type QuickAddState,
  replaceRange,
  setDueText,
  setPriorityText,
  stripRange,
  toCreatePayload,
} from './quick-add-model'

const ctx: ParseContext = {
  now: '2026-07-16T12:00:00Z',
  timezone: 'UTC',
  weekStart: 1,
  nextWeekDay: 1,
  weekendDay: 6,
  smartDate: true,
}

function state(text: string, ignored: QuickAddState['ignored'] = []): QuickAddState {
  return { text, ignored }
}

function project(id: string, name: string, extra: Partial<Project> = {}): Project {
  return {
    id,
    name,
    description: '',
    color: 'grey',
    parent_id: null,
    child_order: 0,
    is_favorite: false,
    is_archived: false,
    is_collapsed: false,
    is_inbox: false,
    ...extra,
  }
}

function section(id: string, projectId: string, name: string): Section {
  return {
    id,
    project_id: projectId,
    name,
    section_order: 0,
    is_archived: false,
    is_collapsed: false,
  }
}

describe('parseState', () => {
  it('extracts every token kind and a clean title', () => {
    const { parsed, activeTokens } = parseState(state('Buy milk tomorrow p1 #Work @home'), ctx)
    expect(parsed.title).toBe('Buy milk')
    expect(parsed.priority).toBe(1)
    expect(parsed.project).toBe('Work')
    expect(parsed.labels).toEqual(['home'])
    expect(parsed.due?.date).toBe('2026-07-17')
    expect(activeTokens.map((t) => t.kind).sort()).toEqual(['due', 'label', 'priority', 'project'])
  })

  it('reverts a detokenized priority to the default and keeps the text in the title', () => {
    const { activeTokens } = parseState(state('Buy milk tomorrow p1 #Work @home'), ctx)
    const priorityToken = activeTokens.find((t) => t.kind === 'priority')
    if (!priorityToken) throw new Error('expected a priority token')

    const next = ignoreToken(state('Buy milk tomorrow p1 #Work @home'), priorityToken)
    const after = parseState(next, ctx)
    expect(after.parsed.priority).toBe(4)
    expect(after.parsed.title).toBe('Buy milk p1')
    expect(after.activeTokens.some((t) => t.kind === 'priority')).toBe(false)
  })

  it('reverts a detokenized project to null', () => {
    const base = state('Ship release #Work')
    const token = parseState(base, ctx).activeTokens.find((t) => t.kind === 'project')
    if (!token) throw new Error('expected a project token')
    const after = parseState(ignoreToken(base, token), ctx)
    expect(after.parsed.project).toBeNull()
    expect(after.parsed.title).toBe('Ship release #Work')
  })

  it('drops only the detokenized label from a multi-label list', () => {
    const base = state('Chores @home @errands')
    const first = parseState(base, ctx).activeTokens.find(
      (t) => t.kind === 'label' && t.text === '@home',
    )
    if (!first) throw new Error('expected the @home label token')
    const after = parseState(ignoreToken(base, first), ctx)
    expect(after.parsed.labels).toEqual(['errands'])
  })

  it('clears duration when its due is detokenized', () => {
    const base = state('Standup today 9am for 30min')
    const before = parseState(base, ctx)
    expect(before.parsed.durationMin).toBe(30)
    const dueToken = before.activeTokens.find((t) => t.kind === 'due')
    if (!dueToken) throw new Error('expected a due token')
    const after = parseState(ignoreToken(base, dueToken), ctx)
    expect(after.parsed.due).toBeNull()
    expect(after.parsed.durationMin).toBeNull()
  })
})

describe('needsStructuredSubmit', () => {
  it('is false with no detokenized spans and true once something is ignored', () => {
    expect(needsStructuredSubmit(state('Buy milk #Work'))).toBe(false)
    expect(
      needsStructuredSubmit(state('Buy milk #Work', [{ start: 9, end: 14, text: '#Work' }])),
    ).toBe(true)
  })
})

describe('pruneIgnored', () => {
  it('discards ignore entries that no longer match a live token', () => {
    const stale = state('Buy milk', [{ start: 9, end: 14, text: '#Work' }])
    expect(pruneIgnored(stale, ctx).ignored).toEqual([])
  })

  it('keeps ignore entries that still line up with a token', () => {
    const base = state('Buy milk #Work')
    const token = parseState(base, ctx).activeTokens.find((t) => t.kind === 'project')
    if (!token) throw new Error('expected a project token')
    const ignored = ignoreToken(base, token)
    expect(pruneIgnored(ignored, ctx).ignored).toHaveLength(1)
  })
})

describe('toCreatePayload', () => {
  const projects = [project('p-work', 'Work'), project('p-inbox', 'Inbox', { is_inbox: true })]
  const sections = [section('s-1', 'p-work', 'Backlog')]
  const labels: Label[] = []

  it('resolves a known project name to its id and maps scalar fields', () => {
    const { parsed } = parseState(state('Buy milk tomorrow p2 #Work @home for-later'), ctx)
    const { payload, missing } = toCreatePayload(parsed, { projects, sections, labels })
    expect(payload.content).toBe('Buy milk for-later')
    expect(payload.priority).toBe(2)
    expect(payload.project_id).toBe('p-work')
    expect(payload.labels).toEqual(['home'])
    expect(payload.due?.date).toBe('2026-07-17')
    expect(missing.projects).toEqual([])
  })

  it('reports an unknown project name as missing and omits project_id', () => {
    const { parsed } = parseState(state('Draft memo #Marketing'), ctx)
    const { payload, missing } = toCreatePayload(parsed, { projects, sections, labels })
    expect(payload.project_id).toBeUndefined()
    expect(missing.projects).toEqual(['Marketing'])
  })

  it('passes label names through verbatim and never reports them missing', () => {
    const { parsed } = parseState(state('Tidy up @brand-new-label'), ctx)
    const { payload, missing } = toCreatePayload(parsed, { projects, sections, labels })
    expect(payload.labels).toEqual(['brand-new-label'])
    expect(missing.labels).toEqual([])
  })

  it('resolves a section within its resolved project', () => {
    const { parsed } = parseState(state('Refine estimate #Work /Backlog'), ctx)
    const { payload } = toCreatePayload(parsed, { projects, sections, labels })
    expect(payload.project_id).toBe('p-work')
    expect(payload.section_id).toBe('s-1')
  })

  it('maps deadline, duration and uncompletable', () => {
    const { parsed } = parseState(state('* Flight check-in today 4pm for 20min {jul 20}'), ctx)
    const { payload } = toCreatePayload(parsed, { projects, sections, labels })
    expect(payload.uncompletable).toBe(true)
    expect(payload.duration_min).toBe(20)
    expect(payload.deadline_date).toBe('2026-07-20')
  })
})

describe('text edits', () => {
  it('replaceRange and stripRange operate on offsets', () => {
    expect(replaceRange('Buy milk p1 later', 9, 11, 'p3')).toBe('Buy milk p3 later')
    expect(stripRange('Buy milk tomorrow now', 9, 17)).toBe('Buy milk now')
  })

  it('setPriorityText appends, replaces, and clears', () => {
    const appended = setPriorityText('Buy milk', [], 1)
    expect(appended).toBe('Buy milk p1')
    const { activeTokens } = parseState(state('Buy milk p1'), ctx)
    expect(setPriorityText('Buy milk p1', activeTokens, 3)).toBe('Buy milk p3')
    expect(setPriorityText('Buy milk p1', activeTokens, 4)).toBe('Buy milk')
  })

  it('setDueText appends, replaces, and clears the due phrase', () => {
    expect(setDueText('Buy milk', [], 'today')).toBe('Buy milk today')
    const { activeTokens } = parseState(state('Buy milk tomorrow'), ctx)
    expect(setDueText('Buy milk tomorrow', activeTokens, 'today')).toBe('Buy milk today')
    expect(setDueText('Buy milk tomorrow', activeTokens, '')).toBe('Buy milk')
  })
})
