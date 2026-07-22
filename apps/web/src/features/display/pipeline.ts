/**
 * Pure display-pipeline glue (Task H). Converts a view's phase-4 `Task[]` into core
 * `FilterTaskView[]`, runs the FROZEN core view engine (applyViewFilter → sortTasks →
 * groupTasks) against a per-view `ViewPrefs`, then maps the result back to the ORIGINAL
 * `Task` objects so phase-4 `TaskList`/`TaskRow` rendering is preserved (checkbox / undo /
 * priority behaviour stays identical). No React here — `DisplayMenu.tsx` wraps these in
 * hooks/components and `pipeline.test.ts` covers the mapping. The core engine functions are
 * still Task C stubs at freeze time; this module depends only on their frozen signatures.
 */
import {
  applyViewFilter,
  DEFAULT_VIEW_PREFS,
  type FilterContext,
  type FilterTaskView,
  groupTasks,
  type ParseContext,
  sortTasks,
  type ViewPrefs,
} from '@opendoist/core'
import type { Task } from '@/api/schemas'
import { toFilterTaskView } from '@/lib/api/phase5'

/** A grouped, ordered slice of a view rendered under an optional sticky header. */
export interface RenderGroup {
  key: string
  label: string
  tasks: Task[]
}

/** project id → node, the shape core's `FilterContext.projects` requires. */
export type ProjectsMap = ReadonlyMap<string, { name: string; parentId: string | null }>

const NO_SECTIONS: ReadonlyMap<string, string> = new Map()

/** Build core's `FilterContext` from the client `ParseContext` plus a projects map. */
export function buildFilterContext(parse: ParseContext, projects: ProjectsMap): FilterContext {
  return {
    now: parse.now,
    timezone: parse.timezone,
    weekStart: parse.weekStart,
    nextWeekDay: parse.nextWeekDay,
    weekendDay: parse.weekendDay,
    projects,
  }
}

/**
 * True when prefs equal the defaults INCLUDING `showCompleted` and `layout` — drives the
 * menu-trigger dot, so switching to the Board layout counts as a customization.
 */
export function prefsAreDefault(p: ViewPrefs): boolean {
  const d = DEFAULT_VIEW_PREFS
  return (
    p.layout === d.layout &&
    p.groupBy === d.groupBy &&
    p.sortBy === d.sortBy &&
    p.sortDir === d.sortDir &&
    p.showCompleted === d.showCompleted &&
    p.filterBy.priority === d.filterBy.priority &&
    p.filterBy.label === d.filterBy.label &&
    p.filterBy.due === d.filterBy.due
  )
}

/**
 * True when the ACTIVE-list pipeline (group / sort / filter) deviates from defaults — i.e.
 * the flat grouped/sorted/filtered rendering must REPLACE phase-4's section/tree/dnd
 * rendering. `showCompleted` is intentionally excluded: it only appends a `CompletedSection`.
 */
export function pipelineDeviates(p: ViewPrefs): boolean {
  const d = DEFAULT_VIEW_PREFS
  return !(
    p.groupBy === d.groupBy &&
    p.sortBy === d.sortBy &&
    p.sortDir === d.sortDir &&
    p.filterBy.priority === d.filterBy.priority &&
    p.filterBy.label === d.filterBy.label &&
    p.filterBy.due === d.filterBy.due
  )
}

function toViews(
  tasks: readonly Task[],
  projects: ProjectsMap,
  sectionNames: ReadonlyMap<string, string>,
): FilterTaskView[] {
  return tasks.map((t) => toFilterTaskView(t, projects, sectionNames))
}

function mapBack(views: readonly FilterTaskView[], byId: ReadonlyMap<string, Task>): Task[] {
  const out: Task[] = []
  for (const v of views) {
    const t = byId.get(v.id)
    if (t !== undefined) out.push(t)
  }
  return out
}

/** filterBy → sortBy → groupBy, mapped back to `Task` groups (Inbox / Today / Project). */
export function pipelineGroups(
  tasks: readonly Task[],
  prefs: ViewPrefs,
  ctx: FilterContext,
  projects: ProjectsMap,
  sectionNames: ReadonlyMap<string, string> = NO_SECTIONS,
): RenderGroup[] {
  const byId = new Map<string, Task>(tasks.map((t): [string, Task] => [t.id, t]))
  const views = toViews(tasks, projects, sectionNames)
  const filtered = applyViewFilter(views, prefs.filterBy, ctx)
  const sorted = sortTasks(filtered, prefs.sortBy, prefs.sortDir, ctx)
  const groups = groupTasks(sorted, prefs.groupBy, ctx)
  return groups.map((g) => ({ key: g.key, label: g.label, tasks: mapBack(g.tasks, byId) }))
}

/**
 * filterBy → sortBy only (NO grouping), mapped back to a flat `Task[]`. Used per-day by the
 * Upcoming view, where the day IS the grouping (dossier §1.8 keeps date-based views inherently
 * day-grouped) so an explicit groupBy is folded into the day layout.
 */
export function pipelineSortFilter(
  tasks: readonly Task[],
  prefs: ViewPrefs,
  ctx: FilterContext,
  projects: ProjectsMap,
  sectionNames: ReadonlyMap<string, string> = NO_SECTIONS,
): Task[] {
  const byId = new Map<string, Task>(tasks.map((t): [string, Task] => [t.id, t]))
  const views = toViews(tasks, projects, sectionNames)
  const filtered = applyViewFilter(views, prefs.filterBy, ctx)
  const sorted = sortTasks(filtered, prefs.sortBy, prefs.sortDir, ctx)
  return mapBack(sorted, byId)
}
