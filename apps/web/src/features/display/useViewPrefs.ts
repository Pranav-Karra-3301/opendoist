/**
 * Per-view display prefs over user settings — FROZEN by Task A (plan Step 5).
 * `key` is core's viewKey(kind, id); writes replace the whole per-key ViewPrefs object
 * (matching the server's per-key-replace PATCH semantics inside viewPrefs).
 */
import { DEFAULT_VIEW_PREFS, type ViewPrefs } from '@opentask/core'
import { useUserSettings } from '../settings/useSettings'
export function useViewPrefs(key: string) {
  const { settings, update } = useUserSettings()
  const prefs = settings.viewPrefs[key] ?? DEFAULT_VIEW_PREFS
  const setPrefs = (p: Partial<ViewPrefs>) => update({ viewPrefs: { [key]: { ...prefs, ...p } } })
  return { prefs, setPrefs }
}
