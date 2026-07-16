/**
 * View engine — phase-5 Task C. Pure group/sort/filter-by transforms plus pane splitting,
 * layered over the full active-task set (single-user scale, client-side rendering per spec §3.1).
 * Signatures are FROZEN by Task A Step 3; `TaskGroup` is unchanged.
 */
import { dateInTz, diffDays, isoWeekday, timeInTz } from './dates'
import type { ViewFilterBy, ViewGroupBy, ViewSortBy } from './settings'
import type { FilterContext, FilterTaskView } from './types'

export interface TaskGroup {
  key: string
  label: string
  tasks: FilterTaskView[]
}

/** ISO-weekday-indexed names (Monday = 1 … Sunday = 7) for date-group labels */
const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const

/**
 * Due before today, or due today with a wall-clock time already past.
 * Mirrors the core `overdue` filter predicate (filter/evaluate.ts) so the "filter by overdue"
 * control and the "Overdue" date bucket always agree; an all-day task due today is NOT overdue.
 */
function isOverdue(task: FilterTaskView, today: string, nowTime: string): boolean {
  if (task.dueDate === null) return false
  if (task.dueDate < today) return true
  return task.dueDate === today && task.dueTime !== null && task.dueTime < nowTime
}

/**
 * Keep only tasks matching every non-null field of `f` (fields combine with AND; null = no-op).
 * priority → exact match · label → case-insensitive membership · due → has-date / no-date / overdue.
 * Non-mutating.
 */
export function applyViewFilter(
  tasks: FilterTaskView[],
  f: ViewFilterBy,
  ctx: FilterContext,
): FilterTaskView[] {
  const today = dateInTz(ctx.now, ctx.timezone)
  const nowTime = timeInTz(ctx.now, ctx.timezone)
  const wantLabel = f.label === null ? null : f.label.toLowerCase()
  return tasks.filter((task) => {
    if (f.priority !== null && task.priority !== f.priority) return false
    if (wantLabel !== null && !task.labels.some((l) => l.toLowerCase() === wantLabel)) return false
    if (f.due === 'has-date' && task.dueDate === null) return false
    if (f.due === 'no-date' && task.dueDate !== null) return false
    if (f.due === 'overdue' && !isOverdue(task, today, nowTime)) return false
    return true
  })
}

type Comparator = (a: FilterTaskView, b: FilterTaskView) => number

/** ascending by due (date then time; all-day = start of day 00:00), no-date last */
function compareDue(a: FilterTaskView, b: FilterTaskView): number {
  if (a.dueDate === null && b.dueDate === null) return 0
  if (a.dueDate === null) return 1
  if (b.dueDate === null) return -1
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1
  const at = a.dueTime ?? '00:00'
  const bt = b.dueTime ?? '00:00'
  return at < bt ? -1 : at > bt ? 1 : 0
}

/** ascending by due date only (ignores time), no-date last — the priority-sort tiebreak */
function compareDueDate(a: FilterTaskView, b: FilterTaskView): number {
  if (a.dueDate === null && b.dueDate === null) return 0
  if (a.dueDate === null) return 1
  if (b.dueDate === null) return -1
  return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0
}

const SORTERS: Record<Exclude<ViewSortBy, 'manual'>, Comparator> = {
  date: compareDue,
  added: (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0),
  priority: (a, b) => (a.priority !== b.priority ? a.priority - b.priority : compareDueDate(a, b)),
  alphabetical: (a, b) => a.content.localeCompare(b.content, undefined, { sensitivity: 'base' }),
}

/**
 * Stable, non-mutating sort. `manual` keeps input order; `desc` reverses the ascending result
 * (so ties and the manual order flip wholesale, per the frozen semantics).
 */
export function sortTasks(
  tasks: FilterTaskView[],
  s: ViewSortBy,
  dir: 'asc' | 'desc',
  _ctx: FilterContext,
): FilterTaskView[] {
  const sorted = s === 'manual' ? [...tasks] : [...tasks].sort(SORTERS[s])
  return dir === 'desc' ? sorted.reverse() : sorted
}

function groupByProject(tasks: FilterTaskView[]): TaskGroup[] {
  const groups = new Map<string, TaskGroup>()
  for (const task of tasks) {
    const key = `project:${task.projectId}`
    let group = groups.get(key)
    if (!group) {
      group = { key, label: task.projectName, tasks: [] }
      groups.set(key, group)
    }
    group.tasks.push(task)
  }
  return [...groups.values()]
}

function groupByPriority(tasks: FilterTaskView[]): TaskGroup[] {
  const out: TaskGroup[] = []
  for (const p of [1, 2, 3, 4] as const) {
    const bucket = tasks.filter((t) => t.priority === p)
    if (bucket.length > 0) out.push({ key: `priority:${p}`, label: `Priority ${p}`, tasks: bucket })
  }
  return out
}

function groupByLabel(tasks: FilterTaskView[]): TaskGroup[] {
  const labels = new Set<string>()
  for (const task of tasks) for (const label of task.labels) labels.add(label)
  const sorted = [...labels].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  const out: TaskGroup[] = sorted.map((label) => ({
    key: `label:${label}`,
    label,
    tasks: tasks.filter((t) => t.labels.includes(label)),
  }))
  const unlabeled = tasks.filter((t) => t.labels.length === 0)
  if (unlabeled.length > 0) out.push({ key: 'label:none', label: 'No label', tasks: unlabeled })
  return out
}

interface DateBucket {
  rank: number
  label: string
  tasks: FilterTaskView[]
}

function groupByDate(tasks: FilterTaskView[], ctx: FilterContext): TaskGroup[] {
  const today = dateInTz(ctx.now, ctx.timezone)
  const nowTime = timeInTz(ctx.now, ctx.timezone)
  const buckets = new Map<string, DateBucket>()
  const put = (key: string, rank: number, label: string, task: FilterTaskView) => {
    const existing = buckets.get(key)
    if (existing) existing.tasks.push(task)
    else buckets.set(key, { rank, label, tasks: [task] })
  }
  for (const task of tasks) {
    if (task.dueDate === null) {
      put('no-date', 10, 'No date', task)
      continue
    }
    if (isOverdue(task, today, nowTime)) {
      put('overdue', 0, 'Overdue', task)
      continue
    }
    // dueDate >= today here: any earlier date was caught by isOverdue.
    const diff = diffDays(today, task.dueDate)
    if (diff === 0) put('today', 1, 'Today', task)
    else if (diff === 1) put('tomorrow', 2, 'Tomorrow', task)
    else if (diff <= 7) {
      put(`day:${task.dueDate}`, diff + 1, WEEKDAY_NAMES[isoWeekday(task.dueDate) - 1] ?? '', task)
    } else put('later', 9, 'Later', task)
  }
  return [...buckets.entries()]
    .sort(([, a], [, b]) => a.rank - b.rank)
    .map(([key, b]) => ({ key, label: b.label, tasks: b.tasks }))
}

/**
 * Partition `tasks` into ordered groups. `none` always yields a single `{key:'all', label:''}`
 * group; the other modes skip empty groups. Non-mutating (every group holds a fresh array).
 */
export function groupTasks(
  tasks: FilterTaskView[],
  g: ViewGroupBy,
  ctx: FilterContext,
): TaskGroup[] {
  switch (g) {
    case 'none':
      return [{ key: 'all', label: '', tasks: [...tasks] }]
    case 'project':
      return groupByProject(tasks)
    case 'priority':
      return groupByPriority(tasks)
    case 'label':
      return groupByLabel(tasks)
    case 'date':
      return groupByDate(tasks, ctx)
  }
}

/**
 * Split a raw filter query into per-pane SOURCE strings on TOP-LEVEL commas, preserving the raw
 * text of each pane (so panes stay re-parseable). A `\` escapes the next char, and commas inside
 * balanced `()` never split. Empty/whitespace-only panes are dropped; the result is always ≥ 1
 * (an all-empty input yields `['']`).
 */
export function splitPanesRaw(query: string): string[] {
  const panes: string[] = []
  let current = ''
  let depth = 0
  for (let i = 0; i < query.length; i += 1) {
    const ch = query.charAt(i)
    if (ch === '\\') {
      current += ch
      if (i + 1 < query.length) {
        current += query.charAt(i + 1)
        i += 1
      }
      continue
    }
    if (ch === '(') {
      depth += 1
      current += ch
    } else if (ch === ')') {
      if (depth > 0) depth -= 1
      current += ch
    } else if (ch === ',' && depth === 0) {
      panes.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  panes.push(current)
  const trimmed = panes.map((p) => p.trim()).filter((p) => p.length > 0)
  return trimmed.length > 0 ? trimmed : ['']
}
