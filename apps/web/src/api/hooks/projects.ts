import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ApiError, api, apiAllPages, apiVoid, endpoints } from '../client'
import { qk } from '../keys'
import { type Project, ProjectSchema } from '../schemas'

export function useProjects() {
  return useQuery<Project[], ApiError>({
    queryKey: qk.projects,
    queryFn: () => apiAllPages(endpoints.projects, ProjectSchema),
  })
}

export function useProjectMutations() {
  const qc = useQueryClient()
  const settled = { onSettled: () => qc.invalidateQueries({ queryKey: qk.projects }) }
  return {
    create: useMutation<
      Project,
      ApiError,
      { name: string; color?: string; parent_id?: string | null }
    >({
      mutationFn: (input) =>
        api(endpoints.projects, { method: 'POST', body: input, schema: ProjectSchema }),
      ...settled,
    }),
    update: useMutation<
      Project,
      ApiError,
      {
        id: string
        patch: Partial<Pick<Project, 'name' | 'color' | 'is_favorite' | 'is_collapsed'>>
      }
    >({
      mutationFn: ({ id, patch }) =>
        api(endpoints.project(id), { method: 'PATCH', body: patch, schema: ProjectSchema }),
      ...settled,
    }),
    remove: useMutation<void, ApiError, { id: string }>({
      mutationFn: ({ id }) => apiVoid(endpoints.project(id), { method: 'DELETE' }),
      ...settled,
    }),
  }
}
