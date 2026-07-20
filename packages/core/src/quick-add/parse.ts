import { durationAfter, findDateSpans } from '../nl-date'
import {
  type Due,
  type ParseContext,
  type ParsedQuickAdd,
  ParsedQuickAddSchema,
  type QuickAddToken,
} from '../types'
import {
  findRecurrenceSpan,
  resolveOverlaps,
  type SigilCandidate,
  type Span,
  scanSigils,
  splitDurationTail,
} from './tokens'

function ofKind<K extends SigilCandidate['kind']>(
  candidates: SigilCandidate[],
  kind: K,
): Extract<SigilCandidate, { kind: K }>[] {
  return candidates.filter((c): c is Extract<SigilCandidate, { kind: K }> => c.kind === kind)
}

function maskRanges(text: string, ranges: Span[]): string {
  let out = text
  for (const r of ranges) {
    out = out.slice(0, r.start) + 'x'.repeat(r.end - r.start) + out.slice(r.end)
  }
  return out
}

/** Parse a Quick Add input line into its structured parts.
 *  Grammar per dossier §1.1–1.3: bare natural-language dates (and `every …` recurrences) become
 *  the due; `{date}` deadline; `!…` reminders; `#project` `/section` `@label` `p1–p4` sigils;
 *  ` // ` description; leading `* ` uncompletable. */
export function parseQuickAdd(input: string, ctx: ParseContext): ParsedQuickAdd {
  const tokens: QuickAddToken[] = []

  // 1. description: everything after the first ` // ` — never scanned for other tokens
  const sep = input.indexOf(' // ')
  const head = sep === -1 ? input : input.slice(0, sep)
  let description: string | null = null
  if (sep !== -1) {
    const raw = input.slice(sep + 4).trim()
    description = raw === '' ? null : raw
    tokens.push({
      kind: 'description',
      start: sep + 1,
      end: input.length,
      text: input.slice(sep + 1),
    })
  }

  // 2. uncompletable: leading `* `
  let uncompletable = false
  const star = /^(\s*)\* /.exec(head)
  const starStart = star ? (star[1]?.length ?? 0) : 0
  if (star) {
    uncompletable = true
    tokens.push({ kind: 'uncompletable', start: starStart, end: starStart + 2, text: '* ' })
  }

  // 3. sigil tokens
  const scan = scanSigils(head, ctx)
  const projects = ofKind(scan.candidates, 'project')
  const sections = ofKind(scan.candidates, 'section')
  const labelCandidates = ofKind(scan.candidates, 'label')
  const priorities = ofKind(scan.candidates, 'priority')
  const deadlines = ofKind(scan.candidates, 'deadline')
  const reminderCandidates = ofKind(scan.candidates, 'reminder')

  // duplicate project/section/priority/deadline: last one wins, earlier occurrences stay text
  const project = projects.at(-1) ?? null
  const section = project ? (sections.at(-1) ?? null) : null // sections need a project token
  const priority = priorities.at(-1) ?? null
  const deadline = deadlines.at(-1) ?? null

  const winners: SigilCandidate[] = [
    ...(project ? [project] : []),
    ...(section ? [section] : []),
    ...labelCandidates,
    ...(priority ? [priority] : []),
    ...(deadline ? [deadline] : []),
    ...reminderCandidates,
  ]
  for (const w of winners) tokens.push({ kind: w.kind, start: w.start, end: w.end, text: w.text })

  // labels accumulate; dedupe case-insensitively, keeping the first spelling
  const labels: string[] = []
  const seenLabels = new Set<string>()
  for (const l of labelCandidates) {
    const key = l.name.toLowerCase()
    if (!seenLabels.has(key)) {
      seenLabels.add(key)
      labels.push(l.name)
    }
  }

  // 4. mask everything sigil-claimed (winners AND losers) plus failed-brace dead zones,
  //    so the due scan never reads inside them; 'x' filler keeps offsets stable
  const masked = maskRanges(head, [
    ...scan.candidates,
    ...scan.deadZones,
    ...(star ? [{ start: starStart, end: starStart + 2 }] : []),
  ])

  // 5. due: an `every …` recurrence phrase takes precedence; otherwise the first date span
  let due: Due | null = null
  let durationMin: number | null = null
  if (ctx.smartDate) {
    const rec = findRecurrenceSpan(masked, ctx)
    if (rec) {
      const text = head.slice(rec.start, rec.end)
      due = { date: rec.firstDate, time: rec.firstTime, string: text, recurrence: rec.spec }
      tokens.push({ kind: 'due', start: rec.start, end: rec.end, text })
      // dossier §1.1: ' for <duration>' after a timed phrase applies to recurring dues too
      if (rec.firstTime !== null) {
        const dur = durationAfter(masked, rec.end)
        if (dur) {
          durationMin = dur.minutes
          tokens.push({
            kind: 'duration',
            start: dur.forStart,
            end: dur.end,
            text: head.slice(dur.forStart, dur.end),
          })
        }
      }
    } else {
      const span = findDateSpans(masked, ctx)[0]
      if (span) {
        const split = span.durationMin === null ? null : splitDurationTail(span.text)
        const dueEnd = split ? span.start + split.coreLength : span.end
        const dueText = head.slice(span.start, dueEnd)
        due = { date: span.date, time: span.time, string: dueText, recurrence: null }
        tokens.push({ kind: 'due', start: span.start, end: dueEnd, text: dueText })
        if (split && span.durationMin !== null) {
          durationMin = span.durationMin
          const forStart = span.start + split.forOffset
          tokens.push({
            kind: 'duration',
            start: forStart,
            end: span.end,
            text: head.slice(forStart, span.end),
          })
        }
      }
    }
  }

  // 6. tokens never overlap (earlier-starting longer wins); title = input minus token spans
  const finalTokens = resolveOverlaps(tokens)
  let title = ''
  let pos = 0
  for (const t of finalTokens) {
    title += input.slice(pos, t.start)
    pos = t.end
  }
  title += input.slice(pos)
  title = title.replace(/\s+/g, ' ').trim()

  return ParsedQuickAddSchema.parse({
    title,
    tokens: finalTokens,
    due,
    durationMin,
    // brace deadlines carry an optional resolved wall-clock time ({next friday 5pm} → { date, time });
    // date-only phrases ({march 30}) keep time null (Task B)
    deadline: deadline ? { date: deadline.date, time: deadline.time } : null,
    priority: priority?.priority ?? 4,
    labels,
    project: project?.name ?? null,
    section: section?.name ?? null,
    reminders: reminderCandidates.map((r) => r.draft),
    description,
    uncompletable,
  })
}
