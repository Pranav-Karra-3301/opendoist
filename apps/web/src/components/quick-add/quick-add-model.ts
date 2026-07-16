/**
 * Pure Quick Add model: parse-with-detokenization, structured-submit detection, TaskCreate
 * assembly, and the small text edits chips perform. No React, no IO — unit-tested in the
 * node vitest env.
 *
 * AS-BUILT (verified against the live phase-3 server, 2026-07-16):
 * - POST /tasks `labels` are NAMES and the server auto-creates unknown labels, so no label
 *   id resolution or pre-creation is needed (`missing.labels` stays empty).
 * - POST /tasks `project_id` is an ID; unknown `#project` names surface in `missing.projects`
 *   for the caller to pre-create via POST /projects.
 * - There is no `/reminders` route this phase — reminders are parsed and highlighted but the
 *   structured path never persists them (recorded for Gate R; phase 6 adds the route).
 */
import {
  type ParseContext,
  type ParsedQuickAdd,
  parseQuickAdd,
  type QuickAddToken,
} from '@opendoist/core'
import type { Label, Project, Section, TaskCreate } from '@/api/schemas'

export interface IgnoredSpan {
  start: number
  end: number
  text: string
}

export interface QuickAddState {
  text: string
  /** token spans the user detokenized (clicked); matched by identical start + text */
  ignored: IgnoredSpan[]
}

export const EMPTY_QUICK_ADD_STATE: QuickAddState = { text: '', ignored: [] }

export interface ParseStateResult {
  /** effective parse with the ignored tokens' contributions removed */
  parsed: ParsedQuickAdd
  /** surviving (non-ignored) tokens, start-sorted — drives highlighting + chips */
  activeTokens: QuickAddToken[]
}

export interface QuickAddCaches {
  projects: readonly Project[]
  sections: readonly Section[]
  /** accepted for symmetry; label names auto-create server-side so this is never consulted */
  labels?: readonly Label[]
}

export interface CreatePayloadResult {
  payload: TaskCreate
  /** names that must be pre-created before create.mutate can resolve them to ids */
  missing: { projects: string[]; labels: string[] }
}

export function isTokenIgnored(token: QuickAddToken, ignored: readonly IgnoredSpan[]): boolean {
  return ignored.some((ig) => ig.start === token.start && ig.text === token.text)
}

/** Detokenize: add a token's span to the ignore list. Idempotent. */
export function ignoreToken(state: QuickAddState, token: QuickAddToken): QuickAddState {
  if (isTokenIgnored(token, state.ignored)) return state
  return {
    text: state.text,
    ignored: [...state.ignored, { start: token.start, end: token.end, text: token.text }],
  }
}

/** Drop ignore entries that no longer line up with a live token (the text was edited). */
export function pruneIgnored(state: QuickAddState, ctx: ParseContext): QuickAddState {
  if (state.ignored.length === 0) return state
  const { tokens } = parseQuickAdd(state.text, ctx)
  const kept = state.ignored.filter((ig) =>
    tokens.some((t) => t.start === ig.start && t.text === ig.text),
  )
  return kept.length === state.ignored.length ? state : { text: state.text, ignored: kept }
}

function labelNameFromToken(tokenText: string): string {
  const body = tokenText.startsWith('@') ? tokenText.slice(1) : tokenText
  if (body.length >= 2 && body.startsWith('"') && body.endsWith('"')) return body.slice(1, -1)
  return body
}

function dedupeCaseInsensitive(names: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const name of names) {
    const key = name.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      out.push(name)
    }
  }
  return out
}

/** Title = ORIGINAL text minus the surviving token spans, whitespace-collapsed. */
function titleFrom(text: string, activeTokens: readonly QuickAddToken[]): string {
  let out = ''
  let pos = 0
  for (const token of activeTokens) {
    out += text.slice(pos, token.start)
    pos = token.end
  }
  out += text.slice(pos)
  return out.replace(/\s+/g, ' ').trim()
}

/**
 * Parse `state.text`, then surgically strip the contributions of any detokenized (ignored)
 * spans so the effective fields reflect exactly what will be saved.
 */
export function parseState(state: QuickAddState, ctx: ParseContext): ParseStateResult {
  const raw = parseQuickAdd(state.text, ctx)
  const activeTokens = raw.tokens.filter((t) => !isTokenIgnored(t, state.ignored))
  const has = (kind: QuickAddToken['kind']): boolean => activeTokens.some((t) => t.kind === kind)

  const project = has('project') ? raw.project : null
  const section = project !== null && has('section') ? raw.section : null
  const due = has('due') ? raw.due : null
  const durationMin = due !== null && has('duration') ? raw.durationMin : null

  const labels = dedupeCaseInsensitive(
    activeTokens.filter((t) => t.kind === 'label').map((t) => labelNameFromToken(t.text)),
  )

  const reminderTokens = raw.tokens.filter((t) => t.kind === 'reminder')
  const reminders = raw.reminders.filter((_, i) => {
    const token = reminderTokens[i]
    return token === undefined || !isTokenIgnored(token, state.ignored)
  })

  const parsed: ParsedQuickAdd = {
    title: titleFrom(state.text, activeTokens),
    tokens: activeTokens,
    due,
    durationMin,
    deadline: has('deadline') ? raw.deadline : null,
    priority: has('priority') ? raw.priority : 4,
    labels,
    project,
    section,
    reminders,
    description: has('description') ? raw.description : null,
    uncompletable: has('uncompletable') ? raw.uncompletable : false,
  }
  return { parsed, activeTokens }
}

/** Detokenized input can't ride the re-parsing `/tasks/quick` endpoint — build it by hand. */
export function needsStructuredSubmit(state: QuickAddState): boolean {
  return state.ignored.length > 0
}

function findByName<T extends { name: string }>(items: readonly T[], name: string): T | undefined {
  const key = name.toLowerCase()
  return items.find((item) => item.name.toLowerCase() === key)
}

/**
 * Assemble a `TaskCreate` from an effective parse. Project names resolve to ids from the
 * cache (unknown ones reported in `missing.projects`); label names travel verbatim because
 * the server auto-creates them.
 */
export function toCreatePayload(
  parsed: ParsedQuickAdd,
  caches: QuickAddCaches,
): CreatePayloadResult {
  const missing = { projects: [] as string[], labels: [] as string[] }
  const payload: TaskCreate = { content: parsed.title, priority: parsed.priority }
  if (parsed.description !== null) payload.description = parsed.description
  if (parsed.due !== null) payload.due = parsed.due
  if (parsed.deadline !== null) payload.deadline_date = parsed.deadline
  if (parsed.durationMin !== null) payload.duration_min = parsed.durationMin
  if (parsed.labels.length > 0) payload.labels = parsed.labels
  if (parsed.uncompletable) payload.uncompletable = true

  if (parsed.project !== null) {
    const project = findByName(caches.projects, parsed.project)
    if (project) {
      payload.project_id = project.id
      if (parsed.section !== null) {
        const sectionName = parsed.section.toLowerCase()
        const section = caches.sections.find(
          (s) => s.project_id === project.id && s.name.toLowerCase() === sectionName,
        )
        if (section) payload.section_id = section.id
      }
    } else {
      missing.projects.push(parsed.project)
    }
  }
  return { payload, missing }
}

/* ---------- text edits performed by the chip row ---------- */

/** Replace `[start, end)` in `text` with `replacement`. */
export function replaceRange(
  text: string,
  start: number,
  end: number,
  replacement: string,
): string {
  return text.slice(0, start) + replacement + text.slice(end)
}

/** Remove `[start, end)` and tidy the seam (collapse doubled whitespace, trim edges). */
export function stripRange(text: string, start: number, end: number): string {
  return (text.slice(0, start) + text.slice(end)).replace(/\s{2,}/g, ' ').trim()
}

function appendToken(text: string, token: string): string {
  const head = text.replace(/\s+$/, '')
  return head === '' ? token : `${head} ${token}`
}

/** Set/replace/clear the priority token (p4 = default = clear). */
export function setPriorityText(
  text: string,
  activeTokens: readonly QuickAddToken[],
  priority: 1 | 2 | 3 | 4,
): string {
  const token = activeTokens.find((t) => t.kind === 'priority')
  const next = priority === 4 ? '' : `p${priority}`
  if (token) {
    return next === ''
      ? stripRange(text, token.start, token.end)
      : replaceRange(text, token.start, token.end, next)
  }
  return next === '' ? text : appendToken(text, next)
}

/** Set/replace/clear the bare due phrase (empty phrase clears it). */
export function setDueText(
  text: string,
  activeTokens: readonly QuickAddToken[],
  phrase: string,
): string {
  const token = activeTokens.find((t) => t.kind === 'due')
  if (token) {
    return phrase === ''
      ? stripRange(text, token.start, token.end)
      : replaceRange(text, token.start, token.end, phrase)
  }
  return phrase === '' ? text : appendToken(text, phrase)
}
