import { findDateSpans } from '../nl-date'
import type { ParseContext, RecurrenceSpec } from '../types'

export interface ParsedPhrase {
  spec: RecurrenceSpec
  /** end offset of the phrase in the given text (leading whitespace included) */
  consumed: number
  /** trailing 'for N <unit>' bound; converted to an inclusive `until` once firstDate is known */
  forBound: { n: number; unit: 'day' | 'week' | 'month' | 'year' } | null
}

const pad = (n: number) => String(n).padStart(2, '0')

const WEEKDAY_RE_SRC =
  'mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday|s)?|thu(?:rs?(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?'
const MONTH_RE_SRC =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'

const WEEKDAY_BY_PREFIX: Record<string, number> = {
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  sun: 7,
}
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
const ORDINAL_WORDS: Record<string, number | 'last'> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  last: 'last',
}

const weekdayFor = (word: string): number | null =>
  WEEKDAY_BY_PREFIX[word.slice(0, 3).toLowerCase()] ?? null
const monthFor = (word: string): number | null =>
  MONTH_BY_PREFIX[word.slice(0, 3).toLowerCase()] ?? null

/** alternation of keywords that can open a recurrence phrase; the Quick Add trigger scan
 *  reuses it so the two lists cannot drift ('annually'/'hourly' were once missing there) */
export const RECURRENCE_HEAD_WORDS =
  'after|everyday|every!|every|ev|daily|weekly|monthly|quarterly|yearly|annually|hourly'
const HEAD_RE = new RegExp(`^\\s*(${RECURRENCE_HEAD_WORDS})(?![\\w!])`, 'i')
const AFTER_BODY_RE = /^\s+(\d{1,3})\s*(hours?|days?|weeks?|months?|years?)(?!\w)/i
const COUNT_UNIT_RE =
  /^\s+(\d{1,3})\s+(hours?|days?|weeks?|months?|years?|quarters?|workdays?|weekdays?)(?!\w)/i
const UNIT_RE = /^\s+(hours?|days?|weeks?|months?|years?|quarters?|workdays?|weekdays?)(?!\w)/i
const OTHER_RE = /^\s+other(?!\w)/i
const ORDINAL_ITEM_RE = new RegExp(
  `^(?:(\\d{1,2})(?:st|nd|rd|th)|(first|second|third|fourth|fifth|last))\\s+(workdays?|days?|${WEEKDAY_RE_SRC})(?!\\w)`,
  'i',
)
const ORDINAL_MONTH_RE = new RegExp(`^\\s+(?:of\\s+)?(${MONTH_RE_SRC})(?!\\w)`, 'i')
const DAY_MONTH_RE = new RegExp(
  `^(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE_SRC})(?!\\w)`,
  'i',
)
const MONTH_DAY_RE = new RegExp(`^(${MONTH_RE_SRC})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\w:])`, 'i')
const WEEKDAY_ITEM_RE = new RegExp(`^(${WEEKDAY_RE_SRC})(?!\\w)`, 'i')
const WORKDAY_ITEM_RE = /^(?:workdays?|weekdays?)(?!\w)/i
const BARE_DAY_RE = /^(\d{1,2})(?:st|nd|rd|th)?(?![\w:])(?!\s*[ap]m\b)/i
const HOLIDAY_ITEMS: [RegExp, { month: number; day: number }][] = [
  [/^new\s+year(?:'?s)?\s+day(?!\w)/i, { month: 1, day: 1 }],
  [/^new\s+year(?:'?s)?\s+eve(?!\w)/i, { month: 12, day: 31 }],
  [/^valentine(?:'?s)?(?:\s+day)?(?!\w)/i, { month: 2, day: 14 }],
  [/^halloween(?!\w)/i, { month: 10, day: 31 }],
]
const LIST_SEP_RE = /^(?:\s*,\s*|\s+and\s+)/i
const AT_RE = /^\s+(?:at|@)\s*/i
const WS_RE = /^\s+/
const STARTING_RE = /^\s+(?:starting|from)(?!\w)/i
const UNTIL_RE = /^\s+(?:until|ending)(?!\w)/i
const FOR_RE = /^\s+for\s+(\d{1,3})\s*(days?|weeks?|months?|years?)(?!\w)/i
const BOUND_CUT_RE = /\b(?:starting|from|until|ending|for)\b/i
const TIME_LIST_SEP_RE = /^(?:\s*,\s*|\s+and\s+)(?:at\s+|@\s*)?/i
const PER_DAY_TIME_GUARD_RE = new RegExp(`^\\s*(?:,|and\\s)\\s*(?:${WEEKDAY_RE_SRC})(?!\\w)`, 'i')

class Scanner {
  pos = 0
  constructor(readonly text: string) {}
  /** try an ^-anchored regex at the current position; advances on match */
  match(re: RegExp): RegExpExecArray | null {
    const m = re.exec(this.text.slice(this.pos))
    if (m === null) return null
    this.pos += m[0].length
    return m
  }
  peek(re: RegExp): boolean {
    return re.test(this.text.slice(this.pos))
  }
  rest(): string {
    return this.text.slice(this.pos)
  }
}

/** read one wall-clock time token; `afterAt` additionally allows military '1900' and bare hours */
function readTime(s: Scanner, afterAt: boolean): string | null {
  const save = s.pos
  let m = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?(?![\w:])/i)
  if (m !== null) {
    const h = Number(m[1])
    const min = Number(m[2])
    const ap = m[3]?.toLowerCase()
    if (ap !== undefined && h >= 1 && h <= 12 && min <= 59) {
      return `${pad((h % 12) + (ap === 'pm' ? 12 : 0))}:${pad(min)}`
    }
    if (ap === undefined && h <= 23 && min <= 59) return `${pad(h)}:${pad(min)}`
    s.pos = save
    return null
  }
  m = s.match(/^(\d{1,2})\s*(am|pm)(?!\w)/i)
  if (m !== null) {
    const h = Number(m[1])
    const ap = (m[2] ?? '').toLowerCase()
    if (h >= 1 && h <= 12) return `${pad((h % 12) + (ap === 'pm' ? 12 : 0))}:00`
    s.pos = save
    return null
  }
  if (afterAt) {
    m = s.match(/^([01]\d|2[0-3])([0-5]\d)(?!\w)/)
    if (m !== null) return `${m[1]}:${m[2]}`
    m = s.match(/^(\d{1,2})(?![\w:])/)
    if (m !== null) {
      const h = Number(m[1])
      if (h <= 23) return `${pad(h)}:00`
      s.pos = save
      return null
    }
  }
  return null
}

/** resolve a natural-language date phrase right after a bound keyword; cuts at the next keyword */
function readDateBound(
  s: Scanner,
  ctx: ParseContext,
): { date: string; time: string | null } | null {
  const save = s.pos
  if (s.match(WS_RE) === null) return null
  const rest = s.rest()
  const cut = BOUND_CUT_RE.exec(rest)
  const slice = cut === null ? rest : rest.slice(0, cut.index)
  const first = findDateSpans(slice, ctx)[0]
  if (first === undefined || first.start > 0) {
    s.pos = save
    return null
  }
  let end = first.end
  while (end > 0 && /\s/.test(slice[end - 1] ?? '')) end--
  s.pos += end
  return { date: first.date, time: first.time }
}

type Freq = RecurrenceSpec['freq']
type Family = 'weekday' | 'monthday' | 'yeardate'
type OrdinalEntry = RecurrenceSpec['ordinals'][number]

/** one positional item at the scanner position: '3rd friday' | 'first workday' | 'last day',
 *  optionally month-anchored ('1st wed jan' / '1st wed of january') */
function readOrdinalItem(s: Scanner): OrdinalEntry | null {
  const save = s.pos
  const m = s.match(ORDINAL_ITEM_RE)
  if (m === null) return null
  const nth: number | 'last' =
    m[1] !== undefined ? Number(m[1]) : (ORDINAL_WORDS[(m[2] ?? '').toLowerCase()] ?? 1)
  if (typeof nth === 'number' && (nth < 1 || nth > 31)) {
    s.pos = save
    return null
  }
  const unitText = (m[3] ?? '').toLowerCase()
  let unit: OrdinalEntry['unit']
  let weekday: number | null = null
  if (unitText.startsWith('workday')) {
    unit = 'workday'
  } else if (unitText.startsWith('day')) {
    unit = 'day'
  } else {
    const wd = weekdayFor(unitText)
    if (wd === null) {
      s.pos = save
      return null
    }
    unit = 'weekday'
    weekday = wd
  }
  const mm = s.match(ORDINAL_MONTH_RE)
  const month = mm === null ? null : monthFor(mm[1] ?? '')
  return { nth, unit, weekday, month }
}

export function parsePhrase(text: string, ctx: ParseContext): ParsedPhrase | null {
  const s = new Scanner(text)
  const head = s.match(HEAD_RE)
  if (head === null) return null
  const headWord = (head[1] ?? '').toLowerCase()

  let anchor: RecurrenceSpec['anchor'] = headWord === 'every!' ? 'completion' : 'schedule'
  let freq: Freq | null = null
  let interval = 1
  const weekdays: (number | 'workday')[] = []
  const monthDays: (number | 'last')[] = []
  let ordinal: RecurrenceSpec['ordinal'] = null
  let ordinals: RecurrenceSpec['ordinals'] = []
  const dates: { month: number; day: number }[] = []
  const times: string[] = []
  let starting: string | null = null
  let until: string | null = null
  let forBound: ParsedPhrase['forBound'] = null
  let good = s.pos
  let invalid = false

  /** set freq/interval from a unit word; returns false on a nonsense count */
  const applyUnit = (unitWord: string, n: number): boolean => {
    if (n < 1 || n > 999) return false
    const unit = unitWord.toLowerCase()
    if (unit.startsWith('hour')) {
      freq = 'hourly'
      interval = n
    } else if (unit.startsWith('day')) {
      freq = 'daily'
      interval = n
    } else if (unit.startsWith('week') && !unit.startsWith('weekday')) {
      freq = 'weekly'
      interval = n
    } else if (unit.startsWith('month')) {
      freq = 'monthly'
      interval = n
    } else if (unit.startsWith('year')) {
      freq = 'yearly'
      interval = n
    } else if (unit.startsWith('quarter')) {
      freq = 'monthly'
      interval = n * 3
    } else {
      // workday / weekday: 'every workday' = weekly pattern; a count = every Nth workday
      if (n > 1) {
        freq = 'daily'
        interval = n
      } else {
        freq = 'weekly'
        interval = 1
      }
      weekdays.push('workday')
    }
    return true
  }

  switch (headWord) {
    case 'after': {
      const m = s.match(AFTER_BODY_RE)
      if (m === null) return null
      anchor = 'completion'
      if (!applyUnit(m[2] ?? '', Number(m[1]))) return null
      good = s.pos
      break
    }
    case 'everyday':
    case 'daily':
      freq = 'daily'
      break
    case 'weekly':
      freq = 'weekly'
      break
    case 'monthly':
      freq = 'monthly'
      break
    case 'quarterly':
      freq = 'monthly'
      interval = 3
      break
    case 'yearly':
    case 'annually':
      freq = 'yearly'
      break
    case 'hourly':
      freq = 'hourly'
      break
    default: {
      // every / every! / ev — parse the body
      if (s.match(OTHER_RE) !== null) interval = 2
      let m = s.match(COUNT_UNIT_RE)
      if (m !== null) {
        if (!applyUnit(m[2] ?? '', Number(m[1]))) return null
        good = s.pos
        break
      }
      m = s.match(UNIT_RE)
      if (m !== null) {
        if (!applyUnit(m[1] ?? '', interval)) return null
        good = s.pos
        break
      }
      // positional: single ('every 3rd friday'), list ('every 15th workday, first workday'),
      // or month-anchored ('every 1st wed jan, 3rd thu jul')
      const ordSave = s.pos
      if (s.match(WS_RE) !== null) {
        const first = readOrdinalItem(s)
        if (first !== null) {
          const entries: OrdinalEntry[] = [first]
          for (;;) {
            const s2 = s.pos
            if (s.match(LIST_SEP_RE) === null) break
            const next = readOrdinalItem(s)
            if (next === null) {
              s.pos = s2
              break
            }
            entries.push(next)
          }
          const anchored = entries.filter((e) => e.month !== null).length
          // mixing month-anchored and plain positional terms is outside the model
          if (anchored !== 0 && anchored !== entries.length) return null
          if (anchored > 0) {
            freq = 'yearly'
            ordinals = entries
          } else if (entries.length === 1) {
            freq = 'monthly'
            ordinal = { nth: first.nth, unit: first.unit, weekday: first.weekday }
          } else {
            freq = 'monthly'
            ordinals = entries
          }
          good = s.pos
          break
        }
        s.pos = ordSave
      }
      // item list: weekdays | days-of-month | fixed dates | holidays
      let family: Family | null = null
      let sep: RegExp = WS_RE
      for (;;) {
        const save = s.pos
        if (s.match(sep) === null) break
        const item = readItem(s)
        if (item === null || (family !== null && item.family !== family)) {
          s.pos = save
          break
        }
        if (item.kind === 'weekday') weekdays.push(item.value)
        else if (item.kind === 'monthday') monthDays.push(item.value)
        else dates.push(item.value)
        family = item.family
        good = s.pos
        sep = LIST_SEP_RE
      }
      if (family === 'weekday') freq = 'weekly'
      else if (family === 'monthday') freq = 'monthly'
      else if (family === 'yeardate') freq = 'yearly'
    }
  }

  // tail: times and starting/until/for bounds, in any order
  for (;;) {
    const save = s.pos
    if (s.match(AT_RE) !== null) {
      const t = readTime(s, true)
      if (t !== null) {
        times.push(t)
        good = s.pos
        for (;;) {
          const s2 = s.pos
          if (s.match(TIME_LIST_SEP_RE) === null) break
          const t2 = readTime(s, true)
          if (t2 === null) {
            s.pos = s2
            break
          }
          times.push(t2)
          good = s.pos
        }
        if (s.peek(PER_DAY_TIME_GUARD_RE)) invalid = true
        if (invalid) break
        continue
      }
      s.pos = save
    }
    if (s.match(WS_RE) !== null) {
      const t = readTime(s, false)
      if (t !== null) {
        times.push(t)
        good = s.pos
        if (s.peek(PER_DAY_TIME_GUARD_RE)) invalid = true
        if (invalid) break
        continue
      }
      s.pos = save
    }
    if (s.match(STARTING_RE) !== null) {
      // 'starting at 9pm' seeds the time-of-day, not a date bound
      const s2 = s.pos
      if (s.match(AT_RE) !== null) {
        const t = readTime(s, true)
        if (t !== null) {
          times.push(t)
          good = s.pos
          continue
        }
        s.pos = s2
      }
      if (s.match(WS_RE) !== null) {
        const t = readTime(s, false)
        if (t !== null) {
          times.push(t)
          good = s.pos
          continue
        }
        s.pos = s2
      }
      const bound = readDateBound(s, ctx)
      if (bound !== null) {
        starting = bound.date
        if (bound.time !== null) times.push(bound.time)
        good = s.pos
        continue
      }
      s.pos = save
    }
    if (s.match(UNTIL_RE) !== null) {
      const bound = readDateBound(s, ctx)
      if (bound !== null) {
        until = bound.date
        good = s.pos
        continue
      }
      s.pos = save
    }
    const fm = s.match(FOR_RE)
    if (fm !== null) {
      const n = Number(fm[1])
      if (n >= 1) {
        const u = (fm[2] ?? '').toLowerCase()
        const unit = u.startsWith('day')
          ? ('day' as const)
          : u.startsWith('week')
            ? ('week' as const)
            : u.startsWith('month')
              ? ('month' as const)
              : ('year' as const)
        forBound = { n, unit }
        good = s.pos
        continue
      }
      s.pos = save
    }
    s.pos = save
    break
  }

  if (invalid) return null // per-day different times ('every mon at 8pm, tue at 9pm') unsupported
  if (freq === null) {
    if (times.length === 0) return null
    freq = 'daily' // 'every 5pm' = daily at 17:00
  }

  const spec: RecurrenceSpec = {
    anchor,
    freq,
    interval,
    weekdays,
    monthDays,
    ordinal,
    ordinals,
    dates,
    times: [...new Set(times)].sort(),
    starting,
    until,
  }
  return { spec, consumed: good, forBound }
}

type Item =
  | { kind: 'weekday'; value: number | 'workday'; family: 'weekday' }
  | { kind: 'monthday'; value: number; family: 'monthday' }
  | { kind: 'yeardate'; value: { month: number; day: number }; family: 'yeardate' }

/** one list item at the scanner position: '14 jan' | 'jan 14' | 'fri' | 'workday' | '27' | holiday */
function readItem(s: Scanner): Item | null {
  const save = s.pos
  for (const [re, value] of HOLIDAY_ITEMS) {
    if (s.match(re) !== null) return { kind: 'yeardate', value, family: 'yeardate' }
  }
  let m = s.match(DAY_MONTH_RE)
  if (m !== null) {
    const day = Number(m[1])
    const month = monthFor(m[2] ?? '')
    if (day >= 1 && day <= 31 && month !== null) {
      return { kind: 'yeardate', value: { month, day }, family: 'yeardate' }
    }
    s.pos = save
    return null
  }
  m = s.match(MONTH_DAY_RE)
  if (m !== null) {
    const month = monthFor(m[1] ?? '')
    const day = Number(m[2])
    if (day >= 1 && day <= 31 && month !== null) {
      return { kind: 'yeardate', value: { month, day }, family: 'yeardate' }
    }
    s.pos = save
    return null
  }
  m = s.match(WEEKDAY_ITEM_RE)
  if (m !== null) {
    const wd = weekdayFor(m[1] ?? '')
    if (wd !== null) return { kind: 'weekday', value: wd, family: 'weekday' }
    s.pos = save
    return null
  }
  if (s.match(WORKDAY_ITEM_RE) !== null) {
    return { kind: 'weekday', value: 'workday', family: 'weekday' }
  }
  m = s.match(BARE_DAY_RE)
  if (m !== null) {
    const day = Number(m[1])
    if (day >= 1 && day <= 31) return { kind: 'monthday', value: day, family: 'monthday' }
    s.pos = save
    return null
  }
  return null
}
