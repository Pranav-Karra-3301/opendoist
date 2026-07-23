import {
  DEFAULT_PARSE_CONTEXT_SETTINGS,
  type ParseContext,
  type Priority,
  parseQuickAdd,
} from '@opentask/core'
import { describe, expect, test } from 'vitest'

// Fixed clock + zone so bare natural-language dates resolve to stable calendar dates. This pins the
// CLI's local Quick Add preview to core's implemented goldens — if these ever diverge, core wins and
// this table is the thing that must change (see plan Task D Step 2).
const ctx: ParseContext = {
  now: '2026-07-15T21:00:00Z',
  timezone: 'America/New_York',
  ...DEFAULT_PARSE_CONTEXT_SETTINGS,
}

interface Row {
  input: string
  title: string
  priority: Priority
  project: string | null
  labels: string[]
  dueDate: string | null
  dueTime: string | null
}

const rows: Row[] = [
  {
    input: 'buy milk',
    title: 'buy milk',
    priority: 4,
    project: null,
    labels: [],
    dueDate: null,
    dueTime: null,
  },
  {
    input: 'Submit report tom 4pm p1 #Work',
    title: 'Submit report',
    priority: 1,
    project: 'Work',
    labels: [],
    dueDate: '2026-07-16',
    dueTime: '16:00',
  },
  {
    input: 'call mom every mon at 20:00',
    title: 'call mom',
    priority: 4,
    project: null,
    labels: [],
    dueDate: '2026-07-20',
    dueTime: '20:00',
  },
  {
    input: 'pay rent {aug 1} p2',
    title: 'pay rent',
    priority: 2,
    project: null,
    labels: [],
    dueDate: null,
    dueTime: null,
  },
  {
    input: 'email @family @work tod',
    title: 'email',
    priority: 4,
    project: null,
    labels: ['family', 'work'],
    dueDate: '2026-07-15',
    dueTime: null,
  },
  {
    input: '* Flight check-in // gate 30',
    title: 'Flight check-in',
    priority: 4,
    project: null,
    labels: [],
    dueDate: null,
    dueTime: null,
  },
]

describe('parseQuickAdd round-trip (CLI preview pinned to core goldens)', () => {
  test.each(rows)('$input', (row) => {
    const parsed = parseQuickAdd(row.input, ctx)
    expect(parsed.title).toBe(row.title)
    expect(parsed.priority).toBe(row.priority)
    expect(parsed.project).toBe(row.project)
    expect(parsed.labels).toEqual(row.labels)
    expect(parsed.due?.date ?? null).toBe(row.dueDate)
    expect(parsed.due?.time ?? null).toBe(row.dueTime)
  })

  test('row 4 carries a date-only deadline, not a due', () => {
    const parsed = parseQuickAdd('pay rent {aug 1} p2', ctx)
    expect(parsed.deadline).toEqual({ date: '2026-08-01', time: null })
    expect(parsed.due).toBeNull()
  })

  test('row 6 is uncompletable with a description after //', () => {
    const parsed = parseQuickAdd('* Flight check-in // gate 30', ctx)
    expect(parsed.uncompletable).toBe(true)
    expect(parsed.description).toBe('gate 30')
  })
})
