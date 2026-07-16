/**
 * Reporting presentation helpers — PURE (no React / no IO), unit-tested.
 *
 * Task K owns the mapping from raw activity events to the icon name, verb frame, and
 * full sentence the feed renders, plus the timezone-aware day grouping shared by the
 * Activity and Completed feeds. Keeping these pure keeps them testable under the web
 * app's node Vitest env (no DOM) and identical to whatever the server later emits.
 */
import {
  type ActivityEvent,
  addDaysIso,
  dateInTz,
  diffDays,
  isoWeekday,
  type KnownActivityType,
  timeInTz,
} from '@opendoist/core'

/** Lucide icon *names* (resolved to components in ActivityFeed) — kept as strings so
 *  this module never imports React/lucide and stays testable in the node env. */
export type EventIconName =
  | 'Plus'
  | 'CircleCheck'
  | 'Undo2'
  | 'ArrowRightLeft'
  | 'RotateCcw'
  | 'Trash2'
  | 'Pencil'
  | 'Hash'
  | 'MessageSquare'
  | 'Rows3'
  | 'Tag'
  | 'Filter'
  | 'CircleDot'

/**
 * Map an event type to a Lucide icon name. Specific task verbs win first, then the
 * `*_deleted`/`*_updated` suffix rules, then per-entity prefixes; anything unknown
 * falls back to `CircleDot` so server drift never blanks a row.
 */
export function eventIcon(eventType: string): EventIconName {
  switch (eventType) {
    case 'task_added':
      return 'Plus'
    case 'task_completed':
      return 'CircleCheck'
    case 'task_uncompleted':
      return 'Undo2'
    case 'task_moved':
      return 'ArrowRightLeft'
    case 'task_restored':
      return 'RotateCcw'
    default:
      break
  }
  if (eventType.endsWith('_deleted')) return 'Trash2'
  if (eventType.endsWith('_updated')) return 'Pencil'
  if (eventType.startsWith('project_')) return 'Hash'
  if (eventType.startsWith('comment_')) return 'MessageSquare'
  if (eventType.startsWith('section_')) return 'Rows3'
  if (eventType.startsWith('label_')) return 'Tag'
  if (eventType.startsWith('filter_')) return 'Filter'
  return 'CircleDot'
}

/** Verb frames for every known event type (the 13px secondary part of a row). */
const FRAMES = new Map<KnownActivityType, string>([
  ['task_added', 'You added a task'],
  ['task_updated', 'You updated a task'],
  ['task_completed', 'You completed a task'],
  ['task_uncompleted', 'You uncompleted a task'],
  ['task_deleted', 'You deleted a task'],
  ['task_restored', 'You restored a task'],
  ['task_moved', 'You moved a task'],
  ['project_added', 'You added a project'],
  ['project_updated', 'You updated a project'],
  ['project_archived', 'You archived a project'],
  ['project_unarchived', 'You unarchived a project'],
  ['project_deleted', 'You deleted a project'],
  ['project_restored', 'You restored a project'],
  ['section_added', 'You added a section'],
  ['section_updated', 'You updated a section'],
  ['section_deleted', 'You deleted a section'],
  ['section_restored', 'You restored a section'],
  ['label_added', 'You added a label'],
  ['label_updated', 'You updated a label'],
  ['label_deleted', 'You deleted a label'],
  ['filter_added', 'You added a filter'],
  ['filter_updated', 'You updated a filter'],
  ['filter_deleted', 'You deleted a filter'],
  ['comment_added', 'You added a comment'],
  ['comment_deleted', 'You deleted a comment'],
])

/** The verb frame WITHOUT the entity content; unknown types degrade to a readable string. */
export function eventFrame(eventType: string): string {
  return FRAMES.get(eventType as KnownActivityType) ?? `You ${eventType.replaceAll('_', ' ')}`
}

/** Full one-line sentence, e.g. "You completed a task: Water plants". */
export function eventSentence(e: Pick<ActivityEvent, 'event_type' | 'payload'>): string {
  const frame = eventFrame(e.event_type)
  const content = e.payload.content.trim()
  return content === '' ? frame : `${frame}: ${content}`
}

/** Title-cased human label for an event type, e.g. "task_completed" → "Task completed". */
export function typeLabel(eventType: string): string {
  const words = eventType.replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/**
 * Day-header label for an instant, relative to `now`, both resolved to the user's tz:
 * "Today" / "Yesterday" / "Jul 13 · Sunday".
 */
export function dayLabel(atIso: string, timezone: string, now: string): string {
  const atDate = dateInTz(atIso, timezone)
  const todayDate = dateInTz(now, timezone)
  const delta = diffDays(atDate, todayDate) // today − at (positive = in the past)
  if (delta === 0) return 'Today'
  if (delta === 1) return 'Yesterday'
  const month = Number(atDate.slice(5, 7))
  const day = Number(atDate.slice(8, 10))
  return `${MONTHS[month - 1] ?? ''} ${day} · ${WEEKDAYS[isoWeekday(atDate) - 1] ?? ''}`
}

/** Wall-clock time of an instant in the user's tz, formatted for 12h/24h preference. */
export function formatEventTime(
  atIso: string,
  timezone: string,
  timeFormat: '12h' | '24h',
): string {
  const hhmm = timeInTz(atIso, timezone)
  if (timeFormat === '24h') return hhmm
  const hours = Number(hhmm.slice(0, 2))
  const minutes = hhmm.slice(3, 5)
  const suffix = hours < 12 ? 'am' : 'pm'
  const h12 = hours % 12 === 0 ? 12 : hours % 12
  return `${h12}:${minutes}${suffix}`
}

export interface DayGroup<T> {
  key: string
  label: string
  items: T[]
}

/**
 * Group already-newest-first rows into consecutive day buckets (server orders by
 * `at`/`completed_at` DESC, so a single pass keyed on the tz calendar date suffices).
 */
export function groupByDay<T>(
  items: readonly T[],
  getInstant: (item: T) => string,
  timezone: string,
  now: string,
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = []
  for (const item of items) {
    const at = getInstant(item)
    const key = dateInTz(at, timezone)
    const last = groups.at(-1)
    if (last && last.key === key) last.items.push(item)
    else groups.push({ key, label: dayLabel(at, timezone, now), items: [item] })
  }
  return groups
}

export type RangePreset = 'all' | '7d' | '30d' | 'custom'

/** since-bound for a preset range (undefined = unbounded); custom ranges supply their own. */
export function rangeSince(range: RangePreset, todayIso: string): string | undefined {
  if (range === '7d') return addDaysIso(todayIso, -7)
  if (range === '30d') return addDaysIso(todayIso, -30)
  return undefined
}

export interface ReportingFilterState {
  /** empty = all event types */
  types: string[]
  /** '' = all projects */
  projectId: string
  range: RangePreset
  /** YYYY-MM-DD, only used when range === 'custom' */
  since: string
  until: string
}

export const DEFAULT_REPORTING_FILTERS: ReportingFilterState = {
  types: [],
  projectId: '',
  range: 'all',
  since: '',
  until: '',
}

export interface ReportingScope {
  project_id?: string
  since?: string
  until?: string
}

/** Derive the shared query scope (project + date bounds) both feeds send to the server. */
export function buildReportingScope(state: ReportingFilterState, todayIso: string): ReportingScope {
  const scope: ReportingScope = {}
  if (state.projectId !== '') scope.project_id = state.projectId
  const since =
    state.range === 'custom'
      ? state.since === ''
        ? undefined
        : state.since
      : rangeSince(state.range, todayIso)
  const until = state.range === 'custom' && state.until !== '' ? state.until : undefined
  if (since !== undefined) scope.since = since
  if (until !== undefined) scope.until = until
  return scope
}
