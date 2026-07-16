import { addDaysIso, dateInTz, diffDays, lastDayOfMonth, timeInTz } from '../dates'
import { resolveNaturalDate } from '../nl-date'
import type {
  FilterContext,
  FilterExpr,
  FilterPredicate,
  FilterQuery,
  FilterTaskView,
  ParseContext,
} from '../types'

interface ResolvedRef {
  date: string
  time: string | null
}

interface EvalState {
  ctx: FilterContext
  today: string
  /** wall-clock HH:mm of ctx.now in ctx.timezone */
  nowTime: string
  refCache: Map<string, ResolvedRef | null>
}

function stateFor(ctx: FilterContext): EvalState {
  return {
    ctx,
    today: dateInTz(ctx.now, ctx.timezone),
    nowTime: timeInTz(ctx.now, ctx.timezone),
    refCache: new Map(),
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** signed relative refs Todoist allows in comparisons, e.g. `created before: -365 days` */
const RELATIVE_REF_RE = /^([+-])\s*(\d+)\s*(days?|d|weeks?|w|months?|mo|years?|y)$/i

function resolveRelative(ref: string, today: string): ResolvedRef | null {
  const m = RELATIVE_REF_RE.exec(ref)
  if (!m) return null
  const n = (m[1] === '-' ? -1 : 1) * Number(m[2])
  const unit = (m[3] ?? '').toLowerCase()
  if (unit.startsWith('d')) return { date: addDaysIso(today, n), time: null }
  if (unit.startsWith('w')) return { date: addDaysIso(today, n * 7), time: null }
  const [y, mo, day] = today.split('-').map(Number)
  const months = unit.startsWith('y') ? n * 12 : n
  const total = (y ?? 0) * 12 + (mo ?? 1) - 1 + months
  const ty = Math.floor(total / 12)
  const tm = (total % 12) + 1
  const td = Math.min(day ?? 1, lastDayOfMonth(ty, tm))
  return { date: `${ty}-${pad(tm)}-${pad(td)}`, time: null }
}

/** resolve a raw date ref ('saturday', 'jan 3', '-365 days') at eval time; null = no match */
function resolveRef(ref: string, state: EvalState): ResolvedRef | null {
  const cached = state.refCache.get(ref)
  if (cached !== undefined) return cached
  const parseCtx: ParseContext = {
    now: state.ctx.now,
    timezone: state.ctx.timezone,
    weekStart: state.ctx.weekStart,
    nextWeekDay: state.ctx.nextWeekDay,
    weekendDay: state.ctx.weekendDay,
    smartDate: true,
  }
  const trimmed = ref.trim()
  const resolved = resolveRelative(trimmed, state.today) ?? resolveNaturalDate(trimmed, parseCtx)
  state.refCache.set(ref, resolved)
  return resolved
}

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** `*` matches any run of chars; everything else is literal (case-insensitive) */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${escaped}$`, 'i')
}

/** true when the task's project, or any of its ancestors, is named `name` (##Project) */
function inProjectTree(task: FilterTaskView, name: string, ctx: FilterContext): boolean {
  if (eq(task.projectName, name)) return true
  const seen = new Set<string>()
  let id: string | null = task.projectId
  while (id !== null && !seen.has(id)) {
    seen.add(id)
    const node = ctx.projects.get(id)
    if (!node) return false
    if (eq(node.name, name)) return true
    id = node.parentId
  }
  return false
}

/**
 * Date semantics:
 * - date-only refs compare calendar dates; refs with a time compare (date, time) tuples,
 *   where an all-day task counts as the start of its day (00:00)
 * - `dateWithin N` = due in [today, today + N - 1]
 * - `overdue` = due before today, or due today with a time strictly before now
 */
function evalPredicate(pred: FilterPredicate, task: FilterTaskView, state: EvalState): boolean {
  const { today, nowTime, ctx } = state
  switch (pred.t) {
    case 'today':
      return task.dueDate === today
    case 'tomorrow':
      return task.dueDate === addDaysIso(today, 1)
    case 'yesterday':
      return task.dueDate === addDaysIso(today, -1)
    case 'overdue': {
      if (task.dueDate === null) return false
      if (task.dueDate < today) return true
      return task.dueDate === today && task.dueTime !== null && task.dueTime < nowTime
    }
    case 'noDate':
      return task.dueDate === null
    case 'noTime':
      return task.dueDate !== null && task.dueTime === null
    case 'recurring':
      return task.isRecurring
    case 'noDeadline':
      return task.deadline === null
    case 'noLabels':
      return task.labels.length === 0
    case 'noPriority':
      return task.priority === 4
    case 'subtask':
      return task.parentId !== null
    case 'uncompletable':
      return task.uncompletable
    case 'viewAll':
      return true
    case 'noSection':
      return task.sectionName === null
    case 'dateWithin': {
      if (task.dueDate === null) return false
      const diff = diffDays(today, task.dueDate)
      return diff >= 0 && diff < pred.days
    }
    case 'dateOn':
    case 'dateBefore':
    case 'dateAfter': {
      if (task.dueDate === null) return false
      const ref = resolveRef(pred.ref, state)
      if (!ref) return false
      if (pred.t === 'dateOn') {
        return ref.time === null
          ? task.dueDate === ref.date
          : task.dueDate === ref.date && task.dueTime === ref.time
      }
      const time = task.dueTime ?? '00:00'
      if (pred.t === 'dateBefore') {
        return ref.time === null
          ? task.dueDate < ref.date
          : task.dueDate < ref.date || (task.dueDate === ref.date && time < ref.time)
      }
      return ref.time === null
        ? task.dueDate > ref.date
        : task.dueDate > ref.date || (task.dueDate === ref.date && time > ref.time)
    }
    case 'deadlineOn':
    case 'deadlineBefore':
    case 'deadlineAfter': {
      if (task.deadline === null) return false
      const ref = resolveRef(pred.ref, state)
      if (!ref) return false
      if (pred.t === 'deadlineOn') return task.deadline === ref.date
      return pred.t === 'deadlineBefore' ? task.deadline < ref.date : task.deadline > ref.date
    }
    case 'createdOn':
    case 'createdBefore':
    case 'createdAfter': {
      const ref = resolveRef(pred.ref, state)
      if (!ref) return false
      const created = dateInTz(task.createdAt, ctx.timezone)
      if (pred.t === 'createdOn') return created === ref.date
      return pred.t === 'createdBefore' ? created < ref.date : created > ref.date
    }
    case 'priority':
      return task.priority === pred.value
    case 'label': {
      if (pred.wildcard) {
        const re = globToRegExp(pred.name)
        return task.labels.some((label) => re.test(label))
      }
      return task.labels.some((label) => eq(label, pred.name))
    }
    case 'project':
      return pred.withDescendants
        ? inProjectTree(task, pred.name, ctx)
        : eq(task.projectName, pred.name)
    case 'section': {
      if (task.sectionName === null) return false
      return pred.name === '*' || eq(task.sectionName, pred.name)
    }
    case 'search': {
      const needle = pred.text.toLowerCase()
      return (
        task.content.toLowerCase().includes(needle) ||
        task.description.toLowerCase().includes(needle)
      )
    }
  }
}

function evalExpr(expr: FilterExpr, task: FilterTaskView, state: EvalState): boolean {
  switch (expr.t) {
    case 'and':
      return expr.children.every((child) => evalExpr(child, task, state))
    case 'or':
      return expr.children.some((child) => evalExpr(child, task, state))
    case 'not':
      return !evalExpr(expr.child, task, state)
    default:
      return evalPredicate(expr, task, state)
  }
}

/** Evaluate one pane expression against a single task. */
export function evaluateFilter(
  expr: FilterExpr,
  task: FilterTaskView,
  ctx: FilterContext,
): boolean {
  return evalExpr(expr, task, stateFor(ctx))
}

/** Run every pane of a query over `tasks`; returns one (input-ordered) array per pane. */
export function filterTasks(
  query: FilterQuery,
  tasks: FilterTaskView[],
  ctx: FilterContext,
): FilterTaskView[][] {
  const state = stateFor(ctx)
  return query.panes.map((pane) => tasks.filter((task) => evalExpr(pane, task, state)))
}
