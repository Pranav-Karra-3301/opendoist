/**
 * Activity feed — day-grouped, infinitely paged event log with unlimited history.
 * Consumes the read-time-denormalized `payload` (content + project_name) so no extra
 * joins are needed; project colors are resolved from the `['projects']` cache for the
 * chip dot only.
 */
import { useInfiniteQuery } from '@tanstack/react-query'
import {
  ArrowRightLeft,
  CircleCheck,
  CircleDot,
  Filter,
  Hash,
  type LucideIcon,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Rows3,
  Tag,
  Trash2,
  Undo2,
} from 'lucide-react'
import { useMemo } from 'react'
import { useProjects } from '@/api/hooks/projects'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { colorVar } from '@/features/dialogs/ColorPicker'
import { useUserSettings } from '@/features/settings/useSettings'
import { listActivities } from '@/lib/api/phase5'
import {
  type EventIconName,
  eventFrame,
  eventIcon,
  eventSentence,
  formatEventTime,
  groupByDay,
} from './activity-presentation'

const ICONS: Record<EventIconName, LucideIcon> = {
  Plus,
  CircleCheck,
  Undo2,
  ArrowRightLeft,
  RotateCcw,
  Trash2,
  Pencil,
  Hash,
  MessageSquare,
  Rows3,
  Tag,
  Filter,
  CircleDot,
}

/** eventIcon returns a name in EventIconName, every one of which ICONS defines. */
function iconFor(eventType: string): LucideIcon {
  return ICONS[eventIcon(eventType)]
}

export interface ReportingParams {
  types?: string
  project_id?: string
  since?: string
  until?: string
}

const SKELETON_ROWS = ['a', 'b', 'c', 'd', 'e']

export function ActivityFeed({ params }: { params: ReportingParams }) {
  const { settings } = useUserSettings()
  const projectsQuery = useProjects()
  const projectColor = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of projectsQuery.data ?? []) map.set(p.id, p.color)
    return map
  }, [projectsQuery.data])
  const now = useMemo(() => new Date().toISOString(), [])

  const query = useInfiniteQuery({
    queryKey: ['activities', params],
    queryFn: ({ pageParam }) => listActivities({ ...params, cursor: pageParam, limit: 50 }),
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

  const events = query.data?.pages.flatMap((page) => page.results) ?? []
  if (events.length === 0) {
    return (
      <p className="py-16 text-center text-body text-text-tertiary">
        {query.isError
          ? "Couldn't load activity. Check your connection and try again."
          : 'No activity yet. Completing, adding, and editing tasks will show up here.'}
      </p>
    )
  }

  const groups = groupByDay(events, (e) => e.at, settings.timezone, now)

  return (
    <div className="pb-4">
      {groups.map((group) => (
        <section key={group.key}>
          <h2 className="sticky top-0 z-[1] bg-bg py-2 font-medium text-caption text-text-secondary">
            {group.label}
            <span className="font-normal text-text-tertiary">{` · ${group.items.length}`}</span>
          </h2>
          <ul className="flex flex-col">
            {group.items.map((event) => {
              const Icon = iconFor(event.event_type)
              const color = event.project_id ? projectColor.get(event.project_id) : undefined
              const content = event.payload.content.trim()
              return (
                <li
                  key={event.id}
                  aria-label={eventSentence(event)}
                  className="flex items-start gap-3 border-border-subtle border-b py-2 last:border-b-0"
                >
                  <Icon
                    size={16}
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-text-secondary"
                  />
                  <div className="min-w-0 flex-1">
                    <span className="text-copy text-text-secondary">
                      {eventFrame(event.event_type)}
                      {content === '' ? '' : ':'}
                    </span>
                    {content !== '' && (
                      <span className="ml-1.5 text-body text-text-primary">{content}</span>
                    )}
                  </div>
                  {event.payload.project_name !== null && event.payload.project_name !== '' && (
                    <span className="flex shrink-0 items-center gap-1 rounded-sm bg-surface px-1.5 py-0.5 text-caption text-text-secondary">
                      {color !== undefined && (
                        <span
                          aria-hidden="true"
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: colorVar(color) }}
                        />
                      )}
                      <span className="max-w-[160px] truncate">{event.payload.project_name}</span>
                    </span>
                  )}
                  <time className="shrink-0 pt-0.5 text-caption text-text-tertiary tabular-nums">
                    {formatEventTime(event.at, settings.timezone, settings.timeFormat)}
                  </time>
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
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  )
}
