/**
 * Labels section of the Filters & Labels page (Task D). Reads through phase 4's `useLabels`
 * (shared `qk.labels` cache, so the sidebar stays in sync), but layers its own OPTIMISTIC
 * favorite/reorder/delete mutations — phase 4's `useLabelMutations` only invalidates on
 * settle, and the plan requires an optimistic star + drag. Create/edit go to Task E's
 * `LabelDialog` via the dialog store; delete pushes a recreate-undo (no label restore route).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { type ApiError, api, apiVoid, endpoints } from '@/api/client'
import { useLabels } from '@/api/hooks/labels'
import { qk } from '@/api/keys'
import { type Label, LabelSchema } from '@/api/schemas'
import { useDialogStore } from '@/features/dialogs/store'
import { useUndoStore } from '@/features/undo/store'
import { reorderLabels } from '@/lib/api/phase5'
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  SortableContext,
  useAppSensors,
  verticalListSortingStrategy,
} from '@/lib/dnd'
import { applyOrder, byItemOrder, labelToCreate, reorderIds } from './model'
import {
  DeleteConfirmDialog,
  EmptyState,
  ListSkeleton,
  ROW_LINK_CLASS,
  SectionHeader,
  SortableRow,
} from './SortableRow'

interface OptimisticCtx {
  prev: Label[] | undefined
}

function useLabelListMutations() {
  const qc = useQueryClient()
  const snapshot = async (): Promise<OptimisticCtx> => {
    await qc.cancelQueries({ queryKey: qk.labels })
    return { prev: qc.getQueryData<Label[]>(qk.labels) }
  }
  const rollback = (_e: ApiError, _v: unknown, ctx: OptimisticCtx | undefined): void => {
    if (ctx?.prev) qc.setQueryData(qk.labels, ctx.prev)
  }
  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: qk.labels })
  }

  const toggleFavorite = useMutation<
    Label,
    ApiError,
    { id: string; is_favorite: boolean },
    OptimisticCtx
  >({
    mutationFn: ({ id, is_favorite }) =>
      api(endpoints.label(id), { method: 'PATCH', body: { is_favorite }, schema: LabelSchema }),
    onMutate: async ({ id, is_favorite }) => {
      const ctx = await snapshot()
      qc.setQueryData<Label[]>(qk.labels, (list) =>
        list?.map((l) => (l.id === id ? { ...l, is_favorite } : l)),
      )
      return ctx
    },
    onError: rollback,
    onSettled: invalidate,
  })

  const reorder = useMutation<void, ApiError, string[], OptimisticCtx>({
    mutationFn: (orderedIds) => reorderLabels(orderedIds),
    onMutate: async (orderedIds) => {
      const ctx = await snapshot()
      qc.setQueryData<Label[]>(qk.labels, (list) => (list ? applyOrder(list, orderedIds) : list))
      return ctx
    },
    onError: rollback,
    onSettled: invalidate,
  })

  const remove = useMutation<void, ApiError, Label, OptimisticCtx>({
    mutationFn: (label) => apiVoid(endpoints.label(label.id), { method: 'DELETE' }),
    onMutate: async (label) => {
      const ctx = await snapshot()
      qc.setQueryData<Label[]>(qk.labels, (list) => list?.filter((l) => l.id !== label.id))
      return ctx
    },
    onError: rollback,
    onSuccess: (_v, label) => {
      useUndoStore.getState().push({
        message: 'Label deleted',
        undo: async () => {
          await api(endpoints.labels, {
            method: 'POST',
            body: labelToCreate(label),
            schema: LabelSchema,
          })
          await qc.invalidateQueries({ queryKey: qk.labels })
        },
      })
    },
    onSettled: invalidate,
  })

  return { toggleFavorite, reorder, remove }
}

export function LabelList() {
  const { data: labels = [], isPending } = useLabels()
  const { toggleFavorite, reorder, remove } = useLabelListMutations()
  const openDialog = useDialogStore((s) => s.openDialog)
  const sensors = useAppSensors()
  const [confirm, setConfirm] = useState<Label | null>(null)

  const ordered = byItemOrder(labels)
  const ids = ordered.map((l) => l.id)

  const onDragEnd = (event: DragEndEvent): void => {
    const activeId = String(event.active.id)
    const overId = event.over ? String(event.over.id) : null
    if (overId === null || overId === activeId) return
    const next = reorderIds(ids, activeId, overId)
    if (next.length === ids.length && next.every((id, i) => id === ids[i])) return
    reorder.mutate(next)
  }

  return (
    <section className="mb-10">
      <SectionHeader
        title="Labels"
        addLabel="Add label"
        onAdd={() => openDialog({ kind: 'label', mode: 'create' })}
      />
      {isPending ? (
        <ListSkeleton />
      ) : ordered.length === 0 ? (
        <EmptyState>
          No labels yet — labels tag tasks so you can group them across projects.
        </EmptyState>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="border-border-subtle border-t">
              {ordered.map((label) => (
                <SortableRow
                  key={label.id}
                  id={label.id}
                  name={label.name}
                  color={label.color}
                  isFavorite={label.is_favorite}
                  entityLabel="label"
                  onToggleFavorite={() =>
                    toggleFavorite.mutate({ id: label.id, is_favorite: !label.is_favorite })
                  }
                  onEdit={() => openDialog({ kind: 'label', mode: 'edit', labelId: label.id })}
                  onDelete={() => setConfirm(label)}
                >
                  <Link
                    to="/label/$labelId"
                    params={{ labelId: label.id }}
                    className={ROW_LINK_CLASS}
                  >
                    {label.name}
                  </Link>
                </SortableRow>
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      <DeleteConfirmDialog
        item={confirm}
        entityLabel="label"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) remove.mutate(confirm)
          setConfirm(null)
        }}
      />
    </section>
  )
}
