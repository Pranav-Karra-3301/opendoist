import { describe, expect, test } from 'vitest'
import {
  DEFAULT_PARSE_CONTEXT_SETTINGS,
  type ParseContext,
  type Priority,
  type ReminderDraft,
  type TokenKind,
} from '../types'
import { parseQuickAdd } from './index'

const ctx: ParseContext = {
  now: '2026-07-15T21:00:00Z', // Wed, 5pm in New York
  timezone: 'America/New_York',
  ...DEFAULT_PARSE_CONTEXT_SETTINGS,
}

/* ------------------------------------------------------------------ */
/* Canonical examples from the implementation plan (kept verbatim)     */
/* ------------------------------------------------------------------ */

test('plain title', () => {
  const r = parseQuickAdd('buy milk', ctx)
  expect(r.title).toBe('buy milk')
  expect(r.due).toBeNull()
  expect(r.priority).toBe(4)
  expect(r.tokens).toEqual([])
})

test('date + time + priority + project + section + label', () => {
  const r = parseQuickAdd('Submit report tom 4pm p1 #Work /Admin @email', ctx)
  expect(r.title).toBe('Submit report')
  expect(r.due).toMatchObject({ date: '2026-07-16', time: '16:00', recurrence: null })
  expect(r.priority).toBe(1)
  expect(r.project).toBe('Work')
  expect(r.section).toBe('Admin')
  expect(r.labels).toEqual(['email'])
  expect(r.tokens.map((t) => t.kind).sort()).toEqual([
    'due',
    'label',
    'priority',
    'project',
    'section',
  ])
})

test('deadline in braces + relative reminder + duration', () => {
  const r = parseQuickAdd('Team meeting today 4pm for 45min {july 30} !30 min before', ctx)
  expect(r.due).toMatchObject({ date: '2026-07-15', time: '16:00' })
  expect(r.durationMin).toBe(45)
  expect(r.deadline).toEqual({ date: '2026-07-30', time: null })
  expect(r.reminders).toEqual([{ kind: 'relative', minutesBefore: 30 }])
})

test('bare time rolls forward', () => {
  expect(parseQuickAdd('do laundry 4pm', ctx).due).toMatchObject({
    date: '2026-07-16',
    time: '16:00',
  })
  expect(parseQuickAdd('do laundry 6pm', ctx).due).toMatchObject({
    date: '2026-07-15',
    time: '18:00',
  })
})

test('uncompletable + description extension', () => {
  const r = parseQuickAdd('* Flight check-in tod // gate closes 30m before', ctx)
  expect(r.uncompletable).toBe(true)
  expect(r.title).toBe('Flight check-in')
  expect(r.due?.date).toBe('2026-07-15')
  expect(r.description).toBe('gate closes 30m before')
})

test('last priority wins, quoted project', () => {
  const r = parseQuickAdd('fix bug p3 p1 #"Movie Watchlist"', ctx)
  expect(r.priority).toBe(1)
  expect(r.project).toBe('Movie Watchlist')
  expect(r.title).toBe('fix bug p3')
})

test('smartDate off keeps sigils, drops bare dates', () => {
  const r = parseQuickAdd('call mom tomorrow p2 @family', { ...ctx, smartDate: false })
  expect(r.due).toBeNull()
  expect(r.title).toBe('call mom tomorrow')
  expect(r.priority).toBe(2)
  expect(r.labels).toEqual(['family'])
})

/* ------------------------------------------------------------------ */
/* Golden table — dossier §1.1 (Quick Add syntax) + §1.2 (NL dates)    */
/* ------------------------------------------------------------------ */

interface GoldenRow {
  input: string
  title: string
  /** expected due date; null asserts no due at all */
  date?: string | null
  /** expected due time (null = all-day) */
  time?: string | null
  dur?: number | null
  /** expected deadline date; null asserts no deadline at all */
  deadline?: string | null
  /** expected deadline wall-clock time (null = date-only) */
  deadlineTime?: string | null
  priority?: Priority
  labels?: string[]
  project?: string | null
  section?: string | null
  description?: string | null
  uncompletable?: boolean
  reminders?: ReminderDraft[]
  /** expected token kinds, sorted */
  kinds?: TokenKind[]
}

function checkRow(row: GoldenRow, rowCtx: ParseContext = ctx): void {
  const r = parseQuickAdd(row.input, rowCtx)
  expect(r.title).toBe(row.title)
  if (row.date !== undefined) {
    if (row.date === null) expect(r.due).toBeNull()
    else expect(r.due?.date).toBe(row.date)
  }
  if (row.time !== undefined) expect(r.due?.time ?? null).toBe(row.time)
  if (row.dur !== undefined) expect(r.durationMin).toBe(row.dur)
  if (row.deadline !== undefined) expect(r.deadline?.date ?? null).toBe(row.deadline)
  if (row.deadlineTime !== undefined) expect(r.deadline?.time ?? null).toBe(row.deadlineTime)
  if (row.priority !== undefined) expect(r.priority).toBe(row.priority)
  if (row.labels !== undefined) expect(r.labels).toEqual(row.labels)
  if (row.project !== undefined) expect(r.project).toBe(row.project)
  if (row.section !== undefined) expect(r.section).toBe(row.section)
  if (row.description !== undefined) expect(r.description).toBe(row.description)
  if (row.uncompletable !== undefined) expect(r.uncompletable).toBe(row.uncompletable)
  if (row.reminders !== undefined) expect(r.reminders).toEqual(row.reminders)
  if (row.kinds !== undefined) expect(r.tokens.map((t) => t.kind).sort()).toEqual(row.kinds)
  // invariant: every token span reproduces its text from the original input
  for (const t of r.tokens) expect(row.input.slice(t.start, t.end)).toBe(t.text)
}

describe('golden table — due dates (dossier §1.2 shortcuts, relative, holidays)', () => {
  test.each<GoldenRow>([
    { input: 'pay rent tod', title: 'pay rent', date: '2026-07-15', time: null, kinds: ['due'] },
    { input: 'pay rent today', title: 'pay rent', date: '2026-07-15', time: null },
    { input: 'call mom tom', title: 'call mom', date: '2026-07-16', time: null },
    { input: 'call mom tomorrow', title: 'call mom', date: '2026-07-16', time: null },
    { input: 'pay rent 27th', title: 'pay rent', date: '2026-07-27', time: null },
    { input: 'dentist mid january', title: 'dentist', date: '2027-01-15' },
    { input: 'report end of month', title: 'report', date: '2026-07-31' },
    { input: 'invoice in 5 days', title: 'invoice', date: '2026-07-20' },
    { input: 'invoice +5 days', title: 'invoice', date: '2026-07-20' },
    { input: 'trip in 3 weeks', title: 'trip', date: '2026-08-05' },
    { input: 'review next friday', title: 'review', date: '2026-07-24' },
    { input: 'hike this weekend', title: 'hike', date: '2026-07-18' },
    { input: 'groceries next week', title: 'groceries', date: '2026-07-20' },
    { input: 'essay later this week', title: 'essay', date: '2026-07-17' },
    { input: 'plant flowers mar 30', title: 'plant flowers', date: '2027-03-30' },
    { input: 'PAY RENT TOMORROW', title: 'PAY RENT', date: '2026-07-16' },
    // dossier §1.2 compound form (chrono anchors on the target date, no forward roll)
    { input: 'renew domain 6 weeks before 21 Jul', title: 'renew domain', date: '2026-06-09' },
    // compound offsets before custom-layer anchors (regression: '50 days before' was read
    // as '50 days ago' because the holiday anchor got masked before chrono ran)
    {
      input: "renew stuff 50 days before new year's eve",
      title: 'renew stuff',
      date: '2026-11-11',
      kinds: ['due'],
    },
    { input: 'decorate 2 weeks before halloween', title: 'decorate', date: '2026-10-17' },
    // ordinal + full month name (regression: '27th'/'3rd' were split from the month word)
    { input: 'buy gift 27th january', title: 'buy gift', date: '2027-01-27', kinds: ['due'] },
    { input: 'picnic 3rd of july', title: 'picnic', date: '2027-07-03', kinds: ['due'] },
    { input: 'party new year day', title: 'party', date: '2027-01-01' },
    { input: 'roses valentine', title: 'roses', date: '2027-02-14' },
    { input: 'buy candy halloween', title: 'buy candy', date: '2026-10-31' },
    { input: 'fireworks new year eve', title: 'fireworks', date: '2026-12-31' },
    // bare numbers in free text are never dates
    { input: 'pay rent 27', title: 'pay rent 27', date: null },
    { input: 'buy 27 eggs', title: 'buy 27 eggs', date: null },
  ])('$input', (row) => checkRow(row))
})

describe('golden table — times (dossier §1.2)', () => {
  test.each<GoldenRow>([
    { input: 'dinner tomorrow at 4 pm', title: 'dinner', date: '2026-07-16', time: '16:00' },
    { input: 'do laundry 6pm', title: 'do laundry', date: '2026-07-15', time: '18:00' },
    { input: 'do laundry 4pm', title: 'do laundry', date: '2026-07-16', time: '16:00' },
    { input: 'dinner Fri @ 7pm', title: 'dinner', date: '2026-07-17', time: '19:00' },
    { input: 'dinner fri at 1900', title: 'dinner', date: '2026-07-17', time: '19:00' },
    { input: 'dinner fri at 19:00', title: 'dinner', date: '2026-07-17', time: '19:00' },
    { input: 'run tom morning', title: 'run', date: '2026-07-16', time: '09:00' },
    { input: 'standup in the morning', title: 'standup', date: '2026-07-16', time: '09:00' },
    {
      input: 'call plumber in the afternoon',
      title: 'call plumber',
      date: '2026-07-16',
      time: '12:00',
    },
    { input: 'read in the evening', title: 'read', date: '2026-07-15', time: '19:00' },
    { input: 'errands sat 10am', title: 'errands', date: '2026-07-18', time: '10:00' },
  ])('$input', (row) => checkRow(row))
})

describe('golden table — durations (dossier §1.1, `for <length>` after a time)', () => {
  test.each<GoldenRow>([
    {
      input: 'Team meeting tomorrow at 10:00 AM for 25 minutes',
      title: 'Team meeting',
      date: '2026-07-16',
      time: '10:00',
      dur: 25,
      kinds: ['due', 'duration'],
    },
    { input: 'deep work tom 9am for 2h', title: 'deep work', date: '2026-07-16', dur: 120 },
    { input: 'focus tom 9am for 1 hour 30 minutes', title: 'focus', dur: 90 },
    { input: 'trip prep tom 9am for 30 hours', title: 'trip prep', dur: 1440 }, // capped at 24h
    // a duration only attaches to a timed due
    {
      input: 'gym tomorrow for 45min',
      title: 'gym for 45min',
      date: '2026-07-16',
      time: null,
      dur: null,
      kinds: ['due'],
    },
    // durations attach to timed recurring dues too (regression: ' for 1h' leaked into title)
    {
      input: 'gym every mon 6pm for 1h',
      title: 'gym',
      date: '2026-07-20',
      time: '18:00',
      dur: 60,
      kinds: ['due', 'duration'],
    },
    // ...but not to an untimed recurring due
    {
      input: 'gym every mon for 1h',
      title: 'gym for 1h',
      date: '2026-07-20',
      time: null,
      dur: null,
      kinds: ['due'],
    },
  ])('$input', (row) => checkRow(row))
})

describe('golden table — deadlines (dossier §1.1, `{natural date}`)', () => {
  test.each<GoldenRow>([
    {
      input: 'renew passport {march 30}',
      title: 'renew passport',
      deadline: '2027-03-30',
      date: null,
      kinds: ['deadline'],
    },
    { input: 'file taxes {next friday}', title: 'file taxes', deadline: '2026-07-24' },
    {
      input: 'pay invoice tom {end of month}',
      title: 'pay invoice',
      date: '2026-07-16',
      deadline: '2026-07-31',
      kinds: ['deadline', 'due'],
    },
    // deadline time (owner divergence 2026-07-18): a time inside braces is NO LONGER an error —
    // `{…}` carries an optional wall-clock time end-to-end (12h/24h, single or with minutes)
    {
      input: 'standup {tomorrow 4pm}',
      title: 'standup',
      deadline: '2026-07-16',
      deadlineTime: '16:00',
      date: null,
      kinds: ['deadline'],
    },
    {
      input: 'wire retainer {next friday 5pm}',
      title: 'wire retainer',
      deadline: '2026-07-24',
      deadlineTime: '17:00',
      kinds: ['deadline'],
    },
    {
      input: 'demo prep {next friday 5:30pm}',
      title: 'demo prep',
      deadline: '2026-07-24',
      deadlineTime: '17:30',
    },
    {
      input: 'dentist {sat 10am}',
      title: 'dentist',
      deadline: '2026-07-18',
      deadlineTime: '10:00',
    },
    {
      input: 'file 1099 {aug 1 09:00}',
      title: 'file 1099',
      deadline: '2026-08-01',
      deadlineTime: '09:00',
    },
    {
      input: 'cutover {fri 19:00}',
      title: 'cutover',
      deadline: '2026-07-17',
      deadlineTime: '19:00',
    },
    // date-only phrases keep time null
    {
      input: 'renew visa {tomorrow}',
      title: 'renew visa',
      deadline: '2026-07-16',
      deadlineTime: null,
      kinds: ['deadline'],
    },
    { input: 'taxes {mar 30}', title: 'taxes', deadline: '2027-03-30', deadlineTime: null },
    // a timed deadline coexists with a timed due + duration without interfering
    {
      input: 'launch tom 9am for 1h {next friday 5pm}',
      title: 'launch',
      date: '2026-07-16',
      time: '09:00',
      dur: 60,
      deadline: '2026-07-24',
      deadlineTime: '17:00',
      kinds: ['deadline', 'due', 'duration'],
    },
    // unresolvable phrases stay literal text with no deadline (never date-scanned)
    { input: 'groceries {whenever}', title: 'groceries {whenever}', deadline: null, kinds: [] },
    {
      input: 'ship notes {sometime next week}',
      title: 'ship notes {sometime next week}',
      deadline: null,
      date: null,
      kinds: [],
    },
    // duplicate deadline: last one wins, earlier stays plain text
    {
      input: 'submit thesis {july 30} {aug 2}',
      title: 'submit thesis {july 30}',
      deadline: '2026-08-02',
    },
  ])('$input', (row) => checkRow(row))
})

describe('golden table — priorities (dossier §1.1, p1–p4)', () => {
  test.each<GoldenRow>([
    { input: 'Submit report p1', title: 'Submit report', priority: 1, kinds: ['priority'] },
    { input: 'deploy P2', title: 'deploy', priority: 2 },
    { input: 'clean garage p3', title: 'clean garage', priority: 3 },
    { input: 'someday maybe p4', title: 'someday maybe', priority: 4, kinds: ['priority'] },
    { input: 'ship p5 build', title: 'ship p5 build', priority: 4, kinds: [] },
    { input: 'api p10 fix', title: 'api p10 fix', priority: 4 },
    { input: 'merge pr1', title: 'merge pr1', priority: 4 },
    { input: 'fix bug p3 p1', title: 'fix bug p3', priority: 1 },
  ])('$input', (row) => checkRow(row))
})

describe('golden table — project, section, label (dossier §1.1)', () => {
  test.each<GoldenRow>([
    { input: 'plan offsite #Work', title: 'plan offsite', project: 'Work', kinds: ['project'] },
    {
      input: 'plan offsite #Work /Admin',
      title: 'plan offsite',
      project: 'Work',
      section: 'Admin',
      kinds: ['project', 'section'],
    },
    { input: 'watch dune #"Movie Watchlist"', title: 'watch dune', project: 'Movie Watchlist' },
    { input: 'plan #Work /"Q3 Planning"', title: 'plan', project: 'Work', section: 'Q3 Planning' },
    // a section needs a project token somewhere in the input
    { input: 'review notes /Admin', title: 'review notes /Admin', section: null, kinds: [] },
    { input: '/Admin #Work review', title: 'review', project: 'Work', section: 'Admin' },
    // duplicate project: last wins, earlier stays plain text
    { input: 'fix login #alpha #beta', title: 'fix login #alpha', project: 'beta' },
    { input: 'write summary @email', title: 'write summary', labels: ['email'], kinds: ['label'] },
    // labels accumulate and dedupe (first spelling wins), all occurrences tokenize
    {
      input: 'sync @email @Email @urgent',
      title: 'sync',
      labels: ['email', 'urgent'],
      kinds: ['label', 'label', 'label'],
    },
    { input: 'read book @"deep work"', title: 'read book', labels: ['deep work'] },
    // sigils need a word boundary
    {
      input: 'email team@example.com tomorrow',
      title: 'email team@example.com',
      labels: [],
      date: '2026-07-16',
    },
    // sigil tokens win over date phrases
    { input: 'drinks @7pm', title: 'drinks', labels: ['7pm'], date: null },
    // assignee syntax is not supported (single-user app): stays plain text
    { input: '+Lucile review deck', title: '+Lucile review deck', kinds: [] },
  ])('$input', (row) => checkRow(row))
})

describe('golden table — reminders (dossier §1.1/§1.5, `!…`)', () => {
  test.each<GoldenRow>([
    {
      input: 'call bank !14:00',
      title: 'call bank',
      date: null,
      reminders: [{ kind: 'absolute', date: '2026-07-16', time: '14:00' }],
      kinds: ['reminder'],
    },
    {
      input: 'standup tom 9am !15 min before',
      title: 'standup',
      date: '2026-07-16',
      time: '09:00',
      reminders: [{ kind: 'relative', minutesBefore: 15 }],
      kinds: ['due', 'reminder'],
    },
    {
      input: 'meds !2 hours before',
      title: 'meds',
      reminders: [{ kind: 'relative', minutesBefore: 120 }],
    },
    {
      input: 'flight check !tomorrow 9am',
      title: 'flight check',
      reminders: [{ kind: 'absolute', date: '2026-07-16', time: '09:00' }],
    },
    {
      input: 'pill !9pm',
      title: 'pill',
      reminders: [{ kind: 'absolute', date: '2026-07-15', time: '21:00' }],
    },
    // reminders are repeatable
    {
      input: 'checkin !14:00 !2 hours before',
      title: 'checkin',
      reminders: [
        { kind: 'absolute', date: '2026-07-16', time: '14:00' },
        { kind: 'relative', minutesBefore: 120 },
      ],
    },
    // `!` needs a word boundary before it
    { input: 'wow! amazing', title: 'wow! amazing', reminders: [], kinds: [] },
    // a date-only `!` phrase is not a reminder; the bare `!` stays text, the date still parses
    { input: 'ping !tomorrow', title: 'ping !', date: '2026-07-16', reminders: [] },
  ])('$input', (row) => checkRow(row))
})

describe('golden table — description, uncompletable, combinations', () => {
  test.each<GoldenRow>([
    {
      input: 'notes // remember the milk',
      title: 'notes',
      description: 'remember the milk',
      kinds: ['description'],
    },
    // the description part is never scanned for other tokens
    {
      input: 'plan trip // visit @museum p1 tomorrow',
      title: 'plan trip',
      description: 'visit @museum p1 tomorrow',
      labels: [],
      priority: 4,
      date: null,
    },
    // `//` without surrounding spaces does not split
    {
      input: 'read https://ex.com/a//b tomorrow',
      title: 'read https://ex.com/a//b',
      description: null,
      date: '2026-07-16',
    },
    {
      input: '* Flight check-in',
      title: 'Flight check-in',
      uncompletable: true,
      kinds: ['uncompletable'],
    },
    { input: '*not uncompletable', title: '*not uncompletable', uncompletable: false },
    // only the first date span becomes the due; later ones stay text
    {
      input: 'dentist tomorrow and gym friday',
      title: 'dentist and gym friday',
      date: '2026-07-16',
    },
  ])('$input', (row) => checkRow(row))
})

describe('golden table — context settings', () => {
  test('smartDate off: explicit {}, !, #, p still tokenize; bare dates do not', () => {
    const r = parseQuickAdd('submit {july 30} tomorrow !14:00 p1 #Work', {
      ...ctx,
      smartDate: false,
    })
    expect(r.due).toBeNull()
    expect(r.deadline).toEqual({ date: '2026-07-30', time: null })
    expect(r.reminders).toEqual([{ kind: 'absolute', date: '2026-07-16', time: '14:00' }])
    expect(r.priority).toBe(1)
    expect(r.project).toBe('Work')
    expect(r.title).toBe('submit tomorrow')
  })

  test('weekendDay setting shifts `this weekend`', () => {
    const r = parseQuickAdd('hike this weekend', { ...ctx, weekendDay: 7 })
    expect(r.due?.date).toBe('2026-07-19')
  })

  test('nextWeekDay setting shifts `next week`', () => {
    const r = parseQuickAdd('plan next week', { ...ctx, nextWeekDay: 3 })
    expect(r.due?.date).toBe('2026-07-22')
  })
})

/* ------------------------------------------------------------------ */
/* Recurrence goldens (dossier §1.3) — need the real recurrence engine */
/* ------------------------------------------------------------------ */

// un-skipped at integration (Task G) — real recurrence engine landed with Task C
describe('golden table — recurring dues (dossier §1.3)', () => {
  test('recurring due merges times', () => {
    const r = parseQuickAdd('team sync every mon, fri at 20:00', ctx)
    expect(r.due?.recurrence).toMatchObject({
      anchor: 'schedule',
      freq: 'weekly',
      weekdays: [1, 5],
      times: ['20:00'],
    })
    expect(r.due?.date).toBe('2026-07-17') // next occurrence: Fri
    expect(r.due?.time).toBe('20:00')
  })

  interface RecurrenceRow {
    input: string
    title: string
    date?: string
    time?: string | null
    rec: Record<string, unknown>
  }

  test.each<RecurrenceRow>([
    {
      input: 'water plants every day',
      title: 'water plants',
      date: '2026-07-16',
      time: null,
      rec: { anchor: 'schedule', freq: 'daily', interval: 1 },
    },
    {
      input: 'standup daily',
      title: 'standup',
      date: '2026-07-16',
      rec: { freq: 'daily', interval: 1 },
    },
    {
      input: 'gym every workday',
      title: 'gym',
      date: '2026-07-16',
      rec: { freq: 'weekly', weekdays: ['workday'] },
    },
    {
      input: 'inbox zero every weekday',
      title: 'inbox zero',
      date: '2026-07-16',
      rec: { freq: 'weekly', weekdays: ['workday'] },
    },
    {
      input: 'change filter every! 3 days',
      title: 'change filter',
      date: '2026-07-18',
      rec: { anchor: 'completion', freq: 'daily', interval: 3 },
    },
    {
      input: 'water cactus after 10 days',
      title: 'water cactus',
      date: '2026-07-25',
      rec: { anchor: 'completion', freq: 'daily', interval: 10 },
    },
    {
      input: 'stretch every 3 days',
      title: 'stretch',
      date: '2026-07-18',
      rec: { anchor: 'schedule', freq: 'daily', interval: 3 },
    },
    {
      input: 'journal every other day',
      title: 'journal',
      date: '2026-07-17',
      rec: { freq: 'daily', interval: 2 },
    },
    {
      input: 'rotate logs every! 3 hours',
      title: 'rotate logs',
      rec: { anchor: 'completion', freq: 'hourly', interval: 3 },
    },
    {
      input: 'review every other tue',
      title: 'review',
      date: '2026-07-21',
      rec: { freq: 'weekly', interval: 2, weekdays: [2] },
    },
    {
      input: 'payday every 3rd friday',
      title: 'payday',
      date: '2026-07-17',
      rec: { freq: 'monthly', ordinal: { nth: 3, unit: 'weekday', weekday: 5 } },
    },
    {
      input: 'rent every last day',
      title: 'rent',
      date: '2026-07-31',
      rec: { freq: 'monthly', ordinal: { nth: 'last', unit: 'day' } },
    },
    {
      input: 'invoice every last workday',
      title: 'invoice',
      date: '2026-07-31',
      rec: { freq: 'monthly', ordinal: { nth: 'last', unit: 'workday' } },
    },
    {
      // dossier §1.3 positional list (regression: silently degraded to a bogus one-off due)
      input: 'review every 15th workday, first workday, last workday',
      title: 'review',
      date: '2026-07-21',
      rec: {
        freq: 'monthly',
        ordinals: [
          { nth: 15, unit: 'workday' },
          { nth: 1, unit: 'workday' },
          { nth: 'last', unit: 'workday' },
        ],
      },
    },
    {
      // dossier §1.3 month-anchored positional (regression: same silent degradation)
      input: 'board meeting every 1st wed jan, 3rd thu jul',
      title: 'board meeting',
      date: '2026-07-16',
      rec: {
        freq: 'yearly',
        ordinals: [
          { nth: 1, unit: 'weekday', weekday: 3, month: 1 },
          { nth: 3, unit: 'weekday', weekday: 4, month: 7 },
        ],
      },
    },
    {
      input: 'team sync every mon, fri at 20:00',
      title: 'team sync',
      date: '2026-07-17',
      time: '20:00',
      rec: { freq: 'weekly', weekdays: [1, 5], times: ['20:00'] },
    },
    {
      input: 'pay bills every 2, 15, 27',
      title: 'pay bills',
      date: '2026-07-27',
      rec: { freq: 'monthly', monthDays: [2, 15, 27] },
    },
    {
      input: 'estimated taxes every 14 jan, 14 apr',
      title: 'estimated taxes',
      date: '2027-01-14',
      rec: {
        freq: 'yearly',
        dates: [
          { month: 1, day: 14 },
          { month: 4, day: 14 },
        ],
      },
    },
    {
      input: 'okr review every quarter',
      title: 'okr review',
      date: '2026-10-15',
      rec: { freq: 'monthly', interval: 3 },
    },
    {
      input: 'metrics quarterly',
      title: 'metrics',
      date: '2026-10-15',
      rec: { freq: 'monthly', interval: 3 },
    },
    {
      input: 'trash out ev monday',
      title: 'trash out',
      date: '2026-07-20',
      rec: { freq: 'weekly', weekdays: [1] },
    },
    {
      input: 'meds every day starting aug 1',
      title: 'meds',
      date: '2026-08-01',
      rec: { freq: 'daily', starting: '2026-08-01' },
    },
    {
      input: 'stretch everyday from 10 May until 20 May',
      title: 'stretch',
      date: '2027-05-10',
      rec: { freq: 'daily', starting: '2027-05-10', until: '2027-05-20' },
    },
    {
      input: 'course every day for 3 weeks',
      title: 'course',
      date: '2026-07-16',
      rec: { freq: 'daily', until: '2026-08-06' },
    },
    {
      input: 'backup every 12 hours starting at 9pm',
      title: 'backup',
      date: '2026-07-15',
      time: '21:00',
      rec: { freq: 'hourly', interval: 12, times: ['21:00'] },
    },
    { input: 'hydrate every hour', title: 'hydrate', rec: { freq: 'hourly', interval: 1 } },
    { input: 'sync notes weekly', title: 'sync notes', rec: { freq: 'weekly', interval: 1 } },
    { input: 'report monthly', title: 'report', rec: { freq: 'monthly', interval: 1 } },
    { input: 'renew domain yearly', title: 'renew domain', rec: { freq: 'yearly', interval: 1 } },
    // regression: 'annually'/'hourly' were missing from the quick-add trigger scan
    {
      input: 'renew domain annually',
      title: 'renew domain',
      rec: { freq: 'yearly', interval: 1 },
    },
    {
      input: 'check pipeline hourly',
      title: 'check pipeline',
      rec: { freq: 'hourly', interval: 1 },
    },
    {
      input: 'sprint retro every other Tuesday starting March 3',
      title: 'sprint retro',
      rec: { freq: 'weekly', interval: 2, weekdays: [2], starting: '2027-03-03' },
    },
    {
      input: 'audit every 3rd Tuesday starting Aug 29 ending in 6 months',
      title: 'audit',
      rec: {
        freq: 'monthly',
        ordinal: { nth: 3, unit: 'weekday', weekday: 2 },
        starting: '2026-08-29',
        until: '2027-01-15',
      },
    },
  ])('$input', (row) => {
    const r = parseQuickAdd(row.input, ctx)
    expect(r.title).toBe(row.title)
    expect(r.due).not.toBeNull()
    if (row.date !== undefined) expect(r.due?.date).toBe(row.date)
    if (row.time !== undefined) expect(r.due?.time ?? null).toBe(row.time)
    expect(r.due?.recurrence).toMatchObject(row.rec)
    for (const t of r.tokens) expect(row.input.slice(t.start, t.end)).toBe(t.text)
  })

  test('recurring reminder: !every day 5pm', () => {
    const r = parseQuickAdd('take pills !every day 5pm', ctx)
    expect(r.title).toBe('take pills')
    expect(r.due).toBeNull()
    expect(r.reminders).toHaveLength(1)
    const rem = r.reminders[0]
    expect(rem?.kind).toBe('recurring')
    if (rem?.kind === 'recurring') {
      expect(rem.due.time).toBe('17:00')
      expect(rem.due.recurrence).toMatchObject({ freq: 'daily' })
    }
  })
})

// NOTE on deliberate omissions from dossier §1.2–1.3:
// - per-day different times (`every mon at 8pm, tue at 9pm`) are unsupported per dossier §1.3
//   ("Not supported"), and so are exclusion rules ("except weekends"); everything else in the
//   dossier grammar — compound offsets on custom anchors, positional lists, and month-anchored
//   positionals (`ordinals` in RecurrenceSpec) — is covered above.
