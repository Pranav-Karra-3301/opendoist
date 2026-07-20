import { type ParseContext, parseQuickAdd } from '@opendoist/core'
import { describe, expect, it } from 'vitest'
import { initialTextFromContext } from './inline-composer'

// The composer expresses its list-row context AS TEXT (text stays the single source of truth), so
// the mapping is the seam worth unit-testing: context names in, an input line the parser re-reads
// out. The round-trip cases feed that line straight back through parseQuickAdd to prove the tokens
// resolve to the intended project / section / due.

const ctx: ParseContext = {
  now: '2026-07-20T12:00:00Z',
  timezone: 'UTC',
  weekStart: 1,
  nextWeekDay: 1,
  weekendDay: 6,
  smartDate: true,
}

describe('initialTextFromContext', () => {
  it('is empty when there is no context', () => {
    expect(initialTextFromContext({})).toBe('')
  })

  it('emits a #project token (trailing space parks the caret past it)', () => {
    expect(initialTextFromContext({ projectName: 'Work' })).toBe('#Work ')
  })

  it('emits #project + /section for a section row', () => {
    expect(initialTextFromContext({ projectName: 'Work', sectionName: 'Backlog' })).toBe(
      '#Work /Backlog ',
    )
  })

  it('quotes multi-word project and section names', () => {
    expect(initialTextFromContext({ projectName: 'Work Stuff', sectionName: 'To Do' })).toBe(
      '#"Work Stuff" /"To Do" ',
    )
  })

  it('drops embedded quotes from a name so it can round-trip', () => {
    expect(initialTextFromContext({ projectName: 'Quo"te' })).toBe('#Quote ')
  })

  it('emits the ISO due date for a day-scoped row', () => {
    expect(initialTextFromContext({ dueDate: '2026-07-25' })).toBe('2026-07-25 ')
  })

  it('drops a /section that has no #project to anchor it', () => {
    expect(initialTextFromContext({ sectionName: 'Backlog' })).toBe('')
  })

  it('combines a project and a due date', () => {
    expect(initialTextFromContext({ projectName: 'Work', dueDate: '2026-07-25' })).toBe(
      '#Work 2026-07-25 ',
    )
  })

  it('ignores whitespace-only names', () => {
    expect(initialTextFromContext({ projectName: '   ', dueDate: '  ' })).toBe('')
  })
})

describe('initialTextFromContext → parseQuickAdd round-trip', () => {
  it('project context parses back to that project', () => {
    const parsed = parseQuickAdd(`${initialTextFromContext({ projectName: 'Work' })}Buy milk`, ctx)
    expect(parsed.project).toBe('Work')
    expect(parsed.title).toBe('Buy milk')
  })

  it('multi-word project + section context parse back whole', () => {
    const text = `${initialTextFromContext({ projectName: 'Work Stuff', sectionName: 'To Do' })}Draft memo`
    const parsed = parseQuickAdd(text, ctx)
    expect(parsed.project).toBe('Work Stuff')
    expect(parsed.section).toBe('To Do')
    expect(parsed.title).toBe('Draft memo')
  })

  it('ISO due-date context parses back to that due', () => {
    const parsed = parseQuickAdd(`${initialTextFromContext({ dueDate: '2026-07-25' })}Ship it`, ctx)
    expect(parsed.due?.date).toBe('2026-07-25')
    expect(parsed.title).toBe('Ship it')
  })

  it('project + due-date context parse back together', () => {
    const text = `${initialTextFromContext({ projectName: 'Work', dueDate: '2026-07-25' })}Review`
    const parsed = parseQuickAdd(text, ctx)
    expect(parsed.project).toBe('Work')
    expect(parsed.due?.date).toBe('2026-07-25')
    expect(parsed.title).toBe('Review')
  })

  it('an untouched context line has an empty title (so save is blocked)', () => {
    const parsed = parseQuickAdd(initialTextFromContext({ projectName: 'Work' }), ctx)
    expect(parsed.title).toBe('')
  })
})
