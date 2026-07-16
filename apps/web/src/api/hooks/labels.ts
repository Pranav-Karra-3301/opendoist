import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ApiError, api, apiAllPages, apiVoid, endpoints } from '../client'
import { qk } from '../keys'
import { type Label, LabelSchema } from '../schemas'

export function useLabels() {
  return useQuery<Label[], ApiError>({
    queryKey: qk.labels,
    queryFn: () => apiAllPages(endpoints.labels, LabelSchema),
  })
}

export function useLabelMutations() {
  const qc = useQueryClient()
  const settled = { onSettled: () => qc.invalidateQueries({ queryKey: qk.labels }) }
  return {
    create: useMutation<Label, ApiError, { name: string; color?: string }>({
      mutationFn: (input) =>
        api(endpoints.labels, { method: 'POST', body: input, schema: LabelSchema }),
      ...settled,
    }),
    update: useMutation<
      Label,
      ApiError,
      { id: string; patch: Partial<Pick<Label, 'name' | 'color' | 'is_favorite'>> }
    >({
      mutationFn: ({ id, patch }) =>
        api(endpoints.label(id), { method: 'PATCH', body: patch, schema: LabelSchema }),
      ...settled,
    }),
    remove: useMutation<void, ApiError, { id: string }>({
      mutationFn: ({ id }) => apiVoid(endpoints.label(id), { method: 'DELETE' }),
      ...settled,
    }),
  }
}
