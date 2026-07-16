import { describe, expect, test } from 'vitest'
import { DEFAULT_PARSE_CONTEXT_SETTINGS, type ParseContext, ParsedQuickAddSchema } from '../types'
import { parseQuickAdd } from './index'
import { resolveOverlaps } from './tokens'

const ctx: ParseContext = {
  now: '2026-07-15T21:00:00Z', // Wed, 5pm in New York
  timezone: 'America/New_York',
  ...DEFAULT_PARSE_CONTEXT_SETTINGS,
}

describe('sigil word boundaries', () => {
  test('# without a leading boundary is not a project', () => {
    const r = parseQuickAdd('email#work', ctx)
    expect(r.project).toBeNull()
    expect(r.title).toBe('email#work')
  })

  test('p1 without a leading boundary is not a priority', () => {
    const r = parseQuickAdd('ap1', ctx)
    expect(r.priority).toBe(4)
    expect(r.title).toBe('ap1')
  })

  test('@ without a leading boundary is not a label', () => {
    const r = parseQuickAdd('x@y', ctx)
    expect(r.labels).toEqual([])
    expect(r.title).toBe('x@y')
  })

  test('{ without a leading boundary is not a deadline', () => {
    const r = parseQuickAdd('a{work stuff}', ctx)
    expect(r.deadline).toBeNull()
    expect(r.title).toBe('a{work stuff}')
  })
})

describe('priority tokens', () => {
  test('case-insensitive whole word', () => {
    expect(parseQuickAdd('a P1', ctx).priority).toBe(1)
    expect(parseQuickAdd('a p4', ctx).priority).toBe(4)
    expect(parseQuickAdd('a p4', ctx).tokens.map((t) => t.kind)).toEqual(['priority'])
  })

  test('p5 and p1x are not priorities', () => {
    expect(parseQuickAdd('a p5', ctx).priority).toBe(4)
    expect(parseQuickAdd('a p1x', ctx).priority).toBe(4)
  })

  test('last priority wins and the earlier stays plain text', () => {
    const r = parseQuickAdd('a p2 p3', ctx)
    expect(r.priority).toBe(3)
    expect(r.title).toBe('a p2')
    expect(r.tokens).toHaveLength(1)
  })
})

describe('project / section / label names', () => {
  test('name is a run of non-whitespace characters', () => {
    expect(parseQuickAdd('x #Work-2026', ctx).project).toBe('Work-2026')
    expect(parseQuickAdd('x @some/label', ctx).labels).toEqual(['some/label'])
  })

  test('quoted names allow spaces for all three sigils', () => {
    const r = parseQuickAdd('x #"My Project" /"My Section" @"my label"', ctx)
    expect(r.project).toBe('My Project')
    expect(r.section).toBe('My Section')
    expect(r.labels).toEqual(['my label'])
    expect(r.title).toBe('x')
  })

  test('unclosed quote falls back to a non-whitespace run', () => {
    const r = parseQuickAdd('x #"Movie Watchlist', ctx)
    expect(r.project).toBe('"Movie')
    expect(r.title).toBe('x Watchlist')
  })

  test('a bare sigil with no name is not a token', () => {
    const r = parseQuickAdd('x # y @ z', ctx)
    expect(r.project).toBeNull()
    expect(r.labels).toEqual([])
    expect(r.title).toBe('x # y @ z')
  })

  test('label dedupe is case-insensitive and keeps the first spelling', () => {
    const r = parseQuickAdd('x @Email @email @EMAIL', ctx)
    expect(r.labels).toEqual(['Email'])
    expect(r.tokens).toHaveLength(3)
    expect(r.title).toBe('x')
  })

  test('sections only tokenize when a project token exists', () => {
    expect(parseQuickAdd('x /Admin', ctx).section).toBeNull()
    expect(parseQuickAdd('x /Admin', ctx).title).toBe('x /Admin')
    expect(parseQuickAdd('x /Admin #Work', ctx).section).toBe('Admin')
  })

  test('last section wins, earlier stays plain text', () => {
    const r = parseQuickAdd('task #W /one /two', ctx)
    expect(r.section).toBe('two')
    expect(r.title).toBe('task /one')
  })
})

describe('deadline braces', () => {
  test('inner text must resolve to a date without a time', () => {
    expect(parseQuickAdd('x {july 30}', ctx).deadline).toBe('2026-07-30')
    expect(parseQuickAdd('x {tomorrow 4pm}', ctx).deadline).toBeNull()
    expect(parseQuickAdd('x {nonsense}', ctx).deadline).toBeNull()
  })

  test('failed braces stay literal and are never date-scanned', () => {
    const r = parseQuickAdd('x {tomorrow 4pm}', ctx)
    expect(r.due).toBeNull()
    expect(r.title).toBe('x {tomorrow 4pm}')
  })

  test('an unclosed brace is plain text; the inner date still parses as due', () => {
    const r = parseQuickAdd('x {july 30', ctx)
    expect(r.deadline).toBeNull()
    expect(r.due?.date).toBe('2026-07-30')
    expect(r.title).toBe('x {')
  })

  test('padded inner text resolves', () => {
    expect(parseQuickAdd('x { july 30 }', ctx).deadline).toBe('2026-07-30')
  })
})

describe('reminders', () => {
  test('relative minutes and hours', () => {
    expect(parseQuickAdd('x !30 min before', ctx).reminders).toEqual([
      { kind: 'relative', minutesBefore: 30 },
    ])
    expect(parseQuickAdd('x !2 hours before', ctx).reminders).toEqual([
      { kind: 'relative', minutesBefore: 120 },
    ])
    expect(parseQuickAdd('x !1 hour 30 min before', ctx).reminders).toEqual([
      { kind: 'relative', minutesBefore: 90 },
    ])
  })

  test('relative reminder token covers sigil through `before`', () => {
    const r = parseQuickAdd('x !30 min before y', ctx)
    const t = r.tokens.find((tok) => tok.kind === 'reminder')
    expect(t?.text).toBe('!30 min before')
    expect(r.title).toBe('x y')
  })

  test('absolute reminder applies the today-or-tomorrow rule', () => {
    // 14:00 already passed locally (now 17:00) → tomorrow
    expect(parseQuickAdd('x !14:00', ctx).reminders).toEqual([
      { kind: 'absolute', date: '2026-07-16', time: '14:00' },
    ])
    // 21:00 not yet passed → today
    expect(parseQuickAdd('x !9pm', ctx).reminders).toEqual([
      { kind: 'absolute', date: '2026-07-15', time: '21:00' },
    ])
  })

  test('a space after ! is not a reminder', () => {
    const r = parseQuickAdd('x ! 9pm', ctx)
    expect(r.reminders).toEqual([])
  })
})

describe('description and uncompletable', () => {
  test('splits on the first ` // ` only', () => {
    const r = parseQuickAdd('a // b // c', ctx)
    expect(r.title).toBe('a')
    expect(r.description).toBe('b // c')
  })

  test('empty description is null but still consumed', () => {
    const r = parseQuickAdd('task // ', ctx)
    expect(r.description).toBeNull()
    expect(r.title).toBe('task')
  })

  test('leading whitespace before `* ` is tolerated', () => {
    const r = parseQuickAdd('  * task', ctx)
    expect(r.uncompletable).toBe(true)
    expect(r.title).toBe('task')
  })

  test('`* ` only counts at the start of the input', () => {
    const r = parseQuickAdd('buy * milk', ctx)
    expect(r.uncompletable).toBe(false)
    expect(r.title).toBe('buy * milk')
  })
})

describe('title assembly', () => {
  test('whitespace collapses after token removal', () => {
    const r = parseQuickAdd('fix   #work   bug   p1', ctx)
    expect(r.title).toBe('fix bug')
  })

  test('empty and whitespace-only inputs', () => {
    for (const input of ['', '   ']) {
      const r = parseQuickAdd(input, ctx)
      expect(r.title).toBe('')
      expect(r.priority).toBe(4)
      expect(r.tokens).toEqual([])
      expect(r.due).toBeNull()
    }
  })
})

describe('token integrity', () => {
  const busy =
    '* Team meeting tom 4pm for 30min {july 30} !15 min before p1 #Work /Admin @email @ops // bring slides'

  test('kitchen-sink input produces every token kind with exact spans', () => {
    const r = parseQuickAdd(busy, ctx)
    expect(r.title).toBe('Team meeting')
    expect(r.uncompletable).toBe(true)
    expect(r.due).toMatchObject({ date: '2026-07-16', time: '16:00', recurrence: null })
    expect(r.durationMin).toBe(30)
    expect(r.deadline).toBe('2026-07-30')
    expect(r.reminders).toEqual([{ kind: 'relative', minutesBefore: 15 }])
    expect(r.priority).toBe(1)
    expect(r.project).toBe('Work')
    expect(r.section).toBe('Admin')
    expect(r.labels).toEqual(['email', 'ops'])
    expect(r.description).toBe('bring slides')
    expect(r.tokens.map((t) => t.kind).sort()).toEqual([
      'deadline',
      'description',
      'due',
      'duration',
      'label',
      'label',
      'priority',
      'project',
      'reminder',
      'section',
      'uncompletable',
    ])
    for (const t of r.tokens) {
      expect(busy.slice(t.start, t.end)).toBe(t.text)
    }
    // tokens are sorted and non-overlapping
    for (let i = 1; i < r.tokens.length; i++) {
      const prev = r.tokens[i - 1]
      const cur = r.tokens[i]
      expect((cur?.start ?? 0) >= (prev?.end ?? 0)).toBe(true)
    }
  })

  test('offsets are UTF-16 code units (emoji-safe)', () => {
    const input = '\u{1F680} launch tomorrow 4pm p1'
    const r = parseQuickAdd(input, ctx)
    expect(r.title).toBe('\u{1F680} launch')
    expect(r.due).toMatchObject({ date: '2026-07-16', time: '16:00' })
    for (const t of r.tokens) expect(input.slice(t.start, t.end)).toBe(t.text)
  })

  test('due.string is re-parseable and excludes the duration', () => {
    const r = parseQuickAdd('sync today 4pm for 45min', ctx)
    expect(r.due?.string).toBe('today 4pm')
    const again = parseQuickAdd(r.due?.string ?? '', ctx)
    expect(again.due).toMatchObject({ date: '2026-07-15', time: '16:00' })
  })
})

describe('overlap resolution', () => {
  test('earlier-starting longer span wins', () => {
    const resolved = resolveOverlaps([
      { start: 5, end: 8 },
      { start: 0, end: 10 },
      { start: 0, end: 5 },
      { start: 12, end: 14 },
      { start: 13, end: 20 },
    ])
    expect(resolved).toEqual([
      { start: 0, end: 10 },
      { start: 12, end: 14 },
    ])
  })
})

describe('result shape', () => {
  test('parse result round-trips through ParsedQuickAddSchema', () => {
    const r = parseQuickAdd('Submit report tom 4pm p1 #Work /Admin @email !30 min before', ctx)
    expect(ParsedQuickAddSchema.parse(r)).toEqual(r)
  })
})
