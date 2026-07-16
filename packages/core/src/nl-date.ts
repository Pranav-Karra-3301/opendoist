import { TZDate } from '@date-fns/tz'
import * as chrono from 'chrono-node'
import { addDaysIso, dateInTz, lastDayOfMonth, nextWeekdayOnOrAfter, timeInTz } from './dates'
import type { ParseContext } from './types'

export interface ResolvedDate {
  date: string
  time: string | null
}
export interface DateSpan extends ResolvedDate {
  start: number
  end: number
  text: string
  durationMin: number | null
}

const pad = (n: number) => String(n).padStart(2, '0')

const MONTH_BY_PREFIX: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

const MONTH_NAME =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
const DAY_NAME =
  'mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?'
// full month names included so '27th january' / '3rd of july' stay whole for chrono
const DAY_OR_MONTH_NAME = `${MONTH_NAME}|${DAY_NAME}`

const DAYPART_TIME: Record<string, string> = {
  morning: '09:00',
  afternoon: '12:00',
  evening: '19:00',
}

/** internal candidate span before merging */
interface Candidate {
  start: number
  end: number
  date: string
  time: string | null
  dateCertain: boolean
  timeCertain: boolean
}

interface LocalCtx {
  today: string
  nowTime: string
  ctx: ParseContext
}

function localCtx(ctx: ParseContext): LocalCtx {
  return { today: dateInTz(ctx.now, ctx.timezone), nowTime: timeInTz(ctx.now, ctx.timezone), ctx }
}

/** chrono reference: wall-clock of `ctx.now` in `ctx.timezone` re-expressed as a UTC instant,
 *  so all chrono arithmetic happens in the user's wall-clock space. */
function chronoReference(ctx: ParseContext): { instant: Date; timezone: number } {
  const d = new TZDate(ctx.now, ctx.timezone)
  return {
    instant: new Date(
      Date.UTC(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        d.getHours(),
        d.getMinutes(),
        d.getSeconds(),
      ),
    ),
    timezone: 0,
  }
}

/** first date >= today whose day-of-month is `day` (skips months too short) */
function nextDayOfMonth(today: string, day: number): string {
  const [y0, m0] = today.split('-').map(Number)
  const startYear = y0 ?? 2000
  const startMonth = m0 ?? 1
  for (let i = 0; i < 24; i++) {
    const total = startMonth - 1 + i
    const y = startYear + Math.floor(total / 12)
    const m = (total % 12) + 1
    if (day > lastDayOfMonth(y, m)) continue
    const cand = `${y}-${pad(m)}-${pad(day)}`
    if (cand >= today) return cand
  }
  return today
}

/** month/day this year if >= today, else next year */
function forwardMonthDay(today: string, month: number, day: number): string {
  const year = Number(today.slice(0, 4))
  const cand = `${year}-${pad(month)}-${pad(day)}`
  return cand >= today ? cand : `${year + 1}-${pad(month)}-${pad(day)}`
}

/** date + n months (n may be negative), day-of-month clamped to the target month's length */
function shiftMonths(date: string, n: number): string {
  const [y, mo, day] = date.split('-').map(Number)
  const total = (mo ?? 1) - 1 + n
  const ty = (y ?? 2000) + Math.floor(total / 12)
  const tm = (((total % 12) + 12) % 12) + 1
  const td = Math.min(day ?? 1, lastDayOfMonth(ty, tm))
  return `${ty}-${pad(tm)}-${pad(td)}`
}

/** date for a standalone time: today, or tomorrow when the time has already passed */
function dateForBareTime(lc: LocalCtx, time: string): string {
  return time > lc.nowTime ? lc.today : addDaysIso(lc.today, 1)
}

type MatcherResolve = (m: RegExpExecArray, lc: LocalCtx) => Omit<Candidate, 'start' | 'end'> | null

interface CustomMatcher {
  pattern: RegExp
  resolve: MatcherResolve
  /** span to report, as [start, end] offsets relative to the match (default: whole match) */
  narrow?: (m: RegExpExecArray) => [number, number]
}

const dateOnly = (date: string): Omit<Candidate, 'start' | 'end'> => ({
  date,
  time: null,
  dateCertain: true,
  timeCertain: false,
})

const CUSTOM_MATCHERS: CustomMatcher[] = [
  {
    // two days out, capped at the current week's Sunday
    pattern: /\blater\s+this\s+week\b/gi,
    resolve: (_m, lc) => {
      const sunday = nextWeekdayOnOrAfter(lc.today, 7, true)
      const cand = addDaysIso(lc.today, 2)
      return dateOnly(cand <= sunday ? cand : sunday)
    },
  },
  {
    pattern: /\bnext\s+week\b/gi,
    resolve: (_m, lc) =>
      dateOnly(nextWeekdayOnOrAfter(addDaysIso(lc.today, 1), lc.ctx.nextWeekDay, true)),
  },
  {
    pattern: /\b(?:this\s+)?weekend\b/gi,
    resolve: (_m, lc) => dateOnly(nextWeekdayOnOrAfter(lc.today, lc.ctx.weekendDay, true)),
  },
  {
    pattern: /\bend\s+of\s+(?:the\s+)?month\b/gi,
    resolve: (_m, lc) => {
      const y = Number(lc.today.slice(0, 4))
      const m = Number(lc.today.slice(5, 7))
      return dateOnly(`${y}-${pad(m)}-${pad(lastDayOfMonth(y, m))}`)
    },
  },
  {
    pattern: new RegExp(`\\bmid[\\s-]+(${MONTH_NAME})\\b`, 'gi'),
    resolve: (m, lc) => {
      const month = MONTH_BY_PREFIX[(m[1] ?? '').slice(0, 3).toLowerCase()]
      return month ? dateOnly(forwardMonthDay(lc.today, month, 15)) : null
    },
  },
  {
    pattern: /\bnew\s+year(?:'?s)?\s+day\b/gi,
    resolve: (_m, lc) => dateOnly(forwardMonthDay(lc.today, 1, 1)),
  },
  {
    pattern: /\bnew\s+year(?:'?s)?\s+eve\b/gi,
    resolve: (_m, lc) => dateOnly(forwardMonthDay(lc.today, 12, 31)),
  },
  {
    pattern: /\bvalentine(?:'?s)?(?:\s+day)?\b/gi,
    resolve: (_m, lc) => dateOnly(forwardMonthDay(lc.today, 2, 14)),
  },
  {
    pattern: /\bhalloween\b/gi,
    resolve: (_m, lc) => dateOnly(forwardMonthDay(lc.today, 10, 31)),
  },
  {
    pattern: /\b(tod|tom)\b/gi,
    resolve: (m, lc) =>
      dateOnly((m[1] ?? '').toLowerCase() === 'tod' ? lc.today : addDaysIso(lc.today, 1)),
  },
  {
    // +5 days / +3 weeks / +2 months / +1 year (date-only relative)
    pattern: /(?<!\S)\+(\d{1,3})\s*(days?|d|weeks?|w|months?|mo|years?|y)\b/gi,
    resolve: (m, lc) => {
      const n = Number(m[1])
      const unit = (m[2] ?? '').toLowerCase()
      if (unit.startsWith('d')) return dateOnly(addDaysIso(lc.today, n))
      if (unit.startsWith('w')) return dateOnly(addDaysIso(lc.today, n * 7))
      return dateOnly(shiftMonths(lc.today, unit.startsWith('y') ? 12 * n : n))
    },
  },
  {
    // Todoist dayparts (chrono's defaults differ): morning 9:00, afternoon 12:00, evening 19:00
    pattern: /\b(?:in\s+the\s+)?(morning|afternoon|evening)\b/gi,
    resolve: (m, lc) => {
      const time = DAYPART_TIME[(m[1] ?? '').toLowerCase()]
      if (!time) return null
      return { date: dateForBareTime(lc, time), time, dateCertain: false, timeCertain: true }
    },
  },
  {
    // military time after at/@ — 'fri at 1900' (span covers the digits only)
    pattern: /(?:\bat|@)\s*([01]?\d|2[0-3])([0-5]\d)\b/gi,
    resolve: (m, lc) => {
      const time = `${pad(Number(m[1]))}:${m[2]}`
      return { date: dateForBareTime(lc, time), time, dateCertain: false, timeCertain: true }
    },
    narrow: (m) => {
      const len = (m[1]?.length ?? 0) + (m[2]?.length ?? 0)
      return [m[0].length - len, m[0].length]
    },
  },
  {
    // bare ordinal day-of-month: '27th' — but not 'august 27th' / '3rd friday' / '3rd of july'
    pattern: new RegExp(
      `(?<!(?:${MONTH_NAME})\\s{1,3})\\b(\\d{1,2})(?:st|nd|rd|th)\\b(?!\\s+(?:of\\s+)?(?:${DAY_OR_MONTH_NAME})\\b)`,
      'gi',
    ),
    resolve: (m, lc) => {
      const day = Number(m[1])
      if (day < 1 || day > 31) return null
      return dateOnly(nextDayOfMonth(lc.today, day))
    },
  },
]

const chronoParser = chrono.casual.clone()

function chronoCandidates(masked: string, ctx: ParseContext): Candidate[] {
  const out: Candidate[] = []
  for (const r of chronoParser.parse(masked, chronoReference(ctx), { forwardDate: true })) {
    const s = r.start
    const dateCertain = s.isCertain('day') || s.isCertain('weekday') || s.isCertain('month')
    const timeCertain = s.isCertain('hour')
    if (!dateCertain && !timeCertain) continue
    const date = `${s.get('year') ?? 2000}-${pad(s.get('month') ?? 1)}-${pad(s.get('day') ?? 1)}`
    const time = timeCertain ? `${pad(s.get('hour') ?? 0)}:${pad(s.get('minute') ?? 0)}` : null
    out.push({ start: r.index, end: r.index + r.text.length, date, time, dateCertain, timeCertain })
  }
  return out
}

function maskRange(text: string, start: number, end: number): string {
  return text.slice(0, start) + ' '.repeat(end - start) + text.slice(end)
}

/** whitespace, optionally containing a lone at/@ connector */
const GAP_RE = /^\s*(?:(?:at|@)\s*)?$/i

function mergeAdjacent(text: string, cands: Candidate[]): Candidate[] {
  const sorted = [...cands].sort((a, b) => a.start - b.start || b.end - a.end)
  const merged: Candidate[] = []
  for (const c of sorted) {
    const prev = merged[merged.length - 1]
    if (
      prev?.dateCertain &&
      !prev.timeCertain &&
      c.timeCertain &&
      !c.dateCertain &&
      c.start > prev.end &&
      c.start - prev.end <= 8 &&
      GAP_RE.test(text.slice(prev.end, c.start))
    ) {
      prev.end = c.end
      prev.time = c.time
      prev.timeCertain = true
      continue
    }
    if (prev && c.start < prev.end) continue // overlap: earlier-starting span wins
    merged.push({ ...c })
  }
  return merged
}

const DURATION_RE =
  /^(\s+for\s+)(?:(\d{1,4})\s*(?:hours?|hrs?|h)\b)?\s*(?:(\d{1,4})\s*(?:minutes?|mins?|min|m)\b)?/i

/** parse a trailing ' for <duration>' right after `from`; null when absent.
 *  `forStart` = offset of the 'for' keyword (start of the duration token). */
export function durationAfter(
  text: string,
  from: number,
): { minutes: number; end: number; forStart: number } | null {
  const m = DURATION_RE.exec(text.slice(from))
  if (!m || (m[2] === undefined && m[3] === undefined)) return null
  const minutes = Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
  if (minutes < 1) return null
  return {
    minutes: Math.min(minutes, 1440),
    end: from + m[0].length,
    forStart: from + (m[1] ?? '').toLowerCase().indexOf('for'),
  }
}

/** 'N <units> before ' immediately preceding an anchor date (dossier §1.2 Compound);
 *  chrono handles this for its own anchors ('6 weeks before 21 Jul') — this covers ours */
const COMPOUND_BEFORE_RE = /(?<!\S)(\d{1,3})\s*(days?|d|weeks?|w|months?|mo|years?|y)\s+before\s+$/i

function shiftBackward(date: string, n: number, unitWord: string): string {
  const unit = unitWord.toLowerCase()
  if (unit.startsWith('d')) return addDaysIso(date, -n)
  if (unit.startsWith('w')) return addDaysIso(date, -7 * n)
  return shiftMonths(date, unit.startsWith('y') ? -12 * n : -n)
}

function collectCandidates(text: string, ctx: ParseContext): Candidate[] {
  const lc = localCtx(ctx)
  let masked = text
  const custom: Candidate[] = []
  for (const matcher of CUSTOM_MATCHERS) {
    for (const m of masked.matchAll(matcher.pattern)) {
      const resolved = matcher.resolve(m as RegExpExecArray, lc)
      if (!resolved) continue
      const [relStart, relEnd] = matcher.narrow?.(m as RegExpExecArray) ?? [0, m[0].length]
      const cand: Candidate = { start: m.index + relStart, end: m.index + relEnd, ...resolved }
      let maskStart = m.index
      if (resolved.dateCertain) {
        // compound: '50 days before new year's eve' → anchor date minus the offset
        const before = COMPOUND_BEFORE_RE.exec(masked.slice(0, cand.start))
        if (before) {
          cand.date = shiftBackward(resolved.date, Number(before[1]), before[2] ?? 'd')
          cand.start = before.index
          maskStart = Math.min(maskStart, before.index)
        }
      }
      custom.push(cand)
      masked = maskRange(masked, maskStart, m.index + m[0].length)
    }
  }
  return mergeAdjacent(text, [...custom, ...chronoCandidates(masked, ctx)])
}

function toSpans(text: string, cands: Candidate[]): DateSpan[] {
  const spans: DateSpan[] = []
  let consumedTo = -1
  for (const c of cands) {
    if (c.start < consumedTo) continue // swallowed by a previous span's duration suffix
    let end = c.end
    let durationMin: number | null = null
    if (c.time !== null) {
      const dur = durationAfter(text, c.end)
      if (dur) {
        durationMin = dur.minutes
        end = dur.end
      }
    }
    consumedTo = end
    spans.push({
      date: c.date,
      time: c.time,
      start: c.start,
      end,
      text: text.slice(c.start, end),
      durationMin,
    })
  }
  return spans
}

/** Find date phrases inside free text with their spans; used by the Quick Add parser.
 *  Also captures a trailing 'for <duration>' immediately after a timed phrase. */
export function findDateSpans(text: string, ctx: ParseContext): DateSpan[] {
  return toSpans(text, collectCandidates(text, ctx))
}

/** Resolve a whole string as a date phrase ('today', 'mid january', 'next friday 4pm', '27th').
 *  Returns null when the string is not a date phrase. */
export function resolveNaturalDate(text: string, ctx: ParseContext): ResolvedDate | null {
  const firstNonSpace = text.search(/\S/)
  if (firstNonSpace === -1) return null
  const lastNonSpace = text.length - (text.match(/\s*$/)?.[0].length ?? 0)

  // bare day-of-month number ('27') is only honored when it is the whole string
  const bare = /^\s*(\d{1,2})\s*$/.exec(text)
  if (bare) {
    const day = Number(bare[1])
    if (day >= 1 && day <= 31) {
      return { date: nextDayOfMonth(dateInTz(ctx.now, ctx.timezone), day), time: null }
    }
    return null
  }

  const spans = findDateSpans(text, ctx)
  const only = spans[0]
  if (spans.length === 1 && only && only.start <= firstNonSpace && only.end >= lastNonSpace) {
    return { date: only.date, time: only.time }
  }
  return null
}
