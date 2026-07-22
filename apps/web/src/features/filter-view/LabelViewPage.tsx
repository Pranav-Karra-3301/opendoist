/**
 * Label view (`/label/$labelId`) — phase 5 Task G.
 *
 * ID-keyed (Task A replaced phase 4's name-keyed `/label/$labelName` route so
 * `viewKey('label', id)` prefs have a stable key). Resolves the label from the `['labels']`
 * cache, lists every active task whose labels include the label's name (case-insensitive), and
 * runs the shared Display-prefs pipeline via a single `FilterPane`. The header shows the label's
 * colour dot + name and its own Display menu.
 */

import { viewKey } from '@opendoist/core'
import { useParams } from '@tanstack/react-router'
import { Tag } from 'lucide-react'
import { useLabels } from '@/api/hooks/labels'
import { EmptyState, ODErrorBoundary } from '@/components/feedback'
import { BoardView, viewsToBoardColumns } from '@/features/board/BoardView'
import { colorVar } from '@/features/dialogs/ColorPicker'
import DisplayMenu from '@/features/display/DisplayMenu'
import { useViewPrefs } from '@/features/display/useViewPrefs'
import {
  FilterPane,
  labelViewTasks,
  MissingCard,
  useFilterViewData,
  ViewLoading,
} from './FilterPane'

export default function LabelViewPage() {
  return (
    <ODErrorBoundary label="Label">
      <LabelViewPageInner />
    </ODErrorBoundary>
  )
}

function LabelViewPageInner() {
  const { labelId } = useParams({ strict: false })
  const labelsQuery = useLabels()
  const data = useFilterViewData()
  const key = viewKey('label', labelId ?? '')
  const { prefs } = useViewPrefs(key)

  if (labelsQuery.isPending || data.isLoading) return <ViewLoading />

  const label = labelsQuery.data?.find((l) => l.id === labelId)
  if (label === undefined) {
    return <MissingCard title="Label not found" body="This label may have been deleted." />
  }

  const tasks = labelViewTasks(data.tasks, label.name)
  const count = tasks.length

  const header = (
    <header className="flex items-start justify-between gap-4 pt-8 pb-4">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="size-3 shrink-0 rounded-full"
          style={{ backgroundColor: colorVar(label.color) }}
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="truncate font-strong text-header text-text-primary">{label.name}</h1>
          <p className="text-caption text-text-tertiary">
            {count} {count === 1 ? 'task' : 'tasks'}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <DisplayMenu viewKey={key} />
      </div>
    </header>
  )

  if (prefs.layout === 'board') {
    return (
      <div className="flex h-full flex-col px-6">
        {header}
        <BoardView
          columns={viewsToBoardColumns(tasks, prefs, data.ctx, data.taskById)}
          label={label.name}
          emptyText={`No tasks with @${label.name}.`}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[var(--content-max)] px-6 pb-24">
      {header}
      <FilterPane
        tasks={tasks}
        paneKey={`label:${label.id}`}
        prefs={prefs}
        ctx={data.ctx}
        taskById={data.taskById}
        emptyText={`No tasks with @${label.name}.`}
        emptyState={<EmptyState icon={Tag} title={`No tasks with @${label.name}`} />}
      />
    </div>
  )
}
