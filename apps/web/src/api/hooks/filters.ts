/**
 * Filters query (phase 5, Task J) — populates the `['filters']` cache the phase-4 SSE handler
 * reserved for phase 5 (see api/sse.ts `case 'filter'`). Read-only here: the sidebar Favorites
 * and, post-integration, the Filters & Labels page (Task D) + filter view (Task G) consume it.
 * Tasks D/E own filter CRUD and invalidate this same `['filters']` key after their mutations,
 * so favourites stay fresh — they should import `useFilters` from here rather than redefine it.
 */
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { type ApiError, apiAllPages } from '../client'

/** Mirrors the server FilterDto (apps/server/src/api/schemas.ts): palette-colour name, the
 *  saved query string, ordering, and favourite flag. Server-only audit fields are stripped. */
export const FilterSchema = z.object({
  id: z.string(),
  name: z.string(),
  query: z.string(),
  color: z.string(),
  item_order: z.number().int(),
  is_favorite: z.boolean(),
})
export type Filter = z.infer<typeof FilterSchema>

/** All saved filters, ordered by the server (item_order). */
export function useFilters() {
  return useQuery<Filter[], ApiError>({
    queryKey: ['filters'],
    queryFn: () => apiAllPages('/filters', FilterSchema),
  })
}
