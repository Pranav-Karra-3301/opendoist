/**
 * Filter view (`/filter/$filterId`) — phase 5 Task G.
 *
 * Loads the saved filter, parses its query with core's `parseFilter`, and renders one list
 * per comma-separated pane. A single pane is a normal centered column; multiple panes become a
 * horizontally scrolling row of side-by-side panes (each sized `min-w-[320px] max-w-[content]
 * flex-1`). Every pane shares ONE Display menu (`viewKey('filter', id)`) and runs the same
 * `applyViewFilter → sortTasks → groupTasks` pipeline. A syntax error renders an inline card
 * with a caret at the error position and an "Edit filter" button that opens the filter dialog.
 *
 * Data comes from the shared phase-4 caches via `useFilterViewData` (see `FilterPane.tsx`), so
 * the view re-renders live on SSE-driven `['tasks']`/`['projects']` invalidation with no extra
 * wiring.
 */

import {
  type FilterQuery,
  FilterSyntaxError,
  filterTasks,
  parseFilter,
  splitPanesRaw,
  viewKey,
} from '@opendoist/core'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { ListFilter } from 'lucide-react'
import type { ReactNode } from 'react'
import { z } from 'zod'
import { apiAllPages } from '@/api/client'
import { EmptyState, ODErrorBoundary } from '@/components/feedback'
import { Button } from '@/components/ui/button'
import { ViewHeader } from '@/components/view-header'
import { useDialogStore } from '@/features/dialogs/store'
import DisplayMenu from '@/features/display/DisplayMenu'
import { useViewPrefs } from '@/features/display/useViewPrefs'
import { cn } from '@/lib/utils'
import { FilterPane, MissingCard, useFilterViewData, ViewLoading } from './FilterPane'

/** Subset of phase-3's `FilterDto` the view consumes (extra fields are stripped by zod). */
const FilterSchema = z.object({
  id: z.string(),
  name: z.string(),
  query: z.string(),
  color: z.string(),
  item_order: z.number().int(),
  is_favorite: z.boolean(),
})
type Filter = z.infer<typeof FilterSchema>

/** Shares the `['filters']` cache with Task D's sidebar/list; both fetch `GET /filters`. */
function useFilter(filterId: string | undefined): {
  filter: Filter | undefined
  isLoading: boolean
} {
  const query = useQuery({
    queryKey: ['filters'],
    queryFn: () => apiAllPages('/filters', FilterSchema),
  })
  return {
    filter: query.data?.find((f) => f.id === filterId),
    isLoading: query.isPending,
  }
}

function taskCountLabel(n: number): string {
  return `${n} ${n === 1 ? 'task' : 'tasks'}`
}

function FilterErrorCard({
  filter,
  error,
  actions,
  onEdit,
}: {
  filter: Filter
  error: FilterSyntaxError
  actions: ReactNode
  onEdit: () => void
}) {
  const caret = `${filter.query}\n${' '.repeat(Math.max(0, error.position))}^`
  return (
    <div className="mx-auto max-w-[var(--content-max)] px-6 pb-24">
      <ViewHeader title={filter.name} actions={actions} />
      <div role="alert" className="rounded-lg border border-border bg-surface-raised p-6">
        <h2 className="font-medium text-subtitle text-text-primary">
          This filter has a syntax error
        </h2>
        <p className="mt-1 text-copy text-danger">
          {error.message} (position {error.position}).
        </p>
        <pre className="mt-3 overflow-x-auto whitespace-pre rounded-md bg-bg p-3 font-mono text-copy text-text-secondary">
          <code>{caret}</code>
        </pre>
        <Button className="mt-4" onClick={onEdit}>
          Edit filter
        </Button>
      </div>
    </div>
  )
}

export default function FilterViewPage() {
  return (
    <ODErrorBoundary label="Filter">
      <FilterViewPageInner />
    </ODErrorBoundary>
  )
}

function FilterViewPageInner() {
  const { filterId } = useParams({ strict: false })
  const openDialog = useDialogStore((s) => s.openDialog)
  const key = viewKey('filter', filterId ?? '')
  const { prefs } = useViewPrefs(key)
  const { filter, isLoading: filterLoading } = useFilter(filterId)
  const data = useFilterViewData()

  if (filterLoading || data.isLoading) return <ViewLoading />
  if (filter === undefined) {
    return <MissingCard title="Filter not found" body="This filter may have been deleted." />
  }

  const displayMenu = <DisplayMenu viewKey={key} />

  let parsed: FilterQuery
  try {
    parsed = parseFilter(filter.query)
  } catch (error) {
    if (error instanceof FilterSyntaxError) {
      return (
        <FilterErrorCard
          filter={filter}
          error={error}
          actions={displayMenu}
          onEdit={() => openDialog({ kind: 'filter', mode: 'edit', filterId: filter.id })}
        />
      )
    }
    throw error
  }

  const panes = filterTasks(parsed, data.tasks, data.ctx)
  const rawPanes = splitPanesRaw(filter.query)
  const multi = panes.length > 1
  const subtitle = multi ? `${panes.length} panes` : taskCountLabel((panes[0] ?? []).length)
  // Precompute stable per-pane keys so the JSX `key` never references the map index.
  const paneModels = panes.map((tasks, i) => ({
    tasks,
    raw: (rawPanes[i] ?? '').trim(),
    paneKey: `filter:${filter.id}:${i}`,
  }))

  return (
    <div className="px-6 pb-24">
      <div className={cn(!multi && 'mx-auto max-w-[var(--content-max)]')}>
        <ViewHeader title={filter.name} subtitle={subtitle} actions={displayMenu} />
      </div>
      {multi ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {paneModels.map((pane) => (
            <FilterPane
              key={pane.paneKey}
              className="min-w-[320px] max-w-[var(--content-max)] flex-1"
              tasks={pane.tasks}
              subQuery={pane.raw}
              paneKey={pane.paneKey}
              prefs={prefs}
              ctx={data.ctx}
              taskById={data.taskById}
              emptyText="No matching tasks in this pane."
              emptyState={
                <EmptyState
                  icon={ListFilter}
                  title="No tasks match this filter"
                  description={pane.raw}
                />
              }
            />
          ))}
        </div>
      ) : (
        <div className="mx-auto max-w-[var(--content-max)]">
          <FilterPane
            tasks={panes[0] ?? []}
            paneKey={`filter:${filter.id}:0`}
            prefs={prefs}
            ctx={data.ctx}
            taskById={data.taskById}
            emptyText="No tasks match this filter."
            emptyState={
              <EmptyState
                icon={ListFilter}
                title="No tasks match this filter"
                description={filter.query}
              />
            }
          />
        </div>
      )}
    </div>
  )
}
