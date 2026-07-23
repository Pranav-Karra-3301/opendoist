import { addDaysIso, dateInTz, diffDays, isoWeekday, type RecurrenceSpec } from '@opentask/core'
import { describe, expect, it } from 'vitest'
import { ICAL_WINDOW } from '../reminders/contracts'
import { buildTasksCalendar, feedEtag, type IcalTaskRow } from './feed'

const TZ = 'America/New_York'
const NOW = '2026-07-16T12:00:00.000Z' // 08:00 EDT → today = 2026-07-16
const OPTS = { publicUrl: null, timezone: TZ, now: NOW }

const TODAY = dateInTz(NOW, TZ)
const WINDOW_START = addDaysIso(TODAY, -ICAL_WINDOW.backDays) // 2026-06-15
const WINDOW_END = addDaysIso(TODAY, ICAL_WINDOW.forwardDays) // 2027-01-18

/** `every mon, fri at 09:00` (weekly pattern, one wall-clock time). */
const MON_FRI_9: RecurrenceSpec = {
  anchor: 'schedule',
  freq: 'weekly',
  interval: 1,
  weekdays: [1, 5],
  monthDays: [],
  ordinal: null,
  ordinals: [],
  dates: [],
  times: ['09:00'],
  starting: null,
  until: null,
}

const compact = (iso: string) => iso.replaceAll('-', '')
const fromCompact = (c: string) => `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}`
const veventCount = (body: string) => (body.match(/BEGIN:VEVENT/g) ?? []).length

describe('buildTasksCalendar', () => {
  const rows: IcalTaskRow[] = [
    {
      id: 't1',
      content: 'Pay rent',
      description: 'Landlord',
      dueDate: '2026-07-16', // in-window, timed
      dueTime: '17:00',
      durationMin: 45,
      recurrence: null,
      labels: ['money', 'home'],
    },
    {
      id: 't2',
      content: 'Renew passport',
      description: '', // omitted from output
      dueDate: '2026-07-20', // in-window, all-day
      dueTime: null,
      durationMin: null,
      recurrence: null,
      labels: [],
    },
    {
      id: 't3',
      content: 'Future thing',
      description: '',
      dueDate: '2027-06-01', // past window end → excluded
      dueTime: null,
      durationMin: null,
      recurrence: null,
      labels: [],
    },
    {
      id: 'r1',
      content: 'Standup',
      description: '',
      dueDate: '2026-07-17', // Friday, first occurrence
      dueTime: '09:00',
      durationMin: null,
      recurrence: MON_FRI_9,
      labels: ['work'],
    },
  ]

  const body = buildTasksCalendar(rows, OPTS)

  // Count of Mon/Fri occurrences the recurring row should yield across the window.
  let recurringCount = 0
  for (let d = '2026-07-17'; d <= WINDOW_END; d = addDaysIso(d, 1)) {
    const wd = isoWeekday(d)
    if (wd === 1 || wd === 5) recurringCount += 1
  }

  it('matches the full-string snapshot (deterministic given now)', () => {
    expect(body).toMatchSnapshot()
  })

  it('is byte-identical across repeated builds of the same input', () => {
    expect(buildTasksCalendar(rows, OPTS)).toBe(body)
  })

  it('emits VCALENDAR headers with the frozen prodId, name and ttl', () => {
    expect(body.startsWith('BEGIN:VCALENDAR')).toBe(true)
    expect(body).toContain('PRODID:-//opentask//tasks//EN')
    expect(body).toContain('NAME:OpenTask — Tasks')
    expect(body).toContain('X-PUBLISHED-TTL:PT1H')
  })

  it('includes both in-window non-recurring events plus every recurring occurrence', () => {
    expect(veventCount(body)).toBe(2 + recurringCount)
  })

  it('renders the timed event as a UTC instant with a duration-derived DTEND', () => {
    // 17:00 EDT = 21:00Z; +45 min = 21:45Z
    expect(body).toContain('UID:task-t1@opentask')
    expect(body).toContain('DTSTART:20260716T210000Z')
    expect(body).toContain('DTEND:20260716T214500Z')
    expect(body).toContain('CATEGORIES:money,home')
    expect(body).toContain('DESCRIPTION:Landlord')
  })

  it('renders the date-only event as DTSTART;VALUE=DATE with a per-task UID', () => {
    expect(body).toContain('UID:task-t2@opentask')
    expect(body).toContain('DTSTART;VALUE=DATE:20260720')
  })

  it('only sets DESCRIPTION when the task has one', () => {
    // t1 is the only fixture row with a non-empty description
    expect((body.match(/DESCRIPTION:/g) ?? []).length).toBe(1)
  })

  it('excludes tasks whose due date is outside the window', () => {
    expect(body).not.toContain('Future thing')
    expect(body).not.toContain('task-t3')
  })

  it('expands the recurrence to Mon/Fri occurrences only, within the window, with stable UIDs', () => {
    const uids = [...body.matchAll(/UID:task-r1-(\d{8})@opentask/g)].map((m) => m[1] as string)
    expect(uids.length).toBe(recurringCount)
    expect(body).toContain('UID:task-r1-20260717@opentask')
    for (const yyyymmdd of uids) {
      const iso = fromCompact(yyyymmdd)
      expect([1, 5]).toContain(isoWeekday(iso))
      expect(iso >= '2026-07-17').toBe(true)
      expect(iso <= WINDOW_END).toBe(true)
    }
  })

  it('applies DST correctly across the fall-back boundary (EDT→EST)', () => {
    const uids = [...body.matchAll(/UID:task-r1-(\d{8})@opentask/g)].map((m) => m[1] as string)
    // Summer occurrence: 09:00 EDT (UTC-4) → 13:00Z
    expect(body).toContain('DTSTART:20260717T130000Z')
    // Winter occurrence: 09:00 EST (UTC-5) → 14:00Z (any December occurrence is firmly in EST)
    const winter = uids.map(fromCompact).find((d) => d >= '2026-12-01')
    expect(winter).toBeDefined()
    expect(body).toContain(`DTSTART:${compact(winter as string)}T140000Z`)
  })

  it('starts the recurrence no earlier than the window start', () => {
    expect(WINDOW_START).toBe('2026-06-15')
    expect(body).not.toContain('UID:task-r1-20260615@opentask')
  })
})

describe('buildTasksCalendar — window clamp and event cap', () => {
  it('clamps a daily recurrence to the forward window, not its natural horizon', () => {
    const daily: RecurrenceSpec = {
      anchor: 'schedule',
      freq: 'daily',
      interval: 1,
      weekdays: [],
      monthDays: [],
      ordinal: null,
      ordinals: [],
      dates: [],
      times: [],
      starting: null,
      until: addDaysIso(TODAY, 400), // would run 400 days, but the window ends at +186
    }
    const row: IcalTaskRow = {
      id: 'd1',
      content: 'Water plants',
      description: '',
      dueDate: TODAY,
      dueTime: null,
      durationMin: null,
      recurrence: daily,
      labels: [],
    }
    const body = buildTasksCalendar([row], OPTS)
    // today .. window end inclusive
    expect(veventCount(body)).toBe(diffDays(TODAY, WINDOW_END) + 1)
    const dates = [...body.matchAll(/DTSTART;VALUE=DATE:(\d{8})/g)].map((m) =>
      fromCompact(m[1] as string),
    )
    expect(dates.length).toBeGreaterThan(0)
    for (const d of dates) expect(d <= WINDOW_END).toBe(true)
  })

  it('caps total events at ICAL_WINDOW.maxEvents after sorting', () => {
    const rows: IcalTaskRow[] = Array.from({ length: 600 }, (_, i) => ({
      id: `bulk${i}`,
      content: `Task ${i}`,
      description: '',
      dueDate: TODAY,
      dueTime: null,
      durationMin: null,
      recurrence: null,
      labels: [],
    }))
    const body = buildTasksCalendar(rows, OPTS)
    expect(veventCount(body)).toBe(ICAL_WINDOW.maxEvents)
  })
})

describe('feedEtag', () => {
  it('is a quoted sha256 prefix that is stable per body and varies across bodies', () => {
    const tag = feedEtag('hello')
    expect(tag).toMatch(/^"sha256-[0-9a-f]{32}"$/)
    expect(feedEtag('hello')).toBe(tag)
    expect(feedEtag('world')).not.toBe(tag)
  })
})
