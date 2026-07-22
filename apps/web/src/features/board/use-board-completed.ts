/**
 * Completed cards for the board (Board View pass, review fix).
 *
 * §Reference layout mechanics: "Completed cards (when Show completed is on) appear greyed/struck
 * at the bottom of their column, consistent with the list's completed treatment." This hook is the
 * board's counterpart of the list's `CompletedSection` data flow — the SAME `GET /tasks/completed`
 * fetch under the SAME query key (`completedKey`), so both renderers share one cache entry and a
 * reopen converges them together (never a parallel data path). Like the list section's initial
 * render it shows the first page; `completedForColumn` (BoardView) distributes the rows onto
 * columns by section / due day.
 */
import type { CompletedTask } from '@opendoist/core'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useTaskMutations } from '@/api/hooks/tasks'
import { completedKey } from '@/features/display/CompletedSection'
import { listCompleted } from '@/lib/api/phase5'

/** Where a board's completed list is scoped — a project (project/inbox) or global (today/upcoming). */
export interface BoardCompletedScope {
  projectId?: string
}

export interface BoardCompleted {
  tasks: CompletedTask[]
  /** Reopen a completed card, then refresh the completed list (list `CompletedSection` parity). */
  reopen: (id: string) => void
}

/** `scope === undefined` (Show completed off) disables the fetch and yields no cards. */
export function useBoardCompleted(scope: BoardCompletedScope | undefined): BoardCompleted {
  const qc = useQueryClient()
  const { reopen } = useTaskMutations()
  const projectId = scope?.projectId
  const query = useInfiniteQuery({
    queryKey: completedKey(projectId),
    queryFn: ({ pageParam }) => listCompleted({ project_id: projectId, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.next_cursor ?? undefined,
    enabled: scope !== undefined,
  })
  return {
    tasks: scope === undefined ? [] : (query.data?.pages.flatMap((p) => p.results) ?? []),
    reopen: (id) => {
      reopen.mutate(
        { id },
        { onSettled: () => void qc.invalidateQueries({ queryKey: completedKey(projectId) }) },
      )
    },
  }
}
