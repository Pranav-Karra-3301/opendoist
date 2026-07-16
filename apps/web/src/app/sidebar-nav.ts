/**
 * Primary sidebar nav items and their `settings.sidebar` visibility mapping (phase 5, Task J).
 * Kept pure + framework-free so it is unit-tested in the node vitest env and shared by the
 * sidebar component. Only these five primary items honour the show-flags; Favourites and the
 * project tree render unconditionally.
 */
import type { SidebarPrefs } from '@opendoist/core'

export type SidebarNavId = 'inbox' | 'today' | 'upcoming' | 'filters-labels' | 'reporting'

/** Render order of the primary nav items. */
export const SIDEBAR_NAV_ORDER = [
  'inbox',
  'today',
  'upcoming',
  'filters-labels',
  'reporting',
] as const satisfies readonly SidebarNavId[]

/** Each primary nav item's governing `settings.sidebar` boolean. */
export const NAV_VISIBILITY_FLAG = {
  inbox: 'showInbox',
  today: 'showToday',
  upcoming: 'showUpcoming',
  'filters-labels': 'showFiltersLabels',
  reporting: 'showReporting',
} as const satisfies Record<SidebarNavId, keyof SidebarPrefs>

/** Whether a primary nav item is shown for the given sidebar preferences. */
export function isNavVisible(id: SidebarNavId, prefs: SidebarPrefs): boolean {
  return prefs[NAV_VISIBILITY_FLAG[id]]
}
