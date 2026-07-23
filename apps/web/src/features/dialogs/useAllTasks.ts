/**
 * `useAllTasks` (plan Task E) — every active task mapped to a core `FilterTaskView`, plus a
 * `FilterContext` assembled from the user's settings. Consumed by the filter/label dialogs'
 * live query preview and (per the plan) imported by Task G's filter- and label-view pages.
 *
 * As-built reuse: rather than issue the plan's separately-keyed `['tasks','all']` fetch, this
 * composes the phase-4 shared caches — `useActiveTasks` (`['tasks']`, already follows
 * `next_cursor` over GET /tasks via `apiAllPages`), `useProjects` (`['projects']`) and
 * `useSections` (`['sections']`). Those exact keys are what phase-4 mutations and the SSE
 * stream invalidate, so filter/label previews and views stay live with zero extra wiring —
 * strictly better than a duplicate task fetch. (Deviation recorded in the task result notes.)
 */
import type { FilterContext, FilterTaskView, Weekday } from '@opentask/core'
import { useMemo } from 'react'
import { useProjects } from '@/api/hooks/projects'
import { useSections } from '@/api/hooks/sections'
import { useActiveTasks } from '@/api/hooks/tasks'
import { useUserSettings } from '@/features/settings/useSettings'
import { toFilterTaskView } from '@/lib/api/phase5'

export interface AllTasks {
  tasks: FilterTaskView[]
  ctx: FilterContext
  isLoading: boolean
}

/** Core settings store weekdays as unconstrained integers; narrow to the `Weekday` union. */
function asWeekday(value: number): Weekday {
  return Number.isInteger(value) && value >= 1 && value <= 7 ? (value as Weekday) : 1
}

export function useAllTasks(): AllTasks {
  const tasksQuery = useActiveTasks()
  const projectsQuery = useProjects()
  const sectionsQuery = useSections()
  const { settings } = useUserSettings()

  const projects = useMemo<ReadonlyMap<string, { name: string; parentId: string | null }>>(() => {
    const map = new Map<string, { name: string; parentId: string | null }>()
    for (const project of projectsQuery.data ?? []) {
      map.set(project.id, { name: project.name, parentId: project.parent_id })
    }
    return map
  }, [projectsQuery.data])

  const sectionNames = useMemo<ReadonlyMap<string, string>>(() => {
    const map = new Map<string, string>()
    for (const section of sectionsQuery.data ?? []) map.set(section.id, section.name)
    return map
  }, [sectionsQuery.data])

  const tasks = useMemo<FilterTaskView[]>(
    () =>
      (tasksQuery.data ?? []).map((task) =>
        toFilterTaskView(task as unknown as Record<string, unknown>, projects, sectionNames),
      ),
    [tasksQuery.data, projects, sectionNames],
  )

  const ctx = useMemo<FilterContext>(
    () => ({
      now: new Date().toISOString(),
      timezone: settings.timezone,
      weekStart: asWeekday(settings.weekStart),
      nextWeekDay: asWeekday(settings.nextWeekDay),
      weekendDay: asWeekday(settings.weekendDay),
      projects,
    }),
    [settings.timezone, settings.weekStart, settings.nextWeekDay, settings.weekendDay, projects],
  )

  return {
    tasks,
    ctx,
    isLoading: tasksQuery.isLoading || projectsQuery.isLoading || sectionsQuery.isLoading,
  }
}
