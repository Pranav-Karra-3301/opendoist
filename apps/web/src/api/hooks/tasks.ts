/**
 * Task query + mutations. FROZEN signatures (Task A) — this file is Task B's wholesale
 * replacement of the minimal stub: every mutation is now optimistic (onMutate writes the
 * `qk.tasks` cache, onError rolls back, onSettled invalidates) and the four undoable verbs
 * (spec §2.4: complete / delete / reschedule / move) push a 10 s inverse-op entry to the undo
 * store. Every export stays type-identical to Task A's contract.
 *
 * AS-BUILT (Task A verified against the live server, 2026-07-16):
 * - `due` in create/update bodies is serialized centrally by client.ts `serializeBody`; full
 *   core `Due` objects are fine to hand over.
 * - move: server ignores `child_order` (schemas.ts `toMoveBody` strips it) and requires ≥1 of
 *   project_id/section_id/parent_id.
 * - close: POST body `{ complete_series }`; there is NO POST /tasks/{id}/restore, so undo-delete
 *   recreates via POST /tasks (the restored task gets a NEW id).
 * - POST /tasks/quick auto-creates unknown #project/@label — it invalidates projects + labels too.
 *
 * Silent flag: inverse ops set `silent: true` so they never push a fresh undo entry (no
 * undo-of-undo) and, being user-invisible, stay quiet on error — the undo store surfaces the
 * failure instead. Forward ops (and the flag-less reopen/create) toast their own errors.
 */

import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useRef } from 'react'
import { z } from 'zod'
import { useParseCtx } from '@/lib/parse-context'
import { toast } from '@/stores/toasts'
import { useUndoStore } from '@/stores/undo'
import {
  applyClose,
  applyCreate,
  applyMove,
  applyPatch,
  applyRemove,
  applyReopen,
  dueEqual,
  findTask,
  optimisticTaskFromCreate,
  type Snapshot,
  taskToCreate,
} from '../cache-updates'
import { type ApiError, api, apiAllPages, apiVoid, endpoints } from '../client'
import { qk } from '../keys'
import {
  type Task,
  type TaskCreate,
  type TaskMove,
  type TaskPatch,
  TaskSchema,
  toMoveBody,
} from '../schemas'

/** Every non-completed task in one cache entry — views slice it with lib/derive. */
export function useActiveTasks(): UseQueryResult<Task[], ApiError> {
  return useQuery<Task[], ApiError>({
    queryKey: qk.tasks,
    queryFn: () => apiAllPages(endpoints.tasks, TaskSchema),
  })
}

export interface TaskMutations {
  quickAdd: UseMutationResult<unknown, ApiError, { text: string }>
  create: UseMutationResult<Task, ApiError, TaskCreate>
  update: UseMutationResult<Task, ApiError, { id: string; patch: TaskPatch; silent?: boolean }>
  close: UseMutationResult<
    void,
    ApiError,
    { id: string; silent?: boolean; complete_series?: boolean }
  >
  reopen: UseMutationResult<void, ApiError, { id: string }>
  remove: UseMutationResult<void, ApiError, { id: string; silent?: boolean }>
  move: UseMutationResult<void, ApiError, { id: string; to: TaskMove; silent?: boolean }>
}

/** Latest `mutateAsync` fns, captured in a ref so inverse-op undo closures can call sibling
 *  mutations that don't exist yet at their own definition site. */
interface Inverses {
  update: (v: { id: string; patch: TaskPatch; silent?: boolean }) => Promise<Task>
  reopen: (v: { id: string }) => Promise<void>
  create: (v: TaskCreate) => Promise<Task>
  move: (v: { id: string; to: TaskMove; silent?: boolean }) => Promise<void>
}

export function useTaskMutations(): TaskMutations {
  const qc = useQueryClient()
  const ctx = useParseCtx()
  const inverses = useRef<Inverses | null>(null)

  const invalidateTasks = (): void => {
    void qc.invalidateQueries({ queryKey: qk.tasks })
  }
  const rollback = (context: Snapshot | undefined): void => {
    if (context !== undefined) qc.setQueryData<Task[] | undefined>(qk.tasks, context.prev)
  }
  const snapshotWith = async (apply: (prev: Task[]) => Task[]): Promise<Snapshot> => {
    await qc.cancelQueries({ queryKey: qk.tasks })
    const prev = qc.getQueryData<Task[]>(qk.tasks)
    qc.setQueryData<Task[]>(qk.tasks, (old) => apply(old ?? []))
    return { prev }
  }

  const quickAdd = useMutation<unknown, ApiError, { text: string }>({
    mutationFn: ({ text }) =>
      api(endpoints.quick, { method: 'POST', body: { text }, schema: z.unknown() }),
    // AS-BUILT: /tasks/quick auto-creates referenced projects/labels.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.tasks })
      void qc.invalidateQueries({ queryKey: qk.projects })
      void qc.invalidateQueries({ queryKey: qk.labels })
    },
  })

  const create = useMutation<Task, ApiError, TaskCreate, Snapshot>({
    mutationFn: (input) =>
      api(endpoints.tasks, { method: 'POST', body: input, schema: TaskSchema }),
    onMutate: (input) =>
      snapshotWith((prev) =>
        applyCreate(
          prev,
          optimisticTaskFromCreate(input, {
            id: `temp-${crypto.randomUUID()}`,
            now: new Date().toISOString(),
          }),
        ),
      ),
    onError: (err, _input, context) => {
      rollback(context)
      toast.error(err.message)
    },
    onSettled: invalidateTasks,
  })

  const update = useMutation<
    Task,
    ApiError,
    { id: string; patch: TaskPatch; silent?: boolean },
    Snapshot
  >({
    mutationFn: ({ id, patch }) =>
      api(endpoints.task(id), { method: 'PATCH', body: patch, schema: TaskSchema }),
    onMutate: ({ id, patch }) => snapshotWith((prev) => applyPatch(prev, id, patch)),
    onError: (err, vars, context) => {
      rollback(context)
      if (!vars.silent) toast.error(err.message)
    },
    onSuccess: (_data, vars, context) => {
      if (vars.silent || vars.patch.due === undefined) return
      const prevDue = findTask(context?.prev, vars.id)?.due ?? null
      if (dueEqual(prevDue, vars.patch.due)) return
      useUndoStore
        .getState()
        .push('Rescheduled', () =>
          inverses.current
            ? inverses.current
                .update({ id: vars.id, patch: { due: prevDue }, silent: true })
                .then(noop)
            : Promise.resolve(),
        )
    },
    onSettled: invalidateTasks,
  })

  const close = useMutation<
    void,
    ApiError,
    { id: string; silent?: boolean; complete_series?: boolean },
    Snapshot
  >({
    mutationFn: ({ id, complete_series }) =>
      apiVoid(endpoints.close(id), {
        method: 'POST',
        body: { complete_series: complete_series ?? false },
      }),
    // complete_series (Shift+click) ends the whole recurring series → drop it; otherwise
    // applyClose advances a recurring due or removes a one-off.
    onMutate: ({ id, complete_series }) =>
      snapshotWith((prev) =>
        complete_series ? prev.filter((t) => t.id !== id) : applyClose(prev, id, ctx),
      ),
    onError: (err, vars, context) => {
      rollback(context)
      if (!vars.silent) toast.error(err.message)
    },
    onSuccess: (_data, vars) => {
      if (vars.silent) return
      const { id } = vars
      useUndoStore.getState().push('Task completed', () => {
        // reopen has no silent flag → it toasts its own errors; swallow here to avoid a
        // duplicate toast from the undo store.
        inverses.current?.reopen({ id }).catch(noop)
        return Promise.resolve()
      })
    },
    onSettled: invalidateTasks,
  })

  const reopen = useMutation<void, ApiError, { id: string }, Snapshot>({
    mutationFn: ({ id }) => apiVoid(endpoints.reopen(id), { method: 'POST' }),
    onMutate: ({ id }) => snapshotWith((prev) => applyReopen(prev, id)),
    onError: (err, _vars, context) => {
      rollback(context)
      toast.error(err.message)
    },
    onSettled: invalidateTasks,
  })

  const remove = useMutation<void, ApiError, { id: string; silent?: boolean }, Snapshot>({
    mutationFn: ({ id }) => apiVoid(endpoints.task(id), { method: 'DELETE' }),
    onMutate: ({ id }) => snapshotWith((prev) => applyRemove(prev, id)),
    onError: (err, vars, context) => {
      rollback(context)
      if (!vars.silent) toast.error(err.message)
    },
    onSuccess: (_data, vars, context) => {
      if (vars.silent) return
      const snapshotTask = findTask(context?.prev, vars.id)
      if (snapshotTask === undefined) return
      const payload = taskToCreate(snapshotTask)
      useUndoStore.getState().push('Task deleted', () => {
        // AS-BUILT: no /restore route → recreate (new id). create toasts its own errors.
        inverses.current?.create(payload).catch(noop)
        return Promise.resolve()
      })
    },
    onSettled: invalidateTasks,
  })

  const move = useMutation<
    void,
    ApiError,
    { id: string; to: TaskMove; silent?: boolean },
    Snapshot
  >({
    mutationFn: ({ id, to }) =>
      apiVoid(endpoints.move(id), { method: 'POST', body: toMoveBody(to) }),
    onMutate: ({ id, to }) => snapshotWith((prev) => applyMove(prev, id, to)),
    onError: (err, vars, context) => {
      rollback(context)
      if (!vars.silent) toast.error(err.message)
    },
    onSuccess: (_data, vars, context) => {
      if (vars.silent) return
      const prevTask = findTask(context?.prev, vars.id)
      if (prevTask === undefined) return
      const to: TaskMove = {
        project_id: prevTask.project_id,
        section_id: prevTask.section_id,
        parent_id: prevTask.parent_id,
        child_order: prevTask.child_order,
      }
      useUndoStore
        .getState()
        .push('Task moved', () =>
          inverses.current
            ? inverses.current.move({ id: vars.id, to, silent: true }).then(noop)
            : Promise.resolve(),
        )
    },
    onSettled: invalidateTasks,
  })

  // Populate the inverse-op refs synchronously each render so undo closures (which fire only
  // after a network round-trip) always see the latest, mounted mutateAsync fns.
  inverses.current = {
    update: update.mutateAsync,
    reopen: reopen.mutateAsync,
    create: create.mutateAsync,
    move: move.mutateAsync,
  }

  return { quickAdd, create, update, close, reopen, remove, move }
}

function noop(): void {}
