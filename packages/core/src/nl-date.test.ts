import { describe, expect, test } from 'vitest'
import { findDateSpans, resolveNaturalDate } from './nl-date'
import { DEFAULT_PARSE_CONTEXT_SETTINGS, type ParseContext } from './types'

// Wed Jul 15 2026, 5pm in New York (21:00 UTC)
const ctx: ParseContext = {
  now: '2026-07-15T21:00:00Z',
  timezone: 'America/New_York',
  ...DEFAULT_PARSE_CONTEXT_SETTINGS,
}

describe('resolveNaturalDate behavior table', () => {
  test.each<[string, string, string | null]>([
    ['today', '2026-07-15', null],
    ['tod', '2026-07-15', null],
    ['tomorrow', '2026-07-16', null],
    ['tom', '2026-07-16', null],
    ['tom 4pm', '2026-07-16', '16:00'],
    ['6pm', '2026-07-15', '18:00'], // not yet passed locally (now 17:00)
    ['4pm', '2026-07-16', '16:00'], // already passed locally
    ['27th', '2026-07-27', null],
    ['27', '2026-07-27', null], // bare number ≤31 = next 27th
    ['mid january', '2027-01-15', null],
    ['end of month', '2026-07-31', null],
    ['next friday', '2026-07-24', null], // Friday of next week, not this week's
    ['this weekend', '2026-07-18', null], // upcoming Saturday (ctx.weekendDay)
    ['next week', '2026-07-20', null], // next Monday (ctx.nextWeekDay)
    ['later this week', '2026-07-17', null], // two days out, capped at Sunday
    ['in 5 days', '2026-07-20', null],
    ['+5 days', '2026-07-20', null],
    ['in 3 weeks', '2026-08-05', null],
    ['fri at 1900', '2026-07-17', '19:00'],
    ['Fri @ 7pm', '2026-07-17', '19:00'],
    ['fri at 19:00', '2026-07-17', '19:00'],
    ['tom morning', '2026-07-16', '09:00'],
    ['in the morning', '2026-07-16', '09:00'], // 09:00 already passed → rolls forward
    ['in the afternoon', '2026-07-16', '12:00'], // 12:00 already passed → rolls forward
    ['in the evening', '2026-07-15', '19:00'], // 19:00 not yet passed → today
    ['new year day', '2027-01-01', null],
    ['valentine', '2027-02-14', null],
    ['halloween', '2026-10-31', null],
    ['new year eve', '2026-12-31', null],
    ['mar 30', '2027-03-30', null], // forward past dates into next year
    // ordinal + full month name stays one phrase (regression: '3rd'/'27th' were split off)
    ['27th january', '2027-01-27', null],
    ['3rd of july', '2027-07-03', null],
    ['27th of january', '2027-01-27', null],
    ['3rd of jul', '2027-07-03', null], // abbreviated control
    // compound offsets before custom-layer anchors (dossier §1.2 Compound)
    ["50 days before new year's eve", '2026-11-11', null],
    ['2 weeks before halloween', '2026-10-17', null],
    ['1 month before valentine', '2027-01-14', null],
    ['6 weeks before 21 Jul', '2026-06-09', null], // chrono-native anchor control
  ])('%s → %s %s', (input, date, time) => {
    expect(resolveNaturalDate(input, ctx)).toEqual({ date, time })
  })

  test.each(['buy milk', 'p1', '', '   ', 'hello world 99'])('non-date %j → null', (input) => {
    expect(resolveNaturalDate(input, ctx)).toBeNull()
  })

  test('bare numbers above 31 are not dates', () => {
    expect(resolveNaturalDate('45', ctx)).toBeNull()
  })

  test('bare number past this month rolls to next month', () => {
    expect(resolveNaturalDate('3', ctx)).toEqual({ date: '2026-08-03', time: null })
  })

  test('respects weekendDay/nextWeekDay settings', () => {
    expect(resolveNaturalDate('this weekend', { ...ctx, weekendDay: 7 })).toEqual({
      date: '2026-07-19',
      time: null,
    })
    expect(resolveNaturalDate('next week', { ...ctx, nextWeekDay: 3 })).toEqual({
      date: '2026-07-22',
      time: null,
    })
  })
})

describe('findDateSpans', () => {
  test('finds a phrase with correct offsets into the original input', () => {
    const input = 'call mom tomorrow'
    const spans = findDateSpans(input, ctx)
    expect(spans).toHaveLength(1)
    const s = spans[0]
    expect(s).toMatchObject({ date: '2026-07-16', time: null, durationMin: null })
    expect(input.slice(s?.start ?? 0, s?.end ?? 0)).toBe('tomorrow')
    expect(s?.text).toBe('tomorrow')
  })

  test('date+time phrase with trailing duration', () => {
    const input = 'Team meeting today 4pm for 45min then dinner'
    const spans = findDateSpans(input, ctx)
    expect(spans).toHaveLength(1)
    const s = spans[0]
    expect(s).toMatchObject({ date: '2026-07-15', time: '16:00', durationMin: 45 })
    expect(s?.text).toBe('today 4pm for 45min')
    expect(input.slice(s?.start ?? 0, s?.end ?? 0)).toBe('today 4pm for 45min')
  })

  test.each<[string, number]>([
    ['standup tom 9am for 2h', 120],
    ['review tom 4pm for 1 hour 30 minutes', 90],
    ['deep work tom 9am for 45 minutes', 45],
  ])('duration forms: %s → %d min', (input, minutes) => {
    const spans = findDateSpans(input, ctx)
    expect(spans[0]?.durationMin).toBe(minutes)
  })

  test('duration is ignored without a time', () => {
    const spans = findDateSpans('gym tomorrow for 45min', ctx)
    expect(spans[0]).toMatchObject({ date: '2026-07-16', time: null, durationMin: null })
    expect(spans[0]?.text).toBe('tomorrow')
  })

  test('duration caps at 24h', () => {
    expect(findDateSpans('trip tom 9am for 30 hours', ctx)[0]?.durationMin).toBe(1440)
  })

  test('bare numbers in free text are not date spans', () => {
    expect(findDateSpans('buy 27 eggs', ctx)).toEqual([])
    expect(findDateSpans('order 12 roses', ctx)).toEqual([])
  })

  test('ordinal day inside free text is a span', () => {
    const spans = findDateSpans('pay rent 27th', ctx)
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ date: '2026-07-27', time: null })
    expect(spans[0]?.text).toBe('27th')
  })

  test('ordinal followed by a full month name is a single span (regression)', () => {
    const spans = findDateSpans('picnic 3rd of july', ctx)
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ date: '2027-07-03', time: null })
    expect(spans[0]?.text).toBe('3rd of july')
    const spans2 = findDateSpans('buy gift 27th january', ctx)
    expect(spans2).toHaveLength(1)
    expect(spans2[0]).toMatchObject({ date: '2027-01-27', time: null })
    expect(spans2[0]?.text).toBe('27th january')
  })

  test('compound offset before a custom anchor spans the whole phrase (regression)', () => {
    // was: chrono read the orphaned '50 days before' as '50 days ago' (a past date)
    const input = "renew stuff 50 days before new year's eve"
    const spans = findDateSpans(input, ctx)
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ date: '2026-11-11', time: null })
    expect(spans[0]?.text).toBe("50 days before new year's eve")
    expect(input.slice(spans[0]?.start ?? 0, spans[0]?.end ?? 0)).toBe(spans[0]?.text)
  })

  test('merges weekday with @-time', () => {
    const input = 'dinner Fri @ 7pm'
    const spans = findDateSpans(input, ctx)
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ date: '2026-07-17', time: '19:00' })
    expect(spans[0]?.text).toBe('Fri @ 7pm')
  })

  test('no spans in plain text', () => {
    expect(findDateSpans('refactor the parser module', ctx)).toEqual([])
  })

  test('multiple independent spans keep order', () => {
    const spans = findDateSpans('dentist tomorrow and gym friday', ctx)
    expect(spans.map((s) => s.date)).toEqual(['2026-07-16', '2026-07-17'])
  })
})
