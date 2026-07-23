/**
 * `FilterDialog` (plan Task E) — create/edit a saved filter. Rendered unconditionally by
 * `DialogHost`; shows only while the dialog store's open request is `{ kind: 'filter' }`.
 * Name + query are required and the query must parse (via `QueryEditor`) before Save enables.
 * No phase-4 filters hook exists, so create/update POST/PATCH `/filters` inline (the server
 * re-validates the query and 409s are surfaced inline) and invalidate the `['filters']` cache.
 */
import { parseFilter } from '@opentask/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import { ApiError, api, apiAllPages } from '@/api/client'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ColorPicker, type ProjectColor } from './ColorPicker'
import { QueryEditor } from './QueryEditor'
import { useDialogStore } from './store'
import { useAllTasks } from './useAllTasks'

const FilterDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  query: z.string(),
  color: z.string(),
  item_order: z.number().int(),
  is_favorite: z.boolean(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})
type FilterDto = z.infer<typeof FilterDtoSchema>

const FILTERS_KEY = ['filters'] as const

export default function FilterDialog() {
  const request = useDialogStore((s) => (s.open?.kind === 'filter' ? s.open : null))
  const close = useDialogStore((s) => s.close)
  const editing = request?.mode === 'edit'

  // Only edit mode needs the filter row; it is normally already in the ['filters'] cache.
  const filtersQuery = useQuery({
    queryKey: FILTERS_KEY,
    queryFn: () => apiAllPages('/filters', FilterDtoSchema),
    enabled: Boolean(editing),
    staleTime: 30_000,
  })
  const existing =
    editing && request ? (filtersQuery.data?.find((f) => f.id === request.filterId) ?? null) : null
  const ready = request !== null && (editing ? existing !== null : true)

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      {request && (
        <DialogContent className="w-full max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit filter' : 'Add filter'}</DialogTitle>
          </DialogHeader>
          {ready ? (
            <FilterForm
              key={editing ? `edit:${request.filterId}` : 'create'}
              existing={existing}
              onDone={close}
            />
          ) : (
            <div className="py-10 text-center text-copy text-text-tertiary">Loading filter…</div>
          )}
        </DialogContent>
      )}
    </Dialog>
  )
}

function FilterForm({ existing, onDone }: { existing: FilterDto | null; onDone: () => void }) {
  const queryClient = useQueryClient()
  const { tasks, ctx } = useAllTasks()
  const [name, setName] = useState(existing?.name ?? '')
  const [query, setQuery] = useState(existing?.query ?? '')
  const [color, setColor] = useState<ProjectColor>((existing?.color as ProjectColor) ?? 'charcoal')
  const [favorite, setFavorite] = useState(existing?.is_favorite ?? false)
  const [formError, setFormError] = useState<string | null>(null)

  // Cheap, synchronous validity for gating Save (QueryEditor debounces the richer preview).
  const queryValid = useMemo(() => {
    if (query.trim() === '') return false
    try {
      parseFilter(query)
      return true
    } catch {
      return false
    }
  }, [query])
  const canSave = name.trim() !== '' && queryValid

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), query: query.trim(), color, is_favorite: favorite }
      return existing
        ? api(`/filters/${existing.id}`, { method: 'PATCH', body, schema: FilterDtoSchema })
        : api('/filters', { method: 'POST', body, schema: FilterDtoSchema })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FILTERS_KEY })
      onDone()
    },
    onError: (error) => {
      setFormError(
        error instanceof ApiError
          ? (error.problem.detail ?? error.problem.title ?? error.message)
          : 'Could not save the filter. Please try again.',
      )
    },
  })

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSave && !save.isPending) save.mutate()
      }}
    >
      <div className="grid gap-1.5">
        <label htmlFor="filter-name" className="font-medium text-caption text-text-secondary">
          Name
        </label>
        <Input
          id="filter-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Filter name"
        />
      </div>

      <QueryEditor id="filter-query" value={query} onChange={setQuery} tasks={tasks} ctx={ctx} />

      <div className="grid gap-2">
        <span className="font-medium text-caption text-text-secondary">Color</span>
        <ColorPicker value={color} onChange={setColor} />
      </div>

      <div className="flex items-center justify-between gap-4">
        <span className="text-body text-text-primary">Add to favorites</span>
        <Switch checked={favorite} onCheckedChange={setFavorite} aria-label="Add to favorites" />
      </div>

      {formError !== null && (
        <p role="alert" className="text-caption text-danger">
          {formError}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave || save.isPending}>
          {existing ? 'Save changes' : 'Add filter'}
        </Button>
      </DialogFooter>
    </form>
  )
}
