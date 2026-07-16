import { dateInTz, isoWeekday, lastDayOfMonth, timeInTz } from '../dates'
import type { ParseContext, RecurrenceSpec } from '../types'

export interface Occurrence {
  date: string
  time: string | null
}

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

const DAY_MS = 86_400_000

/** UTC-pure day arithmetic — immune to the host machine's local DST transitions
 *  (date-fns addDays works in machine-local time, which stalls across spring-forward) */
export function addDaysUtc(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** days from `a` to `b` (b - a), UTC-pure */
export function diffDaysUtc(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS)
}

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const toHm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`

function ymd(date: string): [number, number, number] {
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))]
}

function sortedTimes(spec: RecurrenceSpec): string[] {
  return [...new Set(spec.times)].sort()
}

function expandWeekdays(list: RecurrenceSpec['weekdays']): ReadonlySet<number> {
  const out = new Set<number>()
  for (const w of list) {
    if (w === 'workday') for (let d = 1; d <= 5; d++) out.add(d)
    else out.add(w)
  }
  return out
}

/** start of the week containing `date`, weeks beginning on `weekStart` (ISO 1..7) */
function weekStartOf(date: string, weekStart: number): string {
  return addDaysUtc(date, -((isoWeekday(date) - weekStart + 7) % 7))
}

/** date + n months, day-of-month clamped to the target month's length */
export function addMonthsClamped(date: string, n: number): string {
  const [y, m, d] = ymd(date)
  const total = y * 12 + (m - 1) + n
  const ty = Math.floor(total / 12)
  const tm = (total % 12) + 1
  return iso(ty, tm, Math.min(d, lastDayOfMonth(ty, tm)))
}

type OrdinalEntry = RecurrenceSpec['ordinals'][number]

/** all positional entries: the single `ordinal` (unanchored) plus the `ordinals` list */
function positionalEntries(spec: RecurrenceSpec): OrdinalEntry[] {
  return [...(spec.ordinal === null ? [] : [{ ...spec.ordinal, month: null }]), ...spec.ordinals]
}

/** nth <unit> of the given month, or null when it does not exist (e.g. a 5th friday) */
function resolveOrdinalInMonth(
  y: number,
  m: number,
  ord: NonNullable<RecurrenceSpec['ordinal']>,
): string | null {
  const last = lastDayOfMonth(y, m)
  if (ord.unit === 'day') {
    if (ord.nth === 'last') return iso(y, m, last)
    return ord.nth <= last ? iso(y, m, ord.nth) : null
  }
  const matches: number[] = []
  for (let d = 1; d <= last; d++) {
    const wd = isoWeekday(iso(y, m, d))
    if (ord.unit === 'workday' ? wd <= 5 : wd === ord.weekday) matches.push(d)
  }
  const day = ord.nth === 'last' ? matches[matches.length - 1] : matches[ord.nth - 1]
  return day === undefined ? null : iso(y, m, day)
}

/** true when the spec repeats on a calendar pattern rather than a plain interval from `after` */
function isPattern(spec: RecurrenceSpec): boolean {
  return (
    spec.weekdays.length > 0 ||
    spec.monthDays.length > 0 ||
    spec.ordinal !== null ||
    spec.ordinals.length > 0 ||
    spec.dates.length > 0
  )
}

interface PatternOpts {
  /** previous occurrence establishing interval alignment; null = unaligned (first occurrence) */
  alignTo: string | null
  weekStart: number
}

/** next calendar-pattern match strictly after `afterDate`, or null when the scan cap is hit */
function nextPatternMatch(
  spec: RecurrenceSpec,
  afterDate: string,
  opts: PatternOpts,
): string | null {
  const interval = Math.max(1, spec.interval)
  switch (spec.freq) {
    case 'daily': {
      // counted mode ('every 3 workday'): the interval-th day matching `weekdays` after `afterDate`
      const set = expandWeekdays(spec.weekdays)
      let seen = 0
      let d = afterDate
      const cap = 7 * interval + 14
      for (let i = 0; i < cap; i++) {
        d = addDaysUtc(d, 1)
        if (set.has(isoWeekday(d))) {
          seen++
          if (seen === interval) return d
        }
      }
      return null
    }
    case 'weekly': {
      const set = expandWeekdays(spec.weekdays)
      const anchorWeek = opts.alignTo === null ? null : weekStartOf(opts.alignTo, opts.weekStart)
      let d = afterDate
      const cap = 7 * (interval + 2)
      for (let i = 0; i < cap; i++) {
        d = addDaysUtc(d, 1)
        if (!set.has(isoWeekday(d))) continue
        if (anchorWeek === null || interval === 1) return d
        const weeks = Math.round(diffDaysUtc(anchorWeek, weekStartOf(d, opts.weekStart)) / 7)
        if (weeks % interval === 0) return d
      }
      return null
    }
    case 'monthly': {
      const [ay, am] = ymd(afterDate)
      const anchor = opts.alignTo === null ? null : ymd(opts.alignTo)
      const anchorIndex = anchor === null ? null : anchor[0] * 12 + anchor[1] - 1
      const capMonths = 12 * interval + 24
      for (let k = 0; k < capMonths; k++) {
        const total = ay * 12 + (am - 1) + k
        const y = Math.floor(total / 12)
        const m = (total % 12) + 1
        if (anchorIndex !== null && interval > 1 && (total - anchorIndex) % interval !== 0) continue
        const candidates: string[] = []
        const ords = positionalEntries(spec).filter((e) => e.month === null)
        if (ords.length > 0) {
          for (const e of ords) {
            const r = resolveOrdinalInMonth(y, m, e)
            if (r !== null) candidates.push(r)
          }
        } else {
          const lastDay = lastDayOfMonth(y, m)
          for (const md of spec.monthDays) {
            const day = md === 'last' ? lastDay : md
            if (day <= lastDay) candidates.push(iso(y, m, day))
          }
        }
        candidates.sort()
        for (const c of candidates) if (c > afterDate) return c
      }
      return null
    }
    case 'yearly': {
      const [ay] = ymd(afterDate)
      const anchorYear = opts.alignTo === null ? null : ymd(opts.alignTo)[0]
      const capYears = 8 * interval + 8
      for (let k = 0; k < capYears; k++) {
        const y = ay + k
        if (anchorYear !== null && interval > 1 && (y - anchorYear) % interval !== 0) continue
        const candidates = spec.dates
          .filter((e) => e.day <= lastDayOfMonth(y, e.month))
          .map((e) => iso(y, e.month, e.day))
        for (const e of positionalEntries(spec)) {
          if (e.month === null) continue
          const r = resolveOrdinalInMonth(y, e.month, e)
          if (r !== null) candidates.push(r)
        }
        candidates.sort()
        for (const c of candidates) if (c > afterDate) return c
      }
      return null
    }
    case 'hourly':
      return null
  }
}

/** plain-interval advance anchored at `date` (no calendar pattern) */
function advanceAnchored(spec: RecurrenceSpec, date: string): string {
  switch (spec.freq) {
    case 'daily':
      return addDaysUtc(date, spec.interval)
    case 'weekly':
      return addDaysUtc(date, 7 * spec.interval)
    case 'monthly':
      return addMonthsClamped(date, spec.interval)
    case 'yearly':
      return addMonthsClamped(date, 12 * spec.interval)
    case 'hourly':
      return date // hourly is handled separately (needs a time)
  }
}

/** wall-clock hour stepping; DST-neutral by design (occurrence times are wall-clock strings) */
function stepHours(date: string, time: string, hours: number): Occurrence {
  const total = toMinutes(time) + hours * 60
  return {
    date: addDaysUtc(date, Math.floor(total / 1440)),
    time: toHm(((total % 1440) + 1440) % 1440),
  }
}

/**
 * Next occurrence strictly after `after` (a calendar date, optionally with time for hourly freq).
 * The caller chooses the anchor: pass the previous due date for `anchor: 'schedule'` specs and the
 * completion date for `anchor: 'completion'` (every!) specs — the advancement math is identical.
 */
export function nextOccurrence(
  spec: RecurrenceSpec,
  opts: { after: { date: string; time: string | null }; ctx: ParseContext },
): { date: string; time: string | null } | null {
  const { after, ctx } = opts
  const times = sortedTimes(spec)
  const occTime = times[0] ?? null
  let result: Occurrence | null

  if (spec.freq === 'hourly') {
    const base = after.time ?? occTime ?? '00:00'
    result = stepHours(after.date, base, spec.interval)
  } else if (isPattern(spec)) {
    const date = nextPatternMatch(spec, after.date, {
      alignTo: after.date,
      weekStart: ctx.weekStart,
    })
    result = date === null ? null : { date, time: occTime }
  } else {
    result = { date: advanceAnchored(spec, after.date), time: occTime }
  }

  // `starting` bound: occurrences before it don't exist; jump to the first one at/after it
  if (result !== null && spec.starting !== null && result.date < spec.starting) {
    if (spec.freq === 'hourly') {
      result = { date: spec.starting, time: occTime ?? '00:00' }
    } else if (isPattern(spec)) {
      const date = nextPatternMatch(spec, addDaysUtc(spec.starting, -1), {
        alignTo: null,
        weekStart: ctx.weekStart,
      })
      result = date === null ? null : { date, time: occTime }
    } else {
      result = { date: spec.starting, time: occTime }
    }
  }

  // `until` is inclusive: anything past it ends the series
  if (result !== null && spec.until !== null && result.date > spec.until) return null
  return result
}

/**
 * First occurrence for a freshly parsed spec: strictly after "now" for date-only specs,
 * today is allowed when the spec has a time that has not passed yet in ctx.timezone,
 * and a future `starting` bound makes the first occurrence land at/after it.
 */
export function firstOccurrence(spec: RecurrenceSpec, ctx: ParseContext): Occurrence | null {
  const today = dateInTz(ctx.now, ctx.timezone)
  const nowTime = timeInTz(ctx.now, ctx.timezone)
  const times = sortedTimes(spec)
  const minTime = times[0] ?? null
  const allowToday = minTime !== null && minTime > nowTime
  const futureStart = spec.starting !== null && spec.starting > today ? spec.starting : null

  if (spec.freq === 'hourly') {
    if (futureStart !== null) return { date: futureStart, time: minTime ?? '00:00' }
    if (minTime !== null) {
      let occ: Occurrence = { date: today, time: minTime }
      let guard = 0
      while (occ.date === today && (occ.time ?? '00:00') <= nowTime && guard++ < 48) {
        occ = stepHours(occ.date, occ.time ?? '00:00', spec.interval)
      }
      return occ
    }
    return stepHours(today, nowTime, spec.interval)
  }

  if (isPattern(spec)) {
    const lower =
      futureStart !== null
        ? addDaysUtc(futureStart, -1)
        : allowToday
          ? addDaysUtc(today, -1)
          : today
    const date = nextPatternMatch(spec, lower, { alignTo: null, weekStart: ctx.weekStart })
    return date === null ? null : { date, time: minTime }
  }

  if (spec.starting !== null) {
    let d = spec.starting
    if (d < today && (spec.freq === 'daily' || spec.freq === 'weekly')) {
      // linear frequencies catch up arithmetically — iterating from a years-old `starting`
      // (re-parsed Due.strings age) would exhaust any step cap and return a stale past date
      const step = (spec.freq === 'daily' ? 1 : 7) * Math.max(1, spec.interval)
      d = addDaysUtc(d, Math.ceil(diffDaysUtc(d, today) / step) * step)
    }
    // monthly/yearly clamp the day-of-month per step, so they must iterate; the widest
    // representable span (year 0000 → 9999, interval 1 month) needs ~120k steps
    let guard = 0
    while ((d < today || (d === today && !allowToday)) && guard++ < 130000) {
      d = advanceAnchored(spec, d)
    }
    return { date: d, time: minTime }
  }

  if (allowToday) return { date: today, time: minTime }
  return { date: advanceAnchored(spec, today), time: minTime }
}
