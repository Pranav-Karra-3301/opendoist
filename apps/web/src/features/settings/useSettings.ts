/**
 * User-settings query + optimistic PATCH mutation — FROZEN by Task A (plan Step 5).
 * Shares the `['user-settings']` cache key with phase 4's read-only useUserSettings
 * (apps/web/src/api/hooks/user.ts, qk.userSettings).
 */
import {
  DEFAULT_USER_SETTINGS,
  type UserSettings,
  type UserSettingsPatch,
  UserSettingsSchema,
} from '@opentask/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getUserSettings, patchUserSettings } from '../../lib/api/phase5'

export function mergeSettings(base: UserSettings, patch: UserSettingsPatch): UserSettings {
  const next = { ...base, ...patch }
  if (patch.viewPrefs) next.viewPrefs = { ...base.viewPrefs, ...patch.viewPrefs }
  return UserSettingsSchema.parse(next)
}
export function useUserSettings() {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['user-settings'],
    queryFn: getUserSettings,
    staleTime: 30_000,
  })
  const mutation = useMutation({
    mutationFn: patchUserSettings,
    onMutate: async (patch: UserSettingsPatch) => {
      await qc.cancelQueries({ queryKey: ['user-settings'] })
      const prev = qc.getQueryData<UserSettings>(['user-settings'])
      qc.setQueryData<UserSettings>(['user-settings'], (s) =>
        mergeSettings(s ?? DEFAULT_USER_SETTINGS, patch),
      )
      return { prev }
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(['user-settings'], ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['user-settings'] }),
  })
  return {
    settings: query.data ?? DEFAULT_USER_SETTINGS,
    isLoading: query.isLoading,
    update: mutation.mutate,
  }
}
