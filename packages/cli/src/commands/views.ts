import {
  type FilterContext,
  type FilterQuery,
  FilterSyntaxError,
  type FilterTaskView,
  filterTasks,
  parseFilter,
} from '@opentask/core'
import type { Command } from 'commander'
import type { ProjectDto, TaskDto } from '../lib/api'
import {
  type CommandContext,
  coreParseContext,
  createContext,
  type FmtOpts,
  io,
  runAction,
} from '../lib/context'
import { UsageError } from '../lib/errors'
import { groupHeader, jsonOut, relativeDate, taskTable } from '../lib/format'

/**
 * Frozen ordering for every view and group:
 * due date asc (nulls last) -> due time asc (nulls last) -> priority asc (p1 first) -> child_order asc.
 */
function compareTasks(a: TaskDto, b: TaskDto): number {
  const ad = a.due?.date ?? null
  const bd = b.due?.date ?? null
  if (ad !== bd) {
    if (ad === null) return 1
    if (bd === null) return -1
    return ad < bd ? -1 : 1
  }
  const at = a.due?.time ?? null
  const bt = b.due?.time ?? null
  if (at !== bt) {
    if (at === null) return 1
    if (bt === null) return -1
    return at < bt ? -1 : 1
  }
  if (a.priority !== b.priority) return a.priority - b.priority
  return a.child_order - b.child_order
}

function sortTasks(tasks: TaskDto[]): TaskDto[] {
  return [...tasks].sort(compareTasks)
}

/** groupHeader + table, or just the header when the group is empty. */
function renderGroup(title: string, tasks: TaskDto[], fmt: FmtOpts): string {
  const table = taskTable(tasks, fmt)
  const head = groupHeader(title, fmt)
  return table === '' ? head : `${head}\n${table}`
}

/**
 * Parse a filter query and apply the CLI's restrictions. Throws UsageError (exit 1) — and, crucially,
 * BEFORE any network call — on a syntax error or an unsupported comma multi-pane query.
 */
function validateQuery(query: string): FilterQuery {
  let parsed: FilterQuery
  try {
    parsed = parseFilter(query)
  } catch (error) {
    if (error instanceof FilterSyntaxError) {
      throw new UsageError(`filter syntax error at position ${error.position}: ${error.message}`)
    }
    throw error
  }
  if (parsed.panes.length > 1) {
    throw new UsageError(
      'comma multi-pane filters are not supported in the CLI',
      'run each pane as its own command',
    )
  }
  return parsed
}

interface FilterRun {
  matched: TaskDto[]
  projects: ProjectDto[]
}

/**
 * Evaluate a single-pane filter LOCALLY over the full open-task set — there is NO server filter
 * endpoint; the web app (phase 5) evaluates client-side too, and core is bundled so behavior matches.
 * Validation runs first (no fetch on bad input); then tasks/projects/sections are fetched once each.
 */
async function runFilterDetailed(ctx: CommandContext, query: string): Promise<FilterRun> {
  const parsed = validateQuery(query)
  const [tasks, projects, sections] = await Promise.all([
    ctx.api.listTasks(),
    ctx.api.listProjects(),
    ctx.api.listSections(),
  ])
  const projectNameById = new Map(projects.map((project) => [project.id, project.name]))
  const sectionNameById = new Map(sections.map((section) => [section.id, section.name]))
  const views: FilterTaskView[] = tasks.map((task) => ({
    id: task.id,
    content: task.content,
    description: task.description,
    dueDate: task.due?.date ?? null,
    dueTime: task.due?.time ?? null,
    isRecurring: task.due?.is_recurring ?? false,
    deadline: task.deadline_date,
    priority: task.priority,
    labels: task.labels,
    projectId: task.project_id,
    projectName: projectNameById.get(task.project_id) ?? '',
    sectionName: task.section_id === null ? null : (sectionNameById.get(task.section_id) ?? null),
    parentId: task.parent_id,
    createdAt: task.created_at,
    uncompletable: task.uncompletable,
  }))
  const fctx: FilterContext = {
    ...coreParseContext(ctx),
    projects: new Map(
      projects.map((project) => [project.id, { name: project.name, parentId: project.parent_id }]),
    ),
  }
  const matchedViews = filterTasks(parsed, views, fctx)[0] ?? []
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const matched = matchedViews
    .map((view) => byId.get(view.id))
    .filter((task): task is TaskDto => task !== undefined)
  return { matched, projects }
}

function runFilter(ctx: CommandContext, query: string): Promise<TaskDto[]> {
  return runFilterDetailed(ctx, query).then((run) => run.matched)
}

/** `opentask list` — open tasks grouped by project (inbox first, then child_order). */
async function listByProject(ctx: CommandContext): Promise<void> {
  const [tasks, projects] = await Promise.all([ctx.api.listTasks(), ctx.api.listProjects()])
  if (ctx.json) {
    io.out(jsonOut(sortTasks(tasks)))
    return
  }
  const ordered = [...projects].sort((a, b) => {
    if (a.is_inbox !== b.is_inbox) return a.is_inbox ? -1 : 1
    return a.child_order - b.child_order
  })
  const byProject = new Map<string, TaskDto[]>()
  for (const task of tasks) {
    const bucket = byProject.get(task.project_id)
    if (bucket === undefined) byProject.set(task.project_id, [task])
    else bucket.push(task)
  }
  const blocks: string[] = []
  for (const project of ordered) {
    const bucket = byProject.get(project.id)
    if (bucket === undefined || bucket.length === 0) continue
    blocks.push(renderGroup(`#${project.name}`, sortTasks(bucket), ctx.fmt))
  }
  io.out(blocks.length === 0 ? 'No tasks.' : blocks.join('\n\n'))
}

/** `opentask list <query>` — one group headed by the query, project column shown. */
async function listByFilter(ctx: CommandContext, query: string): Promise<void> {
  const { matched, projects } = await runFilterDetailed(ctx, query)
  const rows = sortTasks(matched)
  if (ctx.json) {
    io.out(jsonOut(rows))
    return
  }
  const projectNames = new Map(projects.map((project) => [project.id, project.name]))
  const header = groupHeader(query, ctx.fmt)
  const body = taskTable(rows, ctx.fmt, { showProject: true, projectNames })
  io.out(body === '' ? header : `${header}\n${body}`)
}

/** `opentask today` — overdue + due-today, split on `due.date < today`. */
async function todayView(ctx: CommandContext): Promise<void> {
  const rows = sortTasks(await runFilter(ctx, 'overdue | today'))
  if (ctx.json) {
    io.out(jsonOut(rows))
    return
  }
  if (rows.length === 0) {
    io.out('No tasks due today.')
    return
  }
  const overdue = rows.filter((task) => (task.due?.date ?? '') < ctx.fmt.today)
  const dueToday = rows.filter((task) => (task.due?.date ?? '') >= ctx.fmt.today)
  const blocks: string[] = []
  if (overdue.length > 0) blocks.push(renderGroup('Overdue', overdue, ctx.fmt))
  blocks.push(renderGroup('Today', dueToday, ctx.fmt))
  io.out(blocks.join('\n\n'))
}

/** `opentask upcoming [--days n]` — overdue, then one group per calendar day within the window. */
async function upcomingView(ctx: CommandContext, daysAhead: number): Promise<void> {
  const rows = sortTasks(await runFilter(ctx, `overdue | next ${daysAhead} days`))
  if (ctx.json) {
    io.out(jsonOut(rows))
    return
  }
  if (rows.length === 0) {
    io.out('No upcoming tasks.')
    return
  }
  const overdue = rows.filter((task) => (task.due?.date ?? '') < ctx.fmt.today)
  const ahead = rows.filter((task) => (task.due?.date ?? '') >= ctx.fmt.today)
  const blocks: string[] = []
  if (overdue.length > 0) blocks.push(renderGroup('Overdue', overdue, ctx.fmt))
  const dayKeys = [...new Set(ahead.map((task) => task.due?.date ?? ''))].sort()
  for (const day of dayKeys) {
    const dayTasks = ahead.filter((task) => (task.due?.date ?? '') === day)
    blocks.push(renderGroup(`${relativeDate(day, ctx.fmt.today)} · ${day}`, dayTasks, ctx.fmt))
  }
  io.out(blocks.join('\n\n'))
}

export function registerViewCommands(program: Command): void {
  program
    .command('list [query]')
    .description('list open tasks grouped by project, or matching a filter query')
    .action(
      runAction(async (query: string | undefined, _opts: unknown, command: Command) => {
        const ctx = createContext(command)
        if (query !== undefined && query.trim() !== '') await listByFilter(ctx, query)
        else await listByProject(ctx)
      }),
    )

  program
    .command('today')
    .description('tasks that are overdue or due today')
    .action(
      runAction(async (_opts: unknown, command: Command) => {
        await todayView(createContext(command))
      }),
    )

  program
    .command('upcoming')
    .description('tasks due within the next N days (default 7), grouped by day')
    .option('--days <n>', 'days ahead to include (default 7, range 1-30)')
    .action(
      runAction(async (opts: { days?: string }, command: Command) => {
        const daysAhead = opts.days === undefined ? 7 : Number(opts.days)
        if (!Number.isInteger(daysAhead) || daysAhead < 1 || daysAhead > 30) {
          throw new UsageError('--days must be an integer between 1 and 30')
        }
        await upcomingView(createContext(command), daysAhead)
      }),
    )
}
