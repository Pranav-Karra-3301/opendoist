import { styleText } from 'node:util'
import type { Priority } from '@opentask/core'
import Table from 'cli-table3'
import type { FilterDto, LabelDto, ProjectDto, SectionDto, TaskDto } from './api'
import type { FmtOpts } from './context'

export interface TaskTableOpts {
  showProject?: boolean
  projectNames?: ReadonlyMap<string, string>
}

// Semantic terminal styles resolved to node:util styleText names (never hex — that is web-only).
type StyleName = 'red' | 'green' | 'yellow' | 'blue' | 'gray' | 'dim' | 'bold'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const PRIORITY_STYLE: Record<Priority, StyleName> = { 1: 'red', 2: 'yellow', 3: 'blue', 4: 'gray' }

/** Applies a terminal style only when color is enabled; `validateStream:false` forces the codes
 *  regardless of the current stream/NO_COLOR because `fmt.color` is already the single gate. */
function paint(fmt: FmtOpts, style: StyleName, text: string): string {
  return fmt.color ? styleText(style, text, { validateStream: false }) : text
}

function parseYmd(date: string): { y: number; m: number; d: number } {
  const [y = 1970, m = 1, d = 1] = date.split('-').map(Number)
  return { y, m, d }
}

/** Whole-day difference (`to - from`) between two `YYYY-MM-DD` calendar dates, timezone-agnostic. */
function daysBetween(from: string, to: string): number {
  const a = parseYmd(from)
  const b = parseYmd(to)
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000)
}

function weekdayName(date: string): string {
  const { y, m, d } = parseYmd(date)
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? ''
}

function monthDay(date: string, refYear: number): string {
  const { y, m, d } = parseYmd(date)
  const label = `${MONTHS[m - 1] ?? ''} ${d}`
  return y === refYear ? label : `${label} ${y}`
}

export function jsonOut(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

/** `today` / `tomorrow` / weekday (within the next 6 days) / `Mon D` (`Mon D YYYY` across years). */
export function relativeDate(date: string, today: string): string {
  if (date === today) return 'today'
  const diff = daysBetween(today, date)
  if (diff === 1) return 'tomorrow'
  if (diff >= 2 && diff <= 6) return weekdayName(date)
  return monthDay(date, parseYmd(today).y)
}

export function priorityLabel(priority: Priority, fmt: FmtOpts): string {
  return paint(fmt, PRIORITY_STYLE[priority], `p${priority}`)
}

/** overdue → red · today → green · tomorrow → yellow · within a week → blue · later → gray. */
function dueStyle(dueDate: string, today: string): StyleName {
  if (dueDate < today) return 'red'
  if (dueDate === today) return 'green'
  const diff = daysBetween(today, dueDate)
  if (diff === 1) return 'yellow'
  if (diff <= 7) return 'blue'
  return 'gray'
}

export function dueLabel(task: TaskDto, fmt: FmtOpts): string {
  if (task.due === null) return ''
  const { date, time, is_recurring } = task.due
  const text =
    time === null ? relativeDate(date, fmt.today) : `${relativeDate(date, fmt.today)} ${time}`
  const colored = paint(fmt, dueStyle(date, fmt.today), text)
  return is_recurring ? `${colored} ${paint(fmt, 'dim', '(recurring)')}` : colored
}

/** `{Mon D}` deadline chip (`{Mon D HH:mm}` when timed), red when the deadline is today or past. */
function deadlineChip(deadlineDate: string, deadlineTime: string | null, fmt: FmtOpts): string {
  const label = monthDay(deadlineDate, parseYmd(fmt.today).y)
  const chip = deadlineTime === null ? `{${label}}` : `{${label} ${deadlineTime}}`
  return deadlineDate <= fmt.today ? paint(fmt, 'red', chip) : chip
}

function checkbox(priority: Priority, fmt: FmtOpts): string {
  return paint(fmt, PRIORITY_STYLE[priority], '○')
}

/** The task body without the id column: `○ content [meta…]` (priority · due · deadline · labels). */
function taskBody(task: TaskDto, fmt: FmtOpts): string {
  const meta: string[] = []
  if (task.priority !== 4) meta.push(priorityLabel(task.priority, fmt))
  if (task.due !== null) meta.push(dueLabel(task, fmt))
  if (task.deadline_date !== null)
    meta.push(deadlineChip(task.deadline_date, task.deadline_time ?? null, fmt))
  for (const name of task.labels) meta.push(`@${name}`)
  const suffix = meta.length > 0 ? ` ${meta.join(' ')}` : ''
  return `${checkbox(task.priority, fmt)} ${task.content}${suffix}`
}

export function taskLine(task: TaskDto, fmt: FmtOpts): string {
  return `${paint(fmt, 'dim', task.id)} ${taskBody(task, fmt)}`
}

export function groupHeader(text: string, fmt: FmtOpts): string {
  return paint(fmt, 'bold', text)
}

// Borderless preset: no rules, columns separated by two spaces — reads like a task view, not a grid.
const BORDERLESS_CHARS = {
  top: '',
  'top-mid': '',
  'top-left': '',
  'top-right': '',
  bottom: '',
  'bottom-mid': '',
  'bottom-left': '',
  'bottom-right': '',
  left: '',
  'left-mid': '',
  mid: '',
  'mid-mid': '',
  right: '',
  'right-mid': '',
  middle: '  ',
}

function newTable(): InstanceType<typeof Table> {
  return new Table({
    chars: BORDERLESS_CHARS,
    style: { head: [], border: [], 'padding-left': 0, 'padding-right': 0 },
  })
}

/** cli-table3 right-pads the final column; strip that so no emitted line has trailing whitespace. */
function render(table: InstanceType<typeof Table>): string {
  return table
    .toString()
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
}

export function taskTable(tasks: TaskDto[], fmt: FmtOpts, opts: TaskTableOpts = {}): string {
  if (tasks.length === 0) return ''
  const showProject = opts.showProject === true && opts.projectNames !== undefined
  const table = newTable()
  for (const task of tasks) {
    const row = [paint(fmt, 'dim', task.id), taskBody(task, fmt)]
    if (showProject) {
      const name = opts.projectNames?.get(task.project_id) ?? task.project_id
      row.push(paint(fmt, 'dim', `#${name}`))
    }
    table.push(row)
  }
  return render(table)
}

export function projectTable(projects: ProjectDto[], fmt: FmtOpts): string {
  if (projects.length === 0) return ''
  const ids = new Set(projects.map((p) => p.id))
  const byParent = new Map<string | null, ProjectDto[]>()
  for (const p of projects) {
    // Orphans (parent archived/absent) render as roots so nothing is dropped.
    const key = p.parent_id !== null && ids.has(p.parent_id) ? p.parent_id : null
    const siblings = byParent.get(key) ?? []
    siblings.push(p)
    byParent.set(key, siblings)
  }
  for (const [key, siblings] of byParent) {
    siblings.sort((a, b) => {
      if (key === null && a.is_inbox !== b.is_inbox) return a.is_inbox ? -1 : 1
      return a.child_order - b.child_order
    })
  }
  const table = newTable()
  const walk = (parentKey: string | null, depth: number): void => {
    for (const p of byParent.get(parentKey) ?? []) {
      const markers: string[] = []
      if (p.is_inbox) markers.push('(inbox)')
      if (p.is_favorite) markers.push('★')
      const name = `${'  '.repeat(depth)}${p.name}${markers.length > 0 ? ` ${markers.join(' ')}` : ''}`
      table.push([name, paint(fmt, 'dim', p.id), p.color])
      walk(p.id, depth + 1)
    }
  }
  walk(null, 0)
  return render(table)
}

export function sectionTable(
  sections: SectionDto[],
  projectNames: ReadonlyMap<string, string>,
  fmt: FmtOpts,
): string {
  if (sections.length === 0) return ''
  const sorted = [...sections].sort((a, b) =>
    a.project_id === b.project_id
      ? a.section_order - b.section_order
      : a.project_id < b.project_id
        ? -1
        : 1,
  )
  const table = newTable()
  for (const s of sorted) {
    const projectName = projectNames.get(s.project_id) ?? s.project_id
    table.push([s.name, paint(fmt, 'dim', s.id), paint(fmt, 'dim', `#${projectName}`)])
  }
  return render(table)
}

export function labelTable(labels: LabelDto[], fmt: FmtOpts): string {
  if (labels.length === 0) return ''
  const sorted = [...labels].sort((a, b) => a.item_order - b.item_order)
  const table = newTable()
  for (const l of sorted) {
    const name = `@${l.name}${l.is_favorite ? ' ★' : ''}`
    table.push([name, paint(fmt, 'dim', l.id), l.color])
  }
  return render(table)
}

export function filterTable(filters: FilterDto[], fmt: FmtOpts): string {
  if (filters.length === 0) return ''
  const sorted = [...filters].sort((a, b) => a.item_order - b.item_order)
  const table = newTable()
  for (const f of sorted) {
    const name = `${f.name}${f.is_favorite ? ' ★' : ''}`
    table.push([name, paint(fmt, 'dim', f.id), f.query])
  }
  return render(table)
}
