import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ApiError, api, apiAllPages, apiVoid, endpoints } from '../client'
import { qk } from '../keys'
import { type Comment, CommentSchema } from '../schemas'

export function useComments(taskId: string) {
  return useQuery<Comment[], ApiError>({
    queryKey: qk.comments(taskId),
    queryFn: () => apiAllPages(endpoints.comments(taskId), CommentSchema),
    enabled: taskId !== '',
  })
}

export function useCommentMutations(taskId: string) {
  const qc = useQueryClient()
  const settled = { onSettled: () => qc.invalidateQueries({ queryKey: qk.comments(taskId) }) }
  return {
    create: useMutation<Comment, ApiError, { content: string }>({
      mutationFn: ({ content }) =>
        api(endpoints.commentsRoot, {
          method: 'POST',
          body: { task_id: taskId, content },
          schema: CommentSchema,
        }),
      ...settled,
    }),
    remove: useMutation<void, ApiError, { id: string }>({
      mutationFn: ({ id }) => apiVoid(endpoints.comment(id), { method: 'DELETE' }),
      ...settled,
    }),
  }
}
