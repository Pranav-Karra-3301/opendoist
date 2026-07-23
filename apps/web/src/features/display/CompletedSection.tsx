/**
 * Completed-tasks section (Task H) — rendered beneath a view's active list when its Display
 * menu has `showCompleted` on. Fetches `GET /tasks/completed` (optionally scoped to a project)
 * with cursor pagination via `listCompleted`, and lets each row be re-opened (POST
 * `/tasks/{id}/reopen`), which invalidates BOTH the active-tasks cache (reopen mutation) and
 * this completed list so the row moves back. Rows are the phase-3 `TaskDto` subset core's
 * `CompletedTaskSchema` parses — project names aren't needed here (Reporting's CompletedFeed
 * joins them), so the row shows a checked priority circle, strike-through content, and the
 * completion timestamp.
 */
import type { CompletedTask } from '@opentask/core'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useMemo } from 'react'
import { useTaskMutations } from '@/api/hooks/tasks'
import { buttonVariants } from '@/components/ui/button'
import { listCompleted } from '@/lib/api/phase5'
import { useParseCtx } from '@/lib/parse-context'
import { cn } from '@/lib/utils'

/** Query key namespace for a view's completed list (per project, or the global list). */
export function completedKey(projectId?: string): readonly [string, string] {
  return ['completed', projectId ?? 'all']
}

export function CompletedSection({ projectId }: { projectId?: string }) {
  const qc = useQueryClient()
  const { reopen } = useTaskMutations()
  const { timezone } = useParseCtx()

  const query = useInfiniteQuery({
    queryKey: completedKey(projectId),
    queryFn: ({ pageParam }) => listCompleted({ project_id: projectId, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.next_cursor ?? undefined,
  })

  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: timezone,
      }),
    [timezone],
  )

  const rows = query.data?.pages.flatMap((p) => p.results) ?? []

  const uncomplete = (id: string): void => {
    reopen.mutate(
      { id },
      { onSettled: () => void qc.invalidateQueries({ queryKey: completedKey(projectId) }) },
    )
  }

  return (
    <section aria-label="Completed" className="mt-6">
      <h2 className="border-border-subtle border-b py-2 font-medium text-copy text-text-primary">
        Completed
      </h2>
      {query.isPending ? (
        <p className="py-2 text-copy text-text-tertiary italic">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-2 text-copy text-text-tertiary italic">No completed tasks yet.</p>
      ) : (
        rows.map((t) => (
          <CompletedRow
            key={t.id}
            task={t}
            label={fmt.format(new Date(t.completed_at))}
            onUncomplete={uncomplete}
          />
        ))
      )}
      {query.hasNextPage && (
        <button
          type="button"
          disabled={query.isFetchingNextPage}
          onClick={() => query.fetchNextPage()}
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'mt-2')}
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
    </section>
  )
}

function CompletedRow({
  task,
  label,
  onUncomplete,
}: {
  task: CompletedTask
  label: string
  onUncomplete: (id: string) => void
}) {
  return (
    <div className="flex min-h-[42px] items-start gap-1.5 border-border-subtle border-b py-2">
      <button
        type="button"
        aria-label="Mark as not completed"
        onClick={() => onUncomplete(task.id)}
        className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-focus-ring)]"
      >
        <span
          className="flex size-[18px] items-center justify-center rounded-full"
          style={{ backgroundColor: `var(--ot-p${task.priority})` }}
        >
          <Check size={12} strokeWidth={3} className="text-white" aria-hidden />
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-body text-text-tertiary line-through">
          {task.content}
        </span>
      </div>
      <span className="shrink-0 text-caption text-text-tertiary">{label}</span>
    </div>
  )
}
