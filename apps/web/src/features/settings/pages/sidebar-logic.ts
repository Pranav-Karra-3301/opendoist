/**
 * Pure helpers for the Sidebar settings page (plan Task P).
 *
 * The user-settings PATCH shallow-merges at the TOP level of the document (per-key replace inside
 * `viewPrefs`, wholesale replace everywhere else), so every toggle must send the COMPLETE
 * `SidebarPrefs` object. A partial like `{ showInbox: false }` would drop the untouched toggles on
 * the server round-trip. Task J reads these prefs to show/hide the live sidebar items.
 */
import type { SidebarPrefs, UserSettingsPatch } from '@opentask/core'

export interface SidebarViewToggle {
  key: keyof SidebarPrefs
  label: string
}

/** The five views that can be shown or hidden, in sidebar order. `showCounts` is a separate option. */
export const SIDEBAR_VIEW_TOGGLES: readonly SidebarViewToggle[] = [
  { key: 'showInbox', label: 'Inbox' },
  { key: 'showToday', label: 'Today' },
  { key: 'showUpcoming', label: 'Upcoming' },
  { key: 'showFiltersLabels', label: 'Filters & Labels' },
  { key: 'showReporting', label: 'Reporting' },
]

/**
 * Build a settings patch carrying the full sidebar object with exactly one toggle changed.
 * Non-mutating: `current` is spread, never edited in place.
 */
export function sidebarPatch(
  current: SidebarPrefs,
  key: keyof SidebarPrefs,
  value: boolean,
): UserSettingsPatch {
  return { sidebar: { ...current, [key]: value } }
}
