import { useParams } from '@tanstack/react-router'
import { useLabels } from '@/api/hooks/labels'
import { useActiveTasks } from '@/api/hooks/tasks'
import type { Task } from '@/api/schemas'
import { TaskList } from '@/components/task/task-list'
import { Skeleton } from '@/components/ui/skeleton'
import { activeTasks, tasksWithLabel } from '@/lib/derive'

/**
 * Order for a label view: dated tasks first (by date, then time — all-day before
 * timed within a day), then undated tasks by creation time. Fully deterministic
 * (id tie-break) so renders never shuffle. Kept local — this ordering is specific
 * to the label view and not shared through lib/derive.
 */
function sortLabelTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const ad = a.due
    const bd = b.due
    if (ad !== null && bd !== null) {
      if (ad.date !== bd.date) return ad.date < bd.date ? -1 : 1
      const at = ad.time ?? ''
      const bt = bd.time ?? ''
      if (at !== bt) return at < bt ? -1 : 1
      return a.id.localeCompare(b.id)
    }
    if (ad !== null) return -1
    if (bd !== null) return 1
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
    return a.id.localeCompare(b.id)
  })
}

export function LabelView() {
  const { labelName } = useParams({ from: '/app/label/$labelName' })
  const { data: tasks, isLoading } = useActiveTasks()
  const { data: labels } = useLabels()

  // Labels are name-based on tasks, so an unknown label (deleted, or never a
  // first-class Label row) still renders its matching tasks. Fall back to the
  // server's default label color (`charcoal`) for the dot when unresolved.
  const color = labels?.find((l) => l.name === labelName)?.color ?? 'charcoal'
  const dotColor = `var(--od-palette-${color.replace(/_/g, '-')})`

  const matching = sortLabelTasks(tasksWithLabel(activeTasks(tasks ?? []), labelName))

  return (
    <div className="mx-auto max-w-[var(--content-max)] px-6 pb-24">
      <header className="flex items-start justify-between gap-4 pt-8 pb-4">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: dotColor }}
          />
          <h1 className="truncate font-strong text-header text-text-primary">@{labelName}</h1>
        </div>
      </header>

      {isLoading ? (
        <div aria-hidden className="flex flex-col gap-px">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[42px] w-full" />
          ))}
        </div>
      ) : (
        <TaskList
          tasks={matching}
          groupId="label"
          showProject
          emptyText="No tasks with this label"
        />
      )}
    </div>
  )
}
