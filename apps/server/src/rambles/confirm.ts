import {
  type Due,
  type ParseContext,
  type Priority,
  parseQuickAdd,
  resolveNaturalDate,
} from '@opendoist/core'
import type { ExtractedTask } from './schemas'
import type { TaskDraft } from './types'

/** Resolve a spoken due phrase against the core date layer — the LLM never invents ISO dates.
 *  Order: `parseQuickAdd` (captures times AND `every …` recurrences) → `resolveNaturalDate`
 *  (date-only fallback) → unparseable (returns the raw phrase for the description note). */
function resolveDuePhrase(
  phrase: string,
  ctx: ParseContext,
): { due: Due | null; unparsed: string | null } {
  const fromQuickAdd = parseQuickAdd(phrase, ctx).due
  if (fromQuickAdd !== null) return { due: fromQuickAdd, unparsed: null }

  const resolved = resolveNaturalDate(phrase, ctx)
  if (resolved !== null) {
    return {
      due: { date: resolved.date, time: resolved.time, string: phrase, recurrence: null },
      unparsed: null,
    }
  }

  return { due: null, unparsed: phrase }
}

/** Trim, drop empties, case-insensitive dedupe keeping the first spelling. */
function normalizeLabels(labels: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of labels) {
    const name = raw.trim()
    if (name === '') continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/**
 * Map reviewed/extracted ramble items to task drafts ready for the shared task-creation service.
 * Pure and total on schema-valid input: never throws, preserves item order, and re-scans nothing —
 * a spoken `#tag`/`p1` inside a title stays literal text (only the `due` phrase is date-parsed).
 */
export function buildTaskDrafts(items: ExtractedTask[], ctx: ParseContext): TaskDraft[] {
  return items.map((item) => {
    let due: Due | null = null
    let unparsed: string | null = null
    const phrase = item.due
    if (phrase !== null && phrase.trim() !== '') {
      const resolved = resolveDuePhrase(phrase, ctx)
      due = resolved.due
      unparsed = resolved.unparsed
    }

    const paragraphs: string[] = []
    if (item.notes !== null && item.notes.trim() !== '') paragraphs.push(item.notes)
    if (unparsed !== null) paragraphs.push(`Due (unparsed): ${unparsed}`)

    return {
      content: item.title.trim(),
      description: paragraphs.length > 0 ? paragraphs.join('\n\n') : null,
      due,
      priority: (item.priority ?? 4) as Priority,
      labels: normalizeLabels(item.labels),
    }
  })
}
