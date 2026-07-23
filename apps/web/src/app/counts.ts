import { dateInTz } from '@opentask/core'
import { useMemo } from 'react'
import { useProjects } from '@/api/hooks/projects'
import { useActiveTasks } from '@/api/hooks/tasks'
import { inboxCount, todayCount } from '@/lib/derive'
import { useParseCtx } from '@/lib/parse-context'

export interface ViewCounts {
  inbox: number
  today: number
}

/**
 * Live Inbox + Today counts for the sidebar, derived from the single
 * `useActiveTasks()` cache entry (no view-specific query). Inbox project id comes
 * from `useProjects()` (`is_inbox`); today's date from the user's parse-context tz.
 */
export function useViewCounts(): ViewCounts {
  const { data: tasks } = useActiveTasks()
  const { data: projects } = useProjects()
  const ctx = useParseCtx()
  const todayIso = dateInTz(ctx.now, ctx.timezone)
  const inboxProjectId = projects?.find((p) => p.is_inbox)?.id ?? null

  return useMemo(() => {
    if (tasks === undefined) return { inbox: 0, today: 0 }
    return {
      inbox: inboxProjectId === null ? 0 : inboxCount(tasks, inboxProjectId),
      today: todayCount(tasks, todayIso),
    }
  }, [tasks, inboxProjectId, todayIso])
}
