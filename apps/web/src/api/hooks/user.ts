import { useQuery } from '@tanstack/react-query'
import { type ApiError, api, endpoints } from '../client'
import { qk } from '../keys'
import { type User, UserSchema, type UserSettings, UserSettingsSchema } from '../schemas'

export function useUser() {
  return useQuery<User, ApiError>({
    queryKey: qk.user,
    queryFn: () => api(endpoints.user, { schema: UserSchema }),
  })
}

/** Server-side settings document (camelCase) — drives parse context + formats. */
export function useUserSettings() {
  return useQuery<UserSettings, ApiError>({
    queryKey: qk.userSettings,
    queryFn: () => api(endpoints.userSettings, { schema: UserSettingsSchema }),
    staleTime: 30_000,
  })
}
