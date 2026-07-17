import type { ParseContext } from '@opendoist/core'
import { describe, expect, test } from 'vitest'
import { buildTaskDrafts } from './confirm'
import type { ExtractedTask } from './schemas'
import type { TaskDraft } from './types'

// Same ParseContext the plan pins: Wed 2026-07-15, 17:00 in New York.
const ctx: ParseContext = {
  now: '2026-07-15T21:00:00Z',
  timezone: 'America/New_York',
  weekStart: 1,
  nextWeekDay: 1,
  weekendDay: 6,
  smartDate: true,
}

function item(over: Partial<ExtractedTask> = {}): ExtractedTask {
  return { title: 'task', notes: null, due: null, priority: null, labels: [], ...over }
}

/** Build a single draft from one item (input is always length 1 here). */
function draftFor(over: Partial<ExtractedTask> = {}): TaskDraft {
  const [draft] = buildTaskDrafts([item(over)], ctx)
  if (!draft) throw new Error('expected exactly one draft')
  return draft
}

describe('buildTaskDrafts — due resolution', () => {
  test("'tomorrow 5pm' → exact date + time (parseQuickAdd path)", () => {
    expect(draftFor({ due: 'tomorrow 5pm' }).due).toEqual({
      date: '2026-07-16',
      time: '17:00',
      string: 'tomorrow 5pm',
      recurrence: null,
    })
  })

  test("'every friday' → recurrence non-null + next occurrence 2026-07-17", () => {
    const { due } = draftFor({ due: 'every friday' })
    expect(due?.recurrence).not.toBeNull()
    expect(due?.date).toBe('2026-07-17')
    expect(due?.recurrence).toMatchObject({ freq: 'weekly', weekdays: [5] })
  })

  test("'in 3 weeks' → 2026-08-05, date-only, no recurrence", () => {
    expect(draftFor({ due: 'in 3 weeks' }).due).toEqual({
      date: '2026-08-05',
      time: null,
      string: 'in 3 weeks',
      recurrence: null,
    })
  })

  test("bare '27' resolves via resolveNaturalDate fallback (next 27th)", () => {
    expect(draftFor({ due: '27' }).due).toEqual({
      date: '2026-07-27',
      time: null,
      string: '27',
      recurrence: null,
    })
  })

  test("unparseable phrase → due null + 'Due (unparsed): …' paragraph", () => {
    const draft = draftFor({ due: 'when I feel like it' })
    expect(draft.due).toBeNull()
    expect(draft.description).toBe('Due (unparsed): when I feel like it')
  })

  test('null due → no due, no unparsed note', () => {
    const draft = draftFor({ due: null })
    expect(draft.due).toBeNull()
    expect(draft.description).toBeNull()
  })

  test('whitespace-only due is treated as no due (not unparsed)', () => {
    const draft = draftFor({ due: '   ' })
    expect(draft.due).toBeNull()
    expect(draft.description).toBeNull()
  })
})

describe('buildTaskDrafts — description composition', () => {
  test('notes + unparsed-due join with a blank line', () => {
    expect(draftFor({ notes: 'call the vet first', due: 'when I feel like it' }).description).toBe(
      'call the vet first\n\nDue (unparsed): when I feel like it',
    )
  })

  test('notes present + due parses → description is just the notes', () => {
    expect(draftFor({ notes: 'context here', due: 'tomorrow 5pm' }).description).toBe(
      'context here',
    )
  })

  test('no notes + due parses → description null', () => {
    expect(draftFor({ notes: null, due: 'tomorrow 5pm' }).description).toBeNull()
  })

  test('empty/whitespace notes are omitted', () => {
    expect(draftFor({ notes: '   ' }).description).toBeNull()
  })
})

describe('buildTaskDrafts — priority', () => {
  test('null priority defaults to 4', () => {
    expect(draftFor({ priority: null }).priority).toBe(4)
  })

  test('priority passes through un-inverted (1 = highest stays 1)', () => {
    expect(draftFor({ priority: 1 }).priority).toBe(1)
    expect(draftFor({ priority: 2 }).priority).toBe(2)
    expect(draftFor({ priority: 3 }).priority).toBe(3)
    expect(draftFor({ priority: 4 }).priority).toBe(4)
  })
})

describe('buildTaskDrafts — labels', () => {
  test('trim, drop empties, case-insensitive dedupe keeping first spelling', () => {
    expect(draftFor({ labels: ['Home', 'home', ' errands '] }).labels).toEqual(['Home', 'errands'])
  })

  test('empty and whitespace-only labels are dropped', () => {
    expect(draftFor({ labels: ['', '  ', 'work'] }).labels).toEqual(['work'])
  })
})

describe('buildTaskDrafts — content / literal titles', () => {
  test('content is the trimmed title, used literally', () => {
    expect(draftFor({ title: '  buy milk  ' }).content).toBe('buy milk')
  })

  test("title 'call #dentist' stays literal — no sigil/due/label leak from the title", () => {
    const draft = draftFor({ title: 'call #dentist' })
    expect(draft.content).toBe('call #dentist')
    expect(draft.due).toBeNull()
    expect(draft.labels).toEqual([])
    expect(draft.priority).toBe(4)
  })

  test('a due-looking title is NOT parsed as a due (only the due field is)', () => {
    const draft = draftFor({ title: 'tomorrow 5pm sync', due: null })
    expect(draft.content).toBe('tomorrow 5pm sync')
    expect(draft.due).toBeNull()
  })
})

describe('buildTaskDrafts — collection', () => {
  test('items pass through in order, one draft each', () => {
    const drafts = buildTaskDrafts(
      [item({ title: 'a' }), item({ title: 'b' }), item({ title: 'c' })],
      ctx,
    )
    expect(drafts.map((d) => d.content)).toEqual(['a', 'b', 'c'])
  })

  test('empty input → empty output (total, never throws)', () => {
    expect(buildTaskDrafts([], ctx)).toEqual([])
  })

  test('a fully-populated item maps every field at once', () => {
    const draft = draftFor({
      title: '  Email Sam  ',
      notes: 'about the Q3 numbers',
      due: 'every friday',
      priority: 2,
      labels: ['Work', 'work', ' Follow-up '],
    })
    expect(draft.content).toBe('Email Sam')
    expect(draft.description).toBe('about the Q3 numbers')
    expect(draft.priority).toBe(2)
    expect(draft.labels).toEqual(['Work', 'Follow-up'])
    expect(draft.due?.date).toBe('2026-07-17')
    expect(draft.due?.recurrence).not.toBeNull()
  })
})
