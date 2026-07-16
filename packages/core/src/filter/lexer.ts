import { type FilterPredicate, FilterSyntaxError, type Priority } from '../types'

export type FilterToken =
  | { kind: 'lparen' | 'rparen' | 'comma' | 'and' | 'or' | 'not'; pos: number }
  | { kind: 'predicate'; pred: FilterPredicate; pos: number }
  | { kind: 'eof'; pos: number }

/** chars that end a name / date ref / search text unless escaped with `\` */
const TERMINATORS = new Set(['&', '|', '(', ')', ','])

interface ScannedText {
  text: string
  next: number
}

/** decode `\`-escaped text from `from` until an unescaped terminator or end of input */
function scanText(input: string, from: number): ScannedText {
  let out = ''
  let i = from
  while (i < input.length) {
    const ch = input.charAt(i)
    if (ch === '\\' && i + 1 < input.length) {
      out += input.charAt(i + 1)
      i += 2
      continue
    }
    if (TERMINATORS.has(ch)) break
    out += ch
    i += 1
  }
  return { text: out.trim(), next: i }
}

type ColonOp =
  | 'dateOn'
  | 'dateBefore'
  | 'dateAfter'
  | 'deadlineOn'
  | 'deadlineBefore'
  | 'deadlineAfter'
  | 'createdOn'
  | 'createdBefore'
  | 'createdAfter'

/** order matters: longest phrases first so `date before:` wins over `date:` */
const COLON_OPS: ReadonlyArray<{ re: RegExp; op: ColonOp }> = [
  { re: /^date\s+before\s*:/i, op: 'dateBefore' },
  { re: /^date\s+after\s*:/i, op: 'dateAfter' },
  { re: /^due\s+before\s*:/i, op: 'dateBefore' },
  { re: /^due\s+after\s*:/i, op: 'dateAfter' },
  { re: /^date\s*:/i, op: 'dateOn' },
  { re: /^deadline\s+before\s*:/i, op: 'deadlineBefore' },
  { re: /^deadline\s+after\s*:/i, op: 'deadlineAfter' },
  { re: /^deadline\s*:/i, op: 'deadlineOn' },
  { re: /^created\s+before\s*:/i, op: 'createdBefore' },
  { re: /^created\s+after\s*:/i, op: 'createdAfter' },
  { re: /^created\s*:/i, op: 'createdOn' },
]

function colonPredicate(op: ColonOp, ref: string): FilterPredicate {
  switch (op) {
    case 'dateOn':
      return { t: 'dateOn', ref }
    case 'dateBefore':
      return { t: 'dateBefore', ref }
    case 'dateAfter':
      return { t: 'dateAfter', ref }
    case 'deadlineOn':
      return { t: 'deadlineOn', ref }
    case 'deadlineBefore':
      return { t: 'deadlineBefore', ref }
    case 'deadlineAfter':
      return { t: 'deadlineAfter', ref }
    case 'createdOn':
      return { t: 'createdOn', ref }
    case 'createdBefore':
      return { t: 'createdBefore', ref }
    case 'createdAfter':
      return { t: 'createdAfter', ref }
  }
}

const KEYWORDS: ReadonlyArray<{ re: RegExp; make: () => FilterPredicate }> = [
  { re: /^no\s+date\b/i, make: () => ({ t: 'noDate' }) },
  { re: /^no\s+time\b/i, make: () => ({ t: 'noTime' }) },
  { re: /^no\s+labels\b/i, make: () => ({ t: 'noLabels' }) },
  { re: /^no\s+priority\b/i, make: () => ({ t: 'noPriority' }) },
  { re: /^no\s+deadline\b/i, make: () => ({ t: 'noDeadline' }) },
  { re: /^no\s+section\b/i, make: () => ({ t: 'noSection' }) },
  { re: /^view\s+all\b/i, make: () => ({ t: 'viewAll' }) },
  { re: /^all\b/i, make: () => ({ t: 'viewAll' }) },
  { re: /^today\b/i, make: () => ({ t: 'today' }) },
  { re: /^tomorrow\b/i, make: () => ({ t: 'tomorrow' }) },
  { re: /^yesterday\b/i, make: () => ({ t: 'yesterday' }) },
  { re: /^overdue\b/i, make: () => ({ t: 'overdue' }) },
  { re: /^od\b/i, make: () => ({ t: 'overdue' }) },
  { re: /^recurring\b/i, make: () => ({ t: 'recurring' }) },
  { re: /^subtask\b/i, make: () => ({ t: 'subtask' }) },
  { re: /^uncompletable\b/i, make: () => ({ t: 'uncompletable' }) },
]

const SEARCH_RE = /^search\s*:/i
const PRIORITY_RE = /^p([1-4])\b/i
const NEXT_N_DAYS_RE = /^next\s+(\d+)\s+days?\b/i
const N_DAYS_RE = /^(\d+)\s+days?\b/i

const PRIORITY_BY_DIGIT: Record<string, Priority> = { 1: 1, 2: 2, 3: 3, 4: 4 }

const STRUCTURAL: Record<string, 'lparen' | 'rparen' | 'comma' | 'and' | 'or' | 'not'> = {
  '(': 'lparen',
  ')': 'rparen',
  ',': 'comma',
  '&': 'and',
  '|': 'or',
  '!': 'not',
}

function nameAfter(input: string, sigil: string, start: number): ScannedText {
  const scanned = scanText(input, start)
  if (scanned.text === '') {
    throw new FilterSyntaxError(`expected a name after '${sigil}'`, start)
  }
  return scanned
}

/**
 * Tokenize a filter query. Names, date refs and search text run until an unescaped
 * `& | ( ) ,` (so they may contain spaces, e.g. `#One \& Two`); `\` escapes the next char.
 * Unrecognized bare text becomes a raw date-on ref, resolved at evaluation time
 * (`saturday & @night`). Time-of-day comparisons need the explicit form (`date: today at 2pm`).
 */
export function lexFilter(input: string): FilterToken[] {
  const tokens: FilterToken[] = []
  let i = 0
  while (i < input.length) {
    const ch = input.charAt(i)
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    const pos = i
    const structural = STRUCTURAL[ch]
    if (structural) {
      tokens.push({ kind: structural, pos })
      i += 1
      continue
    }
    const rest = input.slice(i)

    const colon = COLON_OPS.find(({ re }) => re.test(rest))
    if (colon) {
      const m = colon.re.exec(rest)
      const opLength = m ? m[0].length : 0
      const scanned = scanText(input, i + opLength)
      if (scanned.text === '') {
        throw new FilterSyntaxError('expected a date after the operator', i + opLength)
      }
      tokens.push({ kind: 'predicate', pred: colonPredicate(colon.op, scanned.text), pos })
      i = scanned.next
      continue
    }

    const search = SEARCH_RE.exec(rest)
    if (search) {
      const scanned = scanText(input, i + search[0].length)
      if (scanned.text === '') {
        throw new FilterSyntaxError("expected text after 'search:'", i + search[0].length)
      }
      tokens.push({ kind: 'predicate', pred: { t: 'search', text: scanned.text }, pos })
      i = scanned.next
      continue
    }

    const keyword = KEYWORDS.find(({ re }) => re.test(rest))
    if (keyword) {
      const m = keyword.re.exec(rest)
      tokens.push({ kind: 'predicate', pred: keyword.make(), pos })
      i += m ? m[0].length : 0
      continue
    }

    const priority = PRIORITY_RE.exec(rest)
    if (priority) {
      const value = PRIORITY_BY_DIGIT[priority[1] ?? '']
      if (value !== undefined) {
        tokens.push({ kind: 'predicate', pred: { t: 'priority', value }, pos })
        i += priority[0].length
        continue
      }
    }

    const nDays = NEXT_N_DAYS_RE.exec(rest) ?? N_DAYS_RE.exec(rest)
    if (nDays) {
      tokens.push({
        kind: 'predicate',
        pred: { t: 'dateWithin', days: Number(nDays[1]) },
        pos,
      })
      i += nDays[0].length
      continue
    }

    if (rest.startsWith('##')) {
      const scanned = nameAfter(input, '##', i + 2)
      tokens.push({
        kind: 'predicate',
        pred: { t: 'project', name: scanned.text, withDescendants: true },
        pos,
      })
      i = scanned.next
      continue
    }
    if (ch === '#') {
      const scanned = nameAfter(input, '#', i + 1)
      tokens.push({
        kind: 'predicate',
        pred: { t: 'project', name: scanned.text, withDescendants: false },
        pos,
      })
      i = scanned.next
      continue
    }
    if (ch === '@') {
      const scanned = nameAfter(input, '@', i + 1)
      tokens.push({
        kind: 'predicate',
        pred: { t: 'label', name: scanned.text, wildcard: scanned.text.includes('*') },
        pos,
      })
      i = scanned.next
      continue
    }
    if (rest.startsWith('/#')) {
      const scanned = nameAfter(input, '/#', i + 2)
      tokens.push({
        kind: 'predicate',
        pred: { t: 'section', name: scanned.text, anyProject: true },
        pos,
      })
      i = scanned.next
      continue
    }
    if (ch === '/') {
      const scanned = nameAfter(input, '/', i + 1)
      tokens.push({
        kind: 'predicate',
        pred: { t: 'section', name: scanned.text, anyProject: false },
        pos,
      })
      i = scanned.next
      continue
    }

    // bare text fallback: a date phrase resolved at eval time ('saturday', 'jan 3', '27')
    const scanned = scanText(input, i)
    if (scanned.text === '') {
      throw new FilterSyntaxError(`unexpected character '${ch}'`, pos)
    }
    tokens.push({ kind: 'predicate', pred: { t: 'dateOn', ref: scanned.text }, pos })
    i = scanned.next
  }
  tokens.push({ kind: 'eof', pos: input.length })
  return tokens
}
