/**
 * Filters section of the Filters & Labels page (Task D). The read + wire schema come from
 * Task J's shared `@/api/hooks/filters` (the sidebar Favorites use the same `['filters']`
 * cache); this file layers the OPTIMISTIC favorite/reorder/delete mutations over the frozen
 * `@/api/client` transport. Create/edit are delegated to Task E's `FilterDialog` via the dialog
 * store; delete pushes a recreate-undo onto the phase-5 undo store (no filter restore route).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { type ApiError, api, apiVoid } from '@/api/client'
import { type Filter, FilterSchema, useFilters } from '@/api/hooks/filters'
import { useDialogStore } from '@/features/dialogs/store'
import { useUndoStore } from '@/features/undo/store'
import { reorderFilters } from '@/lib/api/phase5'
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  SortableContext,
  useAppSensors,
  verticalListSortingStrategy,
} from '@/lib/dnd'
import { applyOrder, byItemOrder, filterToCreate, reorderIds } from './model'
import {
  DeleteConfirmDialog,
  EmptyState,
  ListSkeleton,
  ROW_LINK_CLASS,
  SectionHeader,
  SortableRow,
} from './SortableRow'

/** Same key Task J's `useFilters` reads and the SSE handler reserved (api/sse.ts `case 'filter'`). */
const FILTERS_KEY = ['filters'] as const

interface OptimisticCtx {
  prev: Filter[] | undefined
}

/** Optimistic filter mutations that all write the `['filters']` cache and rollback on error. */
function useFilterMutations() {
  const qc = useQueryClient()
  const snapshot = async (): Promise<OptimisticCtx> => {
    await qc.cancelQueries({ queryKey: FILTERS_KEY })
    return { prev: qc.getQueryData<Filter[]>(FILTERS_KEY) }
  }
  const rollback = (_e: ApiError, _v: unknown, ctx: OptimisticCtx | undefined): void => {
    if (ctx?.prev) qc.setQueryData(FILTERS_KEY, ctx.prev)
  }
  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: FILTERS_KEY })
  }

  const toggleFavorite = useMutation<
    Filter,
    ApiError,
    { id: string; is_favorite: boolean },
    OptimisticCtx
  >({
    mutationFn: ({ id, is_favorite }) =>
      api(`/filters/${id}`, { method: 'PATCH', body: { is_favorite }, schema: FilterSchema }),
    onMutate: async ({ id, is_favorite }) => {
      const ctx = await snapshot()
      qc.setQueryData<Filter[]>(FILTERS_KEY, (list) =>
        list?.map((f) => (f.id === id ? { ...f, is_favorite } : f)),
      )
      return ctx
    },
    onError: rollback,
    onSettled: invalidate,
  })

  const reorder = useMutation<void, ApiError, string[], OptimisticCtx>({
    mutationFn: (orderedIds) => reorderFilters(orderedIds),
    onMutate: async (orderedIds) => {
      const ctx = await snapshot()
      qc.setQueryData<Filter[]>(FILTERS_KEY, (list) => (list ? applyOrder(list, orderedIds) : list))
      return ctx
    },
    onError: rollback,
    onSettled: invalidate,
  })

  const remove = useMutation<void, ApiError, Filter, OptimisticCtx>({
    mutationFn: (filter) => apiVoid(`/filters/${filter.id}`, { method: 'DELETE' }),
    onMutate: async (filter) => {
      const ctx = await snapshot()
      qc.setQueryData<Filter[]>(FILTERS_KEY, (list) => list?.filter((f) => f.id !== filter.id))
      return ctx
    },
    onError: rollback,
    onSuccess: (_v, filter) => {
      useUndoStore.getState().push({
        message: 'Filter deleted',
        undo: async () => {
          await api('/filters', {
            method: 'POST',
            body: filterToCreate(filter),
            schema: FilterSchema,
          })
          await qc.invalidateQueries({ queryKey: FILTERS_KEY })
        },
      })
    },
    onSettled: invalidate,
  })

  return { toggleFavorite, reorder, remove }
}

export function FilterList() {
  const { data: filters = [], isPending } = useFilters()
  const { toggleFavorite, reorder, remove } = useFilterMutations()
  const openDialog = useDialogStore((s) => s.openDialog)
  const sensors = useAppSensors()
  const [confirm, setConfirm] = useState<Filter | null>(null)

  const ordered = byItemOrder(filters)
  const ids = ordered.map((f) => f.id)

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
        title="Filters"
        addLabel="Add filter"
        onAdd={() => openDialog({ kind: 'filter', mode: 'create' })}
      />
      {isPending ? (
        <ListSkeleton />
      ) : ordered.length === 0 ? (
        <EmptyState>
          No filters yet — filters are saved searches you can pin to the sidebar.
        </EmptyState>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="border-border-subtle border-t">
              {ordered.map((filter) => (
                <SortableRow
                  key={filter.id}
                  id={filter.id}
                  name={filter.name}
                  color={filter.color}
                  isFavorite={filter.is_favorite}
                  entityLabel="filter"
                  onToggleFavorite={() =>
                    toggleFavorite.mutate({ id: filter.id, is_favorite: !filter.is_favorite })
                  }
                  onEdit={() => openDialog({ kind: 'filter', mode: 'edit', filterId: filter.id })}
                  onDelete={() => setConfirm(filter)}
                >
                  <Link
                    to="/filter/$filterId"
                    params={{ filterId: filter.id }}
                    className={ROW_LINK_CLASS}
                  >
                    {filter.name}
                  </Link>
                </SortableRow>
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      <DeleteConfirmDialog
        item={confirm}
        entityLabel="filter"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) remove.mutate(confirm)
          setConfirm(null)
        }}
      />
    </section>
  )
}
