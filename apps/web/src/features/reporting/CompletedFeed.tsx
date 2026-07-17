/**
 * Completed-tasks feed for the Reporting view — day-grouped over `completed_at`, project
 * names joined client-side from the `['projects']` cache (the wire rows are phase-3 TaskDto
 * subsets). Each row can be uncompleted, which reopens the task and refreshes the active
 * list, this feed, and the activity log.
 */
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, Undo2 } from 'lucide-react'
import { useMemo } from 'react'
import { type ApiError, apiVoid, endpoints } from '@/api/client'
import { useProjects } from '@/api/hooks/projects'
import { qk } from '@/api/keys'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { colorVar } from '@/features/dialogs/ColorPicker'
import { useUserSettings } from '@/features/settings/useSettings'
import { listCompleted } from '@/lib/api/phase5'
import { toast } from '@/stores/toasts'
import { formatEventTime, groupByDay } from './activity-presentation'

export interface CompletedParams {
  project_id?: string
  since?: string
  until?: string
}

const SKELETON_ROWS = ['a', 'b', 'c', 'd', 'e']

export function CompletedFeed({ params }: { params: CompletedParams }) {
  const { settings } = useUserSettings()
  const qc = useQueryClient()
  const projectsQuery = useProjects()
  const projectsById = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>()
    for (const p of projectsQuery.data ?? []) map.set(p.id, { name: p.name, color: p.color })
    return map
  }, [projectsQuery.data])
  const now = useMemo(() => new Date().toISOString(), [])

  const uncomplete = useMutation<void, ApiError, string>({
    mutationFn: (id) => apiVoid(endpoints.reopen(id), { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['completed'] })
      void qc.invalidateQueries({ queryKey: qk.tasks })
      void qc.invalidateQueries({ queryKey: ['activities'] })
    },
    onError: (error) => toast.error(error.message),
  })

  const query = useInfiniteQuery({
    queryKey: ['completed', params],
    queryFn: ({ pageParam }) => listCompleted({ ...params, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-2 py-2">
        {SKELETON_ROWS.map((key) => (
          <Skeleton key={key} className="h-8 w-full" />
        ))}
      </div>
    )
  }

  const tasks = query.data?.pages.flatMap((page) => page.results) ?? []
  if (tasks.length === 0) {
    return (
      <p className="py-16 text-center text-body text-text-tertiary">
        {query.isError
          ? "Couldn't load completed tasks. Check your connection and try again."
          : 'No completed tasks in this range.'}
      </p>
    )
  }

  const groups = groupByDay(tasks, (t) => t.completed_at, settings.timezone, now)

  return (
    <div className="pb-4">
      {groups.map((group) => (
        <section key={group.key}>
          <h2 className="sticky top-0 z-[1] bg-bg py-2 font-medium text-caption text-text-secondary">
            {group.label}
            <span className="font-normal text-text-tertiary">{` · ${group.items.length}`}</span>
          </h2>
          <ul className="flex flex-col">
            {group.items.map((task) => {
              const project = projectsById.get(task.project_id)
              return (
                <li
                  key={task.id}
                  className="group flex items-center gap-3 border-border-subtle border-b py-2 last:border-b-0"
                >
                  <CircleCheck size={18} aria-hidden="true" className="shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate text-body text-text-tertiary line-through">
                    {task.content}
                  </span>
                  {project !== undefined && (
                    <span className="flex shrink-0 items-center gap-1 rounded-sm bg-surface px-1.5 py-0.5 text-caption text-text-secondary">
                      <span
                        aria-hidden="true"
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: colorVar(project.color) }}
                      />
                      <span className="max-w-[160px] truncate">{project.name}</span>
                    </span>
                  )}
                  <time className="shrink-0 text-caption text-text-tertiary tabular-nums">
                    {formatEventTime(task.completed_at, settings.timezone, settings.timeFormat)}
                  </time>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Uncomplete task: ${task.content}`}
                    className="size-7 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                    disabled={uncomplete.isPending}
                    onClick={() => uncomplete.mutate(task.id)}
                  >
                    <Undo2 size={16} aria-hidden="true" />
                  </Button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      {query.hasNextPage && (
        <div className="flex justify-center py-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Show more'}
          </Button>
        </div>
      )}
    </div>
  )
}
