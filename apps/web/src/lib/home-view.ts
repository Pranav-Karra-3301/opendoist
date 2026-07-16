/**
 * Pure mapping from a stored `UserSettings.homeView` string to a router redirect target.
 *
 * homeView values (core `UserSettingsSchema`):
 *   'inbox' | 'today' | 'upcoming' | 'filters-labels' | 'project:<id>' | 'label:<id>' | 'filter:<id>'
 *
 * Consumed by the `/` index redirect in router.tsx (phase-5 Task N) so the app opens on the
 * user's chosen Home view instead of a hard-coded Today. Router-agnostic (no `@tanstack`
 * import) so it unit-tests without booting the route tree; unknown/blank values fall back to
 * Today, matching the app's safe default.
 */

export type HomeTarget =
  | { to: '/inbox' }
  | { to: '/today' }
  | { to: '/upcoming' }
  | { to: '/filters-labels' }
  | { to: '/project/$projectId'; params: { projectId: string } }
  | { to: '/label/$labelId'; params: { labelId: string } }
  | { to: '/filter/$filterId'; params: { filterId: string } }

export function homeViewToTarget(homeView: string | undefined | null): HomeTarget {
  const value = (homeView ?? '').trim()
  const colon = value.indexOf(':')
  if (colon > 0) {
    const kind = value.slice(0, colon)
    const id = value.slice(colon + 1)
    if (id !== '') {
      if (kind === 'project') return { to: '/project/$projectId', params: { projectId: id } }
      if (kind === 'label') return { to: '/label/$labelId', params: { labelId: id } }
      if (kind === 'filter') return { to: '/filter/$filterId', params: { filterId: id } }
    }
  }
  switch (value) {
    case 'inbox':
      return { to: '/inbox' }
    case 'upcoming':
      return { to: '/upcoming' }
    case 'filters-labels':
      return { to: '/filters-labels' }
    default:
      // 'today', '', or any unrecognised value → Today (safe default).
      return { to: '/today' }
  }
}
