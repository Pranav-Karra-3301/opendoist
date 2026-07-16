/**
 * Per-view Display menu (Task H) — a toolbar popover that reads/writes the view's `ViewPrefs`
 * through the frozen `useViewPrefs` (optimistic, persisted server-side per `viewKey`). Group /
 * sort / filter / show-completed all write immediately; a "Reset to default" ghost button and a
 * trigger dot (shown while prefs differ from defaults) round it out.
 *
 * This file also exports the two view-facing helpers Task H's edited views consume:
 * `useFilterContext()` (builds core's `FilterContext` from settings + the projects cache) and
 * `<GroupedTaskList>` (renders `pipelineGroups` output with sticky group headers). Keeping them
 * here avoids adding files under `components/ui/` and keeps the display feature's surface in one
 * place; the pure mapping lives in `./pipeline` (unit-tested).
 */
import {
  DEFAULT_VIEW_PREFS,
  type Priority,
  type ViewGroupBy,
  type ViewSortBy,
} from '@opendoist/core'
import { ArrowDownWideNarrow, ArrowUpNarrowWide, SlidersHorizontal } from 'lucide-react'
import { type ReactNode, useMemo } from 'react'
import { useLabels } from '@/api/hooks/labels'
import { useProjects } from '@/api/hooks/projects'
import { TaskList } from '@/components/task/task-list'
import { buttonVariants } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useParseCtx } from '@/lib/parse-context'
import { cn } from '@/lib/utils'
import { buildFilterContext, type ProjectsMap, prefsAreDefault, type RenderGroup } from './pipeline'
import { useViewPrefs } from './useViewPrefs'

/** Live core `FilterContext` from the user's settings + the projects cache (for the pipeline). */
export function useFilterContext() {
  const parse = useParseCtx()
  const projects = useProjects().data
  const map = useMemo<ProjectsMap>(() => {
    const m = new Map<string, { name: string; parentId: string | null }>()
    for (const p of projects ?? []) m.set(p.id, { name: p.name, parentId: p.parent_id })
    return m
  }, [projects])
  return useMemo(() => buildFilterContext(parse, map), [parse, map])
}

/** Render `pipelineGroups` output: a sticky header per named group, phase-4 `TaskList` per slice. */
export function GroupedTaskList({
  groups,
  showProject,
  emptyText,
}: {
  groups: RenderGroup[]
  showProject?: boolean
  emptyText?: string
}) {
  const total = groups.reduce((n, g) => n + g.tasks.length, 0)
  if (total === 0) {
    return <p className="py-2 text-copy text-text-tertiary italic">{emptyText ?? 'No tasks'}</p>
  }
  return (
    <>
      {groups.map((g) =>
        g.tasks.length === 0 ? null : (
          <section key={g.key} aria-label={g.label || undefined} className="mb-4">
            {g.label !== '' && (
              <h3 className="-mx-6 sticky top-0 z-[var(--z-sticky)] bg-bg px-6 py-1.5 font-medium text-caption text-text-secondary">
                {g.label}
              </h3>
            )}
            <TaskList tasks={g.tasks} groupId={`grp-${g.key}`} showProject={showProject} />
          </section>
        ),
      )}
    </>
  )
}

const GROUP_ITEMS: Record<string, string> = {
  none: 'None',
  project: 'Project',
  priority: 'Priority',
  label: 'Label',
  date: 'Date',
}
const SORT_ITEMS: Record<string, string> = {
  manual: 'Manual',
  date: 'Date',
  added: 'Date added',
  priority: 'Priority',
  alphabetical: 'Alphabetical',
}
const PRIORITY_ITEMS: Record<string, string> = {
  any: 'Any',
  '1': 'Priority 1',
  '2': 'Priority 2',
  '3': 'Priority 3',
  '4': 'Priority 4',
}
const DUE_ITEMS: Record<string, string> = {
  any: 'Any',
  'has-date': 'Has date',
  'no-date': 'No date',
  overdue: 'Overdue',
}
/** Sentinel for the "no label filter" option; distinct from any real (non-empty) label name. */
const ANY_LABEL = '__all__'

function MenuRow({ label, control }: { label: string; control: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-copy text-text-secondary">{label}</span>
      {control}
    </div>
  )
}

export default function DisplayMenu({
  viewKey,
  showCompletedAvailable = true,
}: {
  viewKey: string
  showCompletedAvailable?: boolean
}) {
  const { prefs, setPrefs } = useViewPrefs(viewKey)
  const labels = useLabels().data ?? []
  const customized = !prefsAreDefault(prefs)

  const labelItems = useMemo<Record<string, string>>(() => {
    const items: Record<string, string> = { [ANY_LABEL]: 'Any label' }
    for (const l of labels) items[l.name] = l.name
    return items
  }, [labels])

  return (
    <Popover>
      <PopoverTrigger
        aria-label="Display options"
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'relative')}
      >
        <SlidersHorizontal size={20} strokeWidth={1.75} aria-hidden />
        {customized && (
          <span
            aria-hidden
            className="absolute top-1 right-1 size-1.5 rounded-full bg-accent"
            data-testid="display-dot"
          />
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex flex-col">
          <MenuRow
            label="Group by"
            control={
              <Select
                items={GROUP_ITEMS}
                value={prefs.groupBy}
                onValueChange={(v) => {
                  if (v) setPrefs({ groupBy: v as ViewGroupBy })
                }}
              >
                <SelectTrigger className="w-44" aria-label="Group by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(GROUP_ITEMS).map((k) => (
                    <SelectItem key={k} value={k}>
                      {GROUP_ITEMS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />

          <MenuRow
            label="Sort by"
            control={
              <div className="flex items-center gap-1">
                <Select
                  items={SORT_ITEMS}
                  value={prefs.sortBy}
                  onValueChange={(v) => {
                    if (v) setPrefs({ sortBy: v as ViewSortBy })
                  }}
                >
                  <SelectTrigger className="w-36" aria-label="Sort by">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.keys(SORT_ITEMS).map((k) => (
                      <SelectItem key={k} value={k}>
                        {SORT_ITEMS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  aria-label={prefs.sortDir === 'asc' ? 'Sort ascending' : 'Sort descending'}
                  onClick={() => setPrefs({ sortDir: prefs.sortDir === 'asc' ? 'desc' : 'asc' })}
                  className={cn(buttonVariants({ variant: 'outline', size: 'icon' }))}
                >
                  {prefs.sortDir === 'asc' ? (
                    <ArrowUpNarrowWide size={16} aria-hidden />
                  ) : (
                    <ArrowDownWideNarrow size={16} aria-hidden />
                  )}
                </button>
              </div>
            }
          />

          <div className="my-2 h-px bg-border" />
          <p className="pb-1 font-medium text-caption text-text-secondary">Filter by</p>

          <MenuRow
            label="Priority"
            control={
              <Select
                items={PRIORITY_ITEMS}
                value={prefs.filterBy.priority === null ? 'any' : String(prefs.filterBy.priority)}
                onValueChange={(v) =>
                  setPrefs({
                    filterBy: {
                      ...prefs.filterBy,
                      priority: v && v !== 'any' ? (Number(v) as Priority) : null,
                    },
                  })
                }
              >
                <SelectTrigger className="w-36" aria-label="Filter by priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(PRIORITY_ITEMS).map((k) => (
                    <SelectItem key={k} value={k}>
                      {PRIORITY_ITEMS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />

          <MenuRow
            label="Label"
            control={
              <Select
                items={labelItems}
                value={prefs.filterBy.label ?? ANY_LABEL}
                onValueChange={(v) =>
                  setPrefs({
                    filterBy: { ...prefs.filterBy, label: v && v !== ANY_LABEL ? v : null },
                  })
                }
              >
                <SelectTrigger className="w-36" aria-label="Filter by label">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(labelItems).map(([val, name]) => (
                    <SelectItem key={val} value={val}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />

          <MenuRow
            label="Due"
            control={
              <Select
                items={DUE_ITEMS}
                value={prefs.filterBy.due ?? 'any'}
                onValueChange={(v) =>
                  setPrefs({
                    filterBy: {
                      ...prefs.filterBy,
                      due: v && v !== 'any' ? (v as 'has-date' | 'no-date' | 'overdue') : null,
                    },
                  })
                }
              >
                <SelectTrigger className="w-36" aria-label="Filter by due date">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(DUE_ITEMS).map((k) => (
                    <SelectItem key={k} value={k}>
                      {DUE_ITEMS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />

          {showCompletedAvailable && (
            <>
              <div className="my-2 h-px bg-border" />
              <MenuRow
                label="Show completed"
                control={
                  <Switch
                    checked={prefs.showCompleted}
                    onCheckedChange={(c) => setPrefs({ showCompleted: c })}
                    aria-label="Show completed tasks"
                  />
                }
              />
            </>
          )}

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              disabled={!customized}
              onClick={() => setPrefs(DEFAULT_VIEW_PREFS)}
              className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
            >
              Reset to default
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
