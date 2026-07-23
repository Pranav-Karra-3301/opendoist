/**
 * Task query + mutations. FROZEN signatures (Task A). Every mutation is optimistic (onMutate
 * writes the `qk.tasks` cache, onError rolls back, onSettled invalidates); the four undoable
 * verbs (spec §2.4: complete / delete / reschedule / move) push an inverse-op entry to the
 * phase-5 single-slot undo store (`@/features/undo/store`, rendered by `UndoHost`) — Task W
 * migrated these off phase 4's `stores/undo` so there is ONE undo system. Every export stays
 * type-identical to Task A's contract.
 *
 * AS-BUILT (verified against the live server, 2026-07-16):
 * - `due` in create/update bodies is serialized centrally by client.ts `serializeBody`; full
 *   core `Due` objects are fine to hand over. A due with a known date serializes to
 *   `{ string, date, time? }` — the server pins the exact date/time, stores the phrase
 *   verbatim, and re-parses recurrence from it — so undo restores are exact for both plain
 *   and recurring dues; a date-less due travels as `{ string }` alone.
 * - move: server honors an explicit `child_order` (undo restores the captured pre-move
 *   position; omitted = append) and requires ≥1 of project_id/section_id/parent_id.
 * - delete: DELETE is a soft delete and Task B landed POST /tasks/{id}/restore (subtree
 *   cascade), so undo-delete restores the task under its ORIGINAL id via `restoreEntity`.
 * - complete: a recurring occurrence advances the due and stays open (no completed_at), and the
 *   reopen route 409s on it — so a recurring completion undoes by restoring the pre-advance due;
 *   a final completion (one-off / series end / exhausted recurrence) undoes via reopen.
 * - POST /tasks/quick auto-creates unknown #project/@label — it invalidates projects + labels too.
 *
 * Silent flag: inverse ops set `silent: true` so they never push a fresh undo entry (no
 * undo-of-undo) and, being user-invisible, stay quiet on error — the undo host surfaces the
 * failure. Forward ops (and the flag-less reopen/create) toast their own errors.
 */

import { dateInTz } from '@opentask/core'
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useRef } from 'react'
import { z } from 'zod'
import { useUndoStore } from '@/features/undo/store'
import { restoreEntity } from '@/lib/api/phase5'
import { formatDueChip } from '@/lib/format-date'
import { useParseCtx } from '@/lib/parse-context'
import { toast } from '@/stores/toasts'
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
} from '../cache-updates'
import { type ApiError, api, apiAllPages, apiVoid, endpoints } from '../client'
import { qk } from '../keys'
import {
  type Project,
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
  move: (v: { id: string; to: TaskMove; silent?: boolean }) => Promise<void>
}

export function useTaskMutations(): TaskMutations {
  const qc = useQueryClient()
  const ctx = useParseCtx()
  const inverses = useRef<Inverses | null>(null)

  const invalidateTasks = (): void => {
    void qc.invalidateQueries({ queryKey: qk.tasks })
  }
  /** After an undo, converge every view: tasks + project/section counts and membership. */
  const invalidateAffected = (): void => {
    void qc.invalidateQueries({ queryKey: qk.tasks })
    void qc.invalidateQueries({ queryKey: qk.projects })
    void qc.invalidateQueries({ queryKey: qk.sections })
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
      const next = vars.patch.due
      const label =
        next === null
          ? 'no date'
          : formatDueChip({ date: next.date, time: next.time }, dateInTz(ctx.now, ctx.timezone))
              .label
      useUndoStore.getState().push({
        message: `Rescheduled to ${label}`,
        // Restore the FULL previous due (serializeBody re-forms it for the server): the exact
        // date/time AND the natural-language `string` round-trip verbatim; a recurring phrase
        // is re-parsed for its spec while the explicit date pins the restored occurrence.
        undo: async () => {
          await inverses.current?.update({ id: vars.id, patch: { due: prevDue }, silent: true })
          invalidateAffected()
        },
      })
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
    onSuccess: (_data, vars, context) => {
      if (vars.silent) return
      const { id } = vars
      const prevDue = findTask(context?.prev, id)?.due ?? null
      // A recurring occurrence stays in the active cache (its due was advanced); a final
      // completion (one-off, series end, or an exhausted recurrence) was dropped by applyClose.
      // reopen 409s on the still-open recurring row, so that path restores the pre-advance due
      // instead — its `string` carries the recurrence for the server to re-parse.
      const advanced = findTask(qc.getQueryData<Task[]>(qk.tasks), id) !== undefined
      useUndoStore.getState().push({
        message: 'Task completed',
        undo: async () => {
          if (advanced) {
            await inverses.current?.update({ id, patch: { due: prevDue }, silent: true })
          } else {
            // reopen has no silent flag → it surfaces its own error toast; swallow the rejection
            // so the undo host does not double-toast the same failure.
            await inverses.current?.reopen({ id }).catch(noop)
          }
          invalidateAffected()
        },
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
      const { id } = vars
      if (findTask(context?.prev, id) === undefined) return
      useUndoStore.getState().push({
        message: 'Task deleted',
        // AS-BUILT: DELETE soft-deletes; POST /tasks/{id}/restore (Task B) un-deletes the task
        // and its whole soft-deleted subtree under the ORIGINAL id — no recreate, no id churn.
        undo: async () => {
          await restoreEntity('tasks', id)
          invalidateAffected()
        },
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
      const destId = vars.to.project_id ?? prevTask.project_id
      const destName =
        (qc.getQueryData<Project[]>(qk.projects) ?? []).find((p) => p.id === destId)?.name ??
        'project'
      useUndoStore.getState().push({
        message: `Moved to ${destName}`,
        undo: async () => {
          await inverses.current?.move({ id: vars.id, to, silent: true })
          invalidateAffected()
        },
      })
    },
    onSettled: invalidateTasks,
  })

  // Populate the inverse-op refs synchronously each render so undo closures (which fire only
  // after a network round-trip) always see the latest, mounted mutateAsync fns.
  inverses.current = {
    update: update.mutateAsync,
    reopen: reopen.mutateAsync,
    move: move.mutateAsync,
  }

  return { quickAdd, create, update, close, reopen, remove, move }
}

function noop(): void {}
