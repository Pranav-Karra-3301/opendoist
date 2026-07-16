import { findDateSpans, resolveNaturalDate } from '../nl-date'
import { parseRecurrenceText, RECURRENCE_HEAD_WORDS } from '../recurrence'
import type { ParseContext, Priority, RecurrenceSpec, ReminderDraft } from '../types'

/** half-open [start, end) range in UTF-16 code units of the original input */
export interface Span {
  start: number
  end: number
}

interface BaseCandidate extends Span {
  text: string
}

export type SigilCandidate =
  | (BaseCandidate & { kind: 'project'; name: string })
  | (BaseCandidate & { kind: 'section'; name: string })
  | (BaseCandidate & { kind: 'label'; name: string })
  | (BaseCandidate & { kind: 'priority'; priority: Priority })
  | (BaseCandidate & { kind: 'deadline'; date: string })
  | (BaseCandidate & { kind: 'reminder'; draft: ReminderDraft })

export interface SigilScanResult {
  candidates: SigilCandidate[]
  /** `{…}` groups that are not valid deadlines: they stay plain text but are never date-scanned */
  deadZones: Span[]
}

/** keywords that can open a recurrence phrase — sourced from the recurrence grammar itself */
const TRIGGER_AT_START = new RegExp(`^(?:${RECURRENCE_HEAD_WORDS})(?![A-Za-z])`, 'i')
const TRIGGER_ANYWHERE = new RegExp(`(?<=^|\\s)(?:${RECURRENCE_HEAD_WORDS})(?![A-Za-z])`, 'gi')

const RELATIVE_REMINDER_RE =
  /^(?:(\d{1,3})\s*(?:hours?|hrs?|h)\b)?\s*(?:(\d{1,4})\s*(?:min(?:ute)?s?|m)\b)?\s*before\b/i

const PRIORITY_RE = /^[pP]([1-4])(?=\s|$)/

/** name after a sigil: quoted `"multi word"` or a run of non-whitespace characters */
function readName(text: string, from: number): { name: string; end: number } | null {
  if (text[from] === '"') {
    const close = text.indexOf('"', from + 1)
    if (close !== -1) {
      const name = text.slice(from + 1, close)
      return name.length > 0 ? { name, end: close + 1 } : null
    }
  }
  const m = /^\S+/.exec(text.slice(from))
  if (!m) return null
  return { name: m[0], end: from + m[0].length }
}

/** where the duration suffix (` for 45min`) starts inside a date-span text, if present */
export function splitDurationTail(
  spanText: string,
): { coreLength: number; forOffset: number } | null {
  let last: RegExpExecArray | null = null
  for (const m of spanText.matchAll(/\s+for\s+/gi)) last = m
  if (!last) return null
  return { coreLength: last.index, forOffset: last.index + last[0].toLowerCase().indexOf('for') }
}

function readReminder(
  text: string,
  sigil: number,
  ctx: ParseContext,
): (BaseCandidate & { kind: 'reminder'; draft: ReminderDraft }) | null {
  const sub = text.slice(sigil + 1)
  if (sub.length === 0 || /^\s/.test(sub)) return null

  // recurring reminder: `!every day 5pm`
  if (TRIGGER_AT_START.test(sub)) {
    const rec = parseRecurrenceText(sub, ctx)
    if (rec && rec.firstTime !== null) {
      const len = sub.slice(0, rec.consumed).trimEnd().length
      if (len > 0) {
        const end = sigil + 1 + len
        return {
          kind: 'reminder',
          start: sigil,
          end,
          text: text.slice(sigil, end),
          draft: {
            kind: 'recurring',
            due: {
              date: rec.firstDate,
              time: rec.firstTime,
              string: sub.slice(0, len),
              recurrence: rec.spec,
            },
          },
        }
      }
    }
  }

  // relative reminder: `!30 min before`, `!2 hours before`
  const rel = RELATIVE_REMINDER_RE.exec(sub)
  if (rel && (rel[1] !== undefined || rel[2] !== undefined)) {
    const minutes = Number(rel[1] ?? 0) * 60 + Number(rel[2] ?? 0)
    const end = sigil + 1 + rel[0].length
    return {
      kind: 'reminder',
      start: sigil,
      end,
      text: text.slice(sigil, end),
      draft: { kind: 'relative', minutesBefore: minutes },
    }
  }

  // absolute reminder: `!14:00`, `!tomorrow 9am` — must start right after `!` and carry a time
  const span = findDateSpans(sub, ctx)[0]
  if (span && span.start === 0 && span.time !== null) {
    const split = span.durationMin === null ? null : splitDurationTail(span.text)
    const coreLength = split ? split.coreLength : span.end
    const end = sigil + 1 + coreLength
    return {
      kind: 'reminder',
      start: sigil,
      end,
      text: text.slice(sigil, end),
      draft: { kind: 'absolute', date: span.date, time: span.time },
    }
  }

  return null
}

/** single left-to-right pass over the input, producing sigil-token candidates.
 *  every sigil requires a word boundary (start-of-string or whitespace) before it. */
export function scanSigils(text: string, ctx: ParseContext): SigilScanResult {
  const candidates: SigilCandidate[] = []
  const deadZones: Span[] = []
  let i = 0
  while (i < text.length) {
    if (i > 0 && !/\s/.test(text[i - 1] ?? '')) {
      i += 1
      continue
    }
    const ch = text[i]

    if (ch === '#' || ch === '/' || ch === '@') {
      const name = readName(text, i + 1)
      if (name) {
        const base = { start: i, end: name.end, text: text.slice(i, name.end) }
        if (ch === '#') candidates.push({ ...base, kind: 'project', name: name.name })
        else if (ch === '/') candidates.push({ ...base, kind: 'section', name: name.name })
        else candidates.push({ ...base, kind: 'label', name: name.name })
        i = name.end
        continue
      }
    } else if (ch === 'p' || ch === 'P') {
      const m = PRIORITY_RE.exec(text.slice(i))
      if (m) {
        candidates.push({
          kind: 'priority',
          start: i,
          end: i + 2,
          text: text.slice(i, i + 2),
          priority: Number(m[1]) as Priority,
        })
        i += 2
        continue
      }
    } else if (ch === '{') {
      const close = text.indexOf('}', i + 1)
      if (close !== -1) {
        const end = close + 1
        const resolved = resolveNaturalDate(text.slice(i + 1, close), ctx)
        if (resolved && resolved.time === null) {
          candidates.push({
            kind: 'deadline',
            start: i,
            end,
            text: text.slice(i, end),
            date: resolved.date,
          })
        } else {
          deadZones.push({ start: i, end })
        }
        i = end
        continue
      }
    } else if (ch === '!') {
      const reminder = readReminder(text, i, ctx)
      if (reminder) {
        candidates.push(reminder)
        i = reminder.end
        continue
      }
    }

    i += 1
  }
  return { candidates, deadZones }
}

export interface RecurrenceSpan extends Span {
  spec: RecurrenceSpec
  firstDate: string
  firstTime: string | null
}

/** earliest recurrence phrase in `text` (already masked of sigil tokens) */
export function findRecurrenceSpan(text: string, ctx: ParseContext): RecurrenceSpan | null {
  for (const m of text.matchAll(TRIGGER_ANYWHERE)) {
    const r = parseRecurrenceText(text.slice(m.index), ctx)
    if (!r) continue
    const len = text.slice(m.index, m.index + r.consumed).trimEnd().length
    if (len === 0) continue
    return {
      start: m.index,
      end: m.index + len,
      spec: r.spec,
      firstDate: r.firstDate,
      firstTime: r.firstTime,
    }
  }
  return null
}

/** tokens never overlap: on overlap the earlier-starting, longer span wins */
export function resolveOverlaps<T extends Span>(spans: T[]): T[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end)
  const out: T[] = []
  for (const span of sorted) {
    const last = out[out.length - 1]
    if (last && span.start < last.end) continue
    out.push(span)
  }
  return out
}
