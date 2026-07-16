/**
 * Recently-visited destinations for the ⌘K command palette. Persisted to localStorage
 * (`od-recents`), most-recent-first, deduped by (type, id), capped at 8. `useTrackRecents`
 * subscribes to router navigation and records each visited view/project/label; the palette
 * reads `getRecents()` to populate its Recents group and re-pushes on selection.
 */
import { useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useProjects } from '@/api/hooks/projects'
import type { Project } from '@/api/schemas'

export type RecentType = 'view' | 'project' | 'label'

export interface Recent {
  type: RecentType
  /** view: 'inbox'|'today'|'upcoming'; project: project id; label: decoded label name */
  id: string
  title: string
}

const STORAGE_KEY = 'od-recents'
const MAX_RECENTS = 8

function isRecent(value: unknown): value is Recent {
  if (value === null || typeof value !== 'object') return false
  const r = value as Record<string, unknown>
  return (
    (r.type === 'view' || r.type === 'project' || r.type === 'label') &&
    typeof r.id === 'string' &&
    typeof r.title === 'string'
  )
}

/** Read the recents list (most-recent-first). Returns [] when unset or unreadable. */
export function getRecents(): Recent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRecent).slice(0, MAX_RECENTS)
  } catch {
    return []
  }
}

/** Record a visit, moving it to the front and dropping any earlier duplicate (same type+id). */
export function pushRecent(recent: Recent): void {
  try {
    const rest = getRecents().filter((r) => !(r.type === recent.type && r.id === recent.id))
    const next = [recent, ...rest].slice(0, MAX_RECENTS)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // localStorage unavailable (private mode / quota exceeded) — recents are best-effort.
  }
}

const VIEW_TITLES: Record<string, string> = {
  inbox: 'Inbox',
  today: 'Today',
  upcoming: 'Upcoming',
}

/** Map a resolved pathname to the recent it should record, or null when not trackable. */
function recentForPath(pathname: string, projects: Project[] | undefined): Recent | null {
  const viewId = /^\/(inbox|today|upcoming)\/?$/.exec(pathname)?.[1]
  if (viewId) return { type: 'view', id: viewId, title: VIEW_TITLES[viewId] ?? viewId }

  const rawProjectId = /^\/project\/([^/]+)\/?$/.exec(pathname)?.[1]
  if (rawProjectId) {
    const id = decodeURIComponent(rawProjectId)
    const project = projects?.find((p) => p.id === id)
    return project ? { type: 'project', id, title: project.name } : null
  }

  const rawLabel = /^\/label\/([^/]+)\/?$/.exec(pathname)?.[1]
  if (rawLabel) {
    const name = decodeURIComponent(rawLabel)
    return { type: 'label', id: name, title: name }
  }

  return null
}

/** Record navigations into the recents list. Call once from a persistent component. */
export function useTrackRecents(): void {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { data: projects } = useProjects()
  useEffect(() => {
    const recent = recentForPath(pathname, projects)
    if (recent) pushRecent(recent)
  }, [pathname, projects])
}
