import { type ParseContext, parseQuickAdd } from '@opentask/core'
import { describe, expect, it } from 'vitest'
import { applyComposerContext, composerSubmitText, parseState } from './quick-add-model'

// The composer holds its list-row context as a PRESET (Todoist parity): it never appears in the
// input, the chips show it via applyComposerContext, and the quick path re-expresses whatever the
// user did not override as tokens via composerSubmitText. These are the two seams worth
// unit-testing; the round-trip cases feed the submit line straight back through parseQuickAdd to
// prove the server's re-parse resolves the intended project / section / due.

const ctx: ParseContext = {
  now: '2026-07-20T12:00:00Z',
  timezone: 'UTC',
  weekStart: 1,
  nextWeekDay: 1,
  weekendDay: 6,
  smartDate: true,
}

const parse = (text: string) => parseState({ text, ignored: [] }, ctx)

describe('applyComposerContext (what the chips display)', () => {
  it('is the identity without context', () => {
    const { parsed } = parse('Buy milk tomorrow')
    expect(applyComposerContext(parsed, {})).toEqual(parsed)
  })

  it('fills a missing due with the context date (date-only)', () => {
    const { parsed } = parse('Buy milk')
    const merged = applyComposerContext(parsed, { dueDate: '2026-07-25' })
    expect(merged.due).toEqual({
      date: '2026-07-25',
      time: null,
      string: '2026-07-25',
      recurrence: null,
    })
  })

  it('replaces the implied date of a standalone-time due, keeping the time', () => {
    const { parsed } = parse('Buy milk 4:18pm')
    const merged = applyComposerContext(parsed, { dueDate: '2026-07-25' })
    expect(merged.due?.date).toBe('2026-07-25')
    expect(merged.due?.time).toBe('16:18')
  })

  it('never touches a written date or a recurrence', () => {
    const written = parse('Buy milk tomorrow 5pm').parsed
    expect(applyComposerContext(written, { dueDate: '2026-07-25' }).due).toEqual(written.due)
    const recurring = parse('water plants every day at 9am').parsed
    expect(applyComposerContext(recurring, { dueDate: '2026-07-25' }).due).toEqual(recurring.due)
  })

  it('a cleared preset stays cleared', () => {
    const { parsed } = parse('Buy milk')
    const merged = applyComposerContext(parsed, { dueDate: '2026-07-25' }, { due: true })
    expect(merged.due).toBeNull()
  })

  it('applies the context project + section only when none was typed', () => {
    const bare = parse('Buy milk').parsed
    const merged = applyComposerContext(bare, { projectName: 'Work', sectionName: 'Backlog' })
    expect(merged.project).toBe('Work')
    expect(merged.section).toBe('Backlog')

    const typed = parse('#Home Buy milk').parsed
    const kept = applyComposerContext(typed, { projectName: 'Work', sectionName: 'Backlog' })
    expect(kept.project).toBe('Home')
    expect(kept.section).toBeNull()
  })

  it('ignores whitespace-only context names', () => {
    const { parsed } = parse('Buy milk')
    expect(applyComposerContext(parsed, { projectName: '   ', dueDate: '  ' })).toEqual(parsed)
  })
})

describe('composerSubmitText → parseQuickAdd round-trip (what the server saves)', () => {
  const submit = (text: string, names: Parameters<typeof composerSubmitText>[3], cleared = {}) => {
    const { parsed, activeTokens } = parse(text)
    return composerSubmitText({ text, ignored: [] }, parsed, activeTokens, names, cleared)
  }

  it('project context parses back to that project, title untouched', () => {
    const line = submit('Buy milk', { projectName: 'Work' })
    const parsed = parseQuickAdd(line, ctx)
    expect(parsed.project).toBe('Work')
    expect(parsed.title).toBe('Buy milk')
  })

  it('multi-word project + section context round-trip whole (quoted sigils)', () => {
    const line = submit('Draft memo', { projectName: 'Work Stuff', sectionName: 'To Do' })
    const parsed = parseQuickAdd(line, ctx)
    expect(parsed.project).toBe('Work Stuff')
    expect(parsed.section).toBe('To Do')
    expect(parsed.title).toBe('Draft memo')
  })

  it('date context parses back to that due when no due was typed', () => {
    const parsed = parseQuickAdd(submit('Ship it', { dueDate: '2026-07-25' }), ctx)
    expect(parsed.due?.date).toBe('2026-07-25')
    expect(parsed.due?.time).toBeNull()
    expect(parsed.title).toBe('Ship it')
  })

  it('a standalone typed time lands ON the context date (the Upcoming-row case)', () => {
    const parsed = parseQuickAdd(submit('Ship it 4:18pm', { dueDate: '2026-07-25' }), ctx)
    expect(parsed.due?.date).toBe('2026-07-25')
    expect(parsed.due?.time).toBe('16:18')
    expect(parsed.title).toBe('Ship it')
  })

  it('a written due wins — the context date is not injected at all', () => {
    const line = submit('Ship it tomorrow 5pm', { dueDate: '2026-07-25' })
    expect(line).toBe('Ship it tomorrow 5pm')
    expect(parseQuickAdd(line, ctx).due?.date).toBe('2026-07-21')
  })

  it('a typed #project wins — the context project is not injected', () => {
    const line = submit('#Home Buy milk', { projectName: 'Work', sectionName: 'Backlog' })
    expect(line).toBe('#Home Buy milk')
  })

  it('a cleared date preset is not injected', () => {
    expect(submit('Ship it', { dueDate: '2026-07-25' }, { due: true })).toBe('Ship it')
  })

  it('typed reminders survive alongside injected project + date context', () => {
    const line = submit('Pay rent 5pm !30 min before', {
      projectName: 'Home',
      dueDate: '2026-07-25',
    })
    const parsed = parseQuickAdd(line, ctx)
    expect(parsed.project).toBe('Home')
    expect(parsed.due?.date).toBe('2026-07-25')
    expect(parsed.due?.time).toBe('17:00')
    expect(parsed.reminders).toEqual([{ kind: 'relative', minutesBefore: 30 }])
    expect(parsed.title).toBe('Pay rent')
  })

  it('an untouched preset line still has an empty title (so save stays blocked)', () => {
    const parsed = parseQuickAdd(submit('', { projectName: 'Work', dueDate: '2026-07-25' }), ctx)
    expect(parsed.title).toBe('')
  })
})

describe('typed /section vs a section-row context', () => {
  const names = { projectName: 'Work', sectionName: 'Backlog' }

  it('a typed /section keeps the context section OUT of the submit line and wins server-side', () => {
    const { parsed, activeTokens } = parse('buy milk /Other')
    const line = composerSubmitText(
      { text: 'buy milk /Other', ignored: [] },
      parsed,
      activeTokens,
      names,
    )
    expect(line).toBe('#Work buy milk /Other')
    const round = parseQuickAdd(line, ctx)
    expect(round.project).toBe('Work')
    expect(round.section).toBe('Other')
    expect(round.title).toBe('buy milk')
  })

  it('the chips hide the context section when a /section was typed', () => {
    const { parsed } = parse('buy milk /Other')
    const merged = applyComposerContext(parsed, names)
    expect(merged.project).toBe('Work')
    expect(merged.section).toBeNull()
  })

  it('without a typed /section the context section rides along', () => {
    const { parsed, activeTokens } = parse('buy milk')
    const line = composerSubmitText({ text: 'buy milk', ignored: [] }, parsed, activeTokens, names)
    const round = parseQuickAdd(line, ctx)
    expect(round.project).toBe('Work')
    expect(round.section).toBe('Backlog')
    expect(round.title).toBe('buy milk')
  })
})
