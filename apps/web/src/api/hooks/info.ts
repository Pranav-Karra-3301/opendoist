import { useQuery } from '@tanstack/react-query'
import { type ApiError, api, endpoints } from '../client'
import { qk } from '../keys'
import { type Info, InfoSchema } from '../schemas'

/** GET /api/v1/info — unauthenticated instance facts (version, auth providers,
 *  registration flag, feature flags). Static per page load. */
export function useInfo() {
  return useQuery<Info, ApiError>({
    queryKey: qk.info,
    queryFn: () => api(endpoints.info, { schema: InfoSchema }),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
}
