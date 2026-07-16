import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ApiError, api, apiAllPages, apiVoid, endpoints } from '../client'
import { qk } from '../keys'
import { type Section, SectionSchema } from '../schemas'

/** ALL sections across projects (GET /sections without project_id). */
export function useSections() {
  return useQuery<Section[], ApiError>({
    queryKey: qk.sections,
    queryFn: () => apiAllPages(endpoints.sections, SectionSchema),
  })
}

export function useSectionMutations() {
  const qc = useQueryClient()
  const settled = { onSettled: () => qc.invalidateQueries({ queryKey: qk.sections }) }
  return {
    create: useMutation<Section, ApiError, { project_id: string; name: string }>({
      mutationFn: (input) =>
        api(endpoints.sections, { method: 'POST', body: input, schema: SectionSchema }),
      ...settled,
    }),
    update: useMutation<
      Section,
      ApiError,
      { id: string; patch: Partial<Pick<Section, 'name' | 'section_order' | 'is_collapsed'>> }
    >({
      mutationFn: ({ id, patch }) =>
        api(endpoints.section(id), { method: 'PATCH', body: patch, schema: SectionSchema }),
      ...settled,
    }),
    remove: useMutation<void, ApiError, { id: string }>({
      mutationFn: ({ id }) => apiVoid(endpoints.section(id), { method: 'DELETE' }),
      ...settled,
    }),
  }
}
