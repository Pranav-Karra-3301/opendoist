/**
 * Pure iCal (RFC 5545) generation for the public tasks feed. No DB and no HTTP — the route layer
 * (`routes.ts`) loads the rows and serves the string. Recurrences are expanded server-side via the
 * frozen core `nextOccurrence` (NO `RRULE` is emitted) so every calendar client, however weak its
 * RRULE support, sees identical pre-materialized events. Output is fully deterministic given
 * `opts.now` — it drives both the visibility window and every `DTSTAMP` — which lets the route
 * compute a stable ETag and lets tests snapshot the entire body.
 */
import { createHash } from 'node:crypto'
import {
  addDaysIso,
  DEFAULT_PARSE_CONTEXT_SETTINGS,
  dateInTz,
  instantFor,
  nextOccurrence,
  type ParseContext,
  type RecurrenceSpec,
} from '@opentask/core'
import ical, { type ICalEventData } from 'ical-generator'
import { ICAL_WINDOW, taskDeepLink } from '../reminders/contracts'

export interface IcalTaskRow {
  id: string
  content: string
  description: string
  dueDate: string
  dueTime: string | null
  durationMin: number | null
  recurrence: RecurrenceSpec | null
  labels: string[]
}

/** VEVENT length for a timed task with no explicit duration. */
const DEFAULT_DURATION_MIN = 30
/**
 * Safety bound on per-task recurrence expansion. Kept well above the global `maxEvents` cap so a
 * single misbehaving spec cannot spin forever, yet can never drop an event that would survive the
 * post-sort cap (the earliest `maxEvents` across all tasks are always collected first).
 */
const MAX_EXPAND_ITERATIONS = ICAL_WINDOW.maxEvents * 4

interface FeedEvent {
  uid: string
  /** epoch ms of the occurrence start — the chronological sort/cap key. */
  sortKey: number
  start: Date
  end: Date | null
  allDay: boolean
  summary: string
  description: string
  url: string
  categories: string[]
}

/** Build the VEVENT model for one occurrence (calendar date + optional wall-clock time). */
function makeEvent(
  row: IcalTaskRow,
  occ: { date: string; time: string | null },
  uid: string,
  timezone: string,
  publicUrl: string | null,
): FeedEvent {
  const shared = {
    uid,
    summary: row.content,
    description: row.description,
    url: taskDeepLink(publicUrl, row.id),
    categories: row.labels,
  }
  if (occ.time === null) {
    // All-day → DTSTART;VALUE=DATE. A UTC-midnight Date makes ical-generator emit exactly this
    // calendar date (it reads UTC components for all-day events), independent of the host TZ.
    return {
      ...shared,
      allDay: true,
      start: new Date(`${occ.date}T00:00:00.000Z`),
      end: null,
      sortKey: Date.parse(instantFor(occ.date, '00:00', timezone)),
    }
  }
  const startMs = Date.parse(instantFor(occ.date, occ.time, timezone))
  return {
    ...shared,
    allDay: false,
    start: new Date(startMs),
    end: new Date(startMs + (row.durationMin ?? DEFAULT_DURATION_MIN) * 60_000),
    sortKey: startMs,
  }
}

/** Occurrences of one task whose calendar date lands within `[windowStart, windowEnd]`. */
function eventsForRow(
  row: IcalTaskRow,
  ctx: ParseContext,
  windowStart: string,
  windowEnd: string,
  publicUrl: string | null,
): FeedEvent[] {
  if (row.recurrence === null) {
    if (row.dueDate < windowStart || row.dueDate > windowEnd) return []
    return [
      makeEvent(
        row,
        { date: row.dueDate, time: row.dueTime },
        `task-${row.id}@opentask`,
        ctx.timezone,
        publicUrl,
      ),
    ]
  }

  const out: FeedEvent[] = []
  let cur: { date: string; time: string | null } | null = { date: row.dueDate, time: row.dueTime }
  let iterations = 0
  while (cur !== null && cur.date <= windowEnd && iterations < MAX_EXPAND_ITERATIONS) {
    iterations += 1
    if (cur.date >= windowStart) {
      const uid = `task-${row.id}-${cur.date.replaceAll('-', '')}@opentask`
      out.push(makeEvent(row, cur, uid, ctx.timezone, publicUrl))
    }
    cur = nextOccurrence(row.recurrence, { after: cur, ctx })
  }
  return out
}

/**
 * Deterministic ICS text for the given live, due-dated tasks. `rows` MUST already be filtered to
 * live tasks with a due date (the route's SQL does this — completed/deleted rows never reach here,
 * and `IcalTaskRow` carries no completion flag by design). Window, expansion, sort and the 500-event
 * cap are applied here.
 */
export function buildTasksCalendar(
  rows: IcalTaskRow[],
  opts: { publicUrl: string | null; timezone: string; now: string },
): string {
  const today = dateInTz(opts.now, opts.timezone)
  const windowStart = addDaysIso(today, -ICAL_WINDOW.backDays)
  const windowEnd = addDaysIso(today, ICAL_WINDOW.forwardDays)
  const ctx: ParseContext = {
    ...DEFAULT_PARSE_CONTEXT_SETTINGS,
    now: opts.now,
    timezone: opts.timezone,
  }

  const events: FeedEvent[] = []
  for (const row of rows) {
    events.push(...eventsForRow(row, ctx, windowStart, windowEnd, opts.publicUrl))
  }
  // Chronological, tie-broken by UID for a stable order; the hard cap is applied AFTER sorting so
  // the surviving events are always the earliest.
  events.sort((a, b) => a.sortKey - b.sortKey || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0))
  const capped = events.slice(0, ICAL_WINDOW.maxEvents)

  const stamp = new Date(opts.now)
  const cal = ical({ name: 'OpenTask — Tasks', prodId: '//opentask//tasks//EN', ttl: 3600 })
  for (const ev of capped) {
    const data: ICalEventData = {
      id: ev.uid,
      start: ev.start,
      stamp,
      summary: ev.summary,
      url: ev.url,
    }
    if (ev.allDay) data.allDay = true
    else if (ev.end !== null) data.end = ev.end
    if (ev.description !== '') data.description = ev.description
    if (ev.categories.length > 0) data.categories = ev.categories.map((name) => ({ name }))
    cal.createEvent(data)
  }
  return cal.toString()
}

/** Strong ETag over the exact body bytes: `"sha256-<first 32 hex chars of sha256(body)>"`. */
export function feedEtag(body: string): string {
  const hex = createHash('sha256').update(body).digest('hex')
  return `"sha256-${hex.slice(0, 32)}"`
}
