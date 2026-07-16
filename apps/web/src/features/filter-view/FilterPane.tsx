/**
 * Filter/label view internals — phase 5 Task G.
 *
 * `useFilterViewData` is the shared client-side data source for BOTH the filter view
 * (comma panes) and the label view. It reads the phase-4 caches (active tasks, projects,
 * sections) and projects each task into core's `FilterTaskView` (the filter-engine input)
 * while also handing back a `taskById` map so filtered results render through the phase-4
 * `TaskList`/`TaskRow` — identical checkbox / priority / undo behaviour.
 *
 * NOTE for the Task X integrator: plan Task G lists Task E's `useAllTasks` (dialogs file) as
 * the tasks+ctx source. `useFilterViewData` intentionally supersedes it here because the view
 * ALSO needs the raw `Task` DTOs to render rows (which `useAllTasks` does not return). It builds
 * the identical `FilterTaskView[]` + `FilterContext` from the same server settings, so pane
 * counts match the filter dialog's live preview. No cross-file wiring is required; if desired,
 * the tasks+ctx half of this hook could later delegate to `useAllTasks`.
 *
 * `FilterPane` renders ONE pane: it runs the per-view Display prefs pipeline
 * (`applyViewFilter → sortTasks → groupTasks`, all from core) and renders each group with a
 * sticky header via `TaskList`.
 */
import {
  applyViewFilter,
  type FilterContext,
  type FilterTaskView,
  groupTasks,
  sortTasks,
  type ViewPrefs,
} from '@opendoist/core'
import { useProjects } from '@/api/hooks/projects'
import { useSections } from '@/api/hooks/sections'
import { useActiveTasks } from '@/api/hooks/tasks'
import type { Task } from '@/api/schemas'
import { TaskList } from '@/components/task/task-list'
import { Skeleton } from '@/components/ui/skeleton'
import { toFilterTaskView } from '@/lib/api/phase5'
import { activeTasks } from '@/lib/derive'
import { useParseCtx } from '@/lib/parse-context'
import { cn } from '@/lib/utils'

export interface FilterViewData {
  isLoading: boolean
  /** every active task projected to core `FilterTaskView` (filter-engine input) */
  tasks: FilterTaskView[]
  /** filter-engine context: now / timezone / week rules + the project tree for `##Project` */
  ctx: FilterContext
  /** id → phase-4 `Task` DTO, for rendering filtered results through `TaskList` */
  taskById: Map<string, Task>
}

/** Client-side data for the filter/label views (see file header). */
export function useFilterViewData(): FilterViewData {
  const tasksQ = useActiveTasks()
  const projectsQ = useProjects()
  const sectionsQ = useSections()
  const parseCtx = useParseCtx()

  const projects = projectsQ.data ?? []
  const sections = sectionsQ.data ?? []
  const rawTasks = tasksQ.data ?? []

  const projectMap = new Map(projects.map((p) => [p.id, { name: p.name, parentId: p.parent_id }]))
  const sectionNames = new Map(sections.map((s) => [s.id, s.name]))

  const active = activeTasks(rawTasks)
  const tasks = active.map((t) => toFilterTaskView(t, projectMap, sectionNames))
  const taskById = new Map(active.map((t) => [t.id, t]))

  const ctx: FilterContext = {
    now: parseCtx.now,
    timezone: parseCtx.timezone,
    weekStart: parseCtx.weekStart,
    nextWeekDay: parseCtx.nextWeekDay,
    weekendDay: parseCtx.weekendDay,
    projects: projectMap,
  }

  return {
    isLoading: tasksQ.isPending || projectsQ.isPending || sectionsQ.isPending,
    tasks,
    ctx,
    taskById,
  }
}

/** Case-insensitive label membership — the label view's task predicate. Pure/unit-tested. */
export function labelViewTasks(tasks: FilterTaskView[], labelName: string): FilterTaskView[] {
  const needle = labelName.toLowerCase()
  return tasks.filter((t) => t.labels.some((label) => label.toLowerCase() === needle))
}

/**
 * Map a group's `FilterTaskView`s back to phase-4 `Task` DTOs for rendering, dropping any id
 * that has since left the cache. Preserves the (already sorted) input order. Pure/unit-tested.
 */
export function pickDtos(
  views: readonly FilterTaskView[],
  byId: ReadonlyMap<string, Task>,
): Task[] {
  const out: Task[] = []
  for (const view of views) {
    const dto = byId.get(view.id)
    if (dto !== undefined) out.push(dto)
  }
  return out
}

export interface FilterPaneProps {
  /** tasks matching this pane's filter expression (before the Display prefs pipeline) */
  tasks: FilterTaskView[]
  prefs: ViewPrefs
  ctx: FilterContext
  taskById: ReadonlyMap<string, Task>
  /** unique, stable prefix for this pane's `TaskList` selection group ids */
  paneKey: string
  /** raw sub-query — rendered as the pane header in multi-pane filter views; omit for single */
  subQuery?: string
  className?: string
  emptyText?: string
}

/**
 * One filter pane: applies the view's Display prefs (`applyViewFilter → sortTasks →
 * groupTasks`) and renders each resulting group with a sticky header. In a multi-pane filter
 * view the pane also renders a sticky header showing its raw sub-query + the displayed count.
 */
export function FilterPane({
  tasks,
  prefs,
  ctx,
  taskById,
  paneKey,
  subQuery,
  className,
  emptyText,
}: FilterPaneProps) {
  const filtered = applyViewFilter(tasks, prefs.filterBy, ctx)
  const sorted = sortTasks(filtered, prefs.sortBy, prefs.sortDir, ctx)
  const groups = groupTasks(sorted, prefs.groupBy, ctx)
  const count = sorted.length
  const empty = emptyText ?? 'No matching tasks'
  // Offset group headers below the pane header when one is present so both stay legible.
  const groupTop = subQuery === undefined ? 'top-0' : 'top-9'

  return (
    <section data-testid="filter-pane" className={cn('min-w-0', className)}>
      {subQuery !== undefined && (
        <header className="sticky top-0 z-20 flex items-baseline gap-2 border-border-subtle border-b bg-bg py-2">
          <span className="min-w-0 truncate text-copy text-text-secondary">{subQuery}</span>
          <span className="shrink-0 text-caption text-text-tertiary tabular-nums">{count}</span>
        </header>
      )}
      {count === 0 ? (
        <p className="py-4 text-copy text-text-tertiary italic">{empty}</p>
      ) : (
        groups.map((group) => (
          <div key={group.key}>
            {group.label !== '' && (
              <h3
                className={cn(
                  'sticky z-[5] border-border-subtle border-b bg-bg py-2 font-medium text-copy text-text-secondary',
                  groupTop,
                )}
              >
                {group.label}
              </h3>
            )}
            <TaskList
              tasks={pickDtos(group.tasks, taskById)}
              groupId={`${paneKey}:${group.key}`}
              showProject
              emptyText={empty}
            />
          </div>
        ))
      )}
    </section>
  )
}

/** Skeleton shown while the view's caches load (mirrors the project view's loading state). */
export function ViewLoading() {
  return (
    <div className="mx-auto max-w-[var(--content-max)] px-6">
      <div className="flex items-center gap-2 pt-8 pb-4">
        <Skeleton className="size-5 rounded-full" />
        <Skeleton className="h-6 w-40" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-[42px] w-full" />
        <Skeleton className="h-[42px] w-full" />
        <Skeleton className="h-[42px] w-full" />
      </div>
    </div>
  )
}

/** Centered card for a missing/deleted filter or label. */
export function MissingCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-[var(--content-max)] px-6">
      <div className="mt-16 rounded-lg border border-border bg-surface-raised p-6 text-center">
        <h2 className="font-medium text-subtitle text-text-primary">{title}</h2>
        <p className="mt-1 text-copy text-text-secondary">{body}</p>
      </div>
    </div>
  )
}
