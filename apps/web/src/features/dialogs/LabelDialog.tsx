/**
 * `LabelDialog` (plan Task E) — create/edit a label. Rendered unconditionally by `DialogHost`;
 * shows only while the dialog store's open request is `{ kind: 'label' }`. Reuses the phase-4
 * `useLabelMutations` create/update mutations (server enforces a unique name → 409, surfaced
 * inline). Favorite-on-create is a best-effort follow-up PATCH so it can never block the close
 * or risk a duplicate-name re-create on retry.
 */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, apiAllPages, endpoints } from '@/api/client'
import { useLabelMutations } from '@/api/hooks/labels'
import { qk } from '@/api/keys'
import { type Label, LabelSchema } from '@/api/schemas'
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
import { useDialogStore } from './store'

export default function LabelDialog() {
  const request = useDialogStore((s) => (s.open?.kind === 'label' ? s.open : null))
  const close = useDialogStore((s) => s.close)
  const editing = request?.mode === 'edit'

  // Only edit mode needs the label row; it is normally already in the ['labels'] cache.
  const labelsQuery = useQuery({
    queryKey: qk.labels,
    queryFn: () => apiAllPages(endpoints.labels, LabelSchema),
    enabled: Boolean(editing),
    staleTime: 30_000,
  })
  const existing =
    editing && request ? (labelsQuery.data?.find((l) => l.id === request.labelId) ?? null) : null
  const ready = request !== null && (editing ? existing !== null : true)

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      {request && (
        <DialogContent className="w-full max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit label' : 'Add label'}</DialogTitle>
          </DialogHeader>
          {ready ? (
            <LabelForm
              key={editing ? `edit:${request.labelId}` : 'create'}
              existing={existing}
              onDone={close}
            />
          ) : (
            <div className="py-10 text-center text-copy text-text-tertiary">Loading label…</div>
          )}
        </DialogContent>
      )}
    </Dialog>
  )
}

function LabelForm({ existing, onDone }: { existing: Label | null; onDone: () => void }) {
  const { create, update } = useLabelMutations()
  const [name, setName] = useState(existing?.name ?? '')
  const [color, setColor] = useState<ProjectColor>((existing?.color as ProjectColor) ?? 'charcoal')
  const [favorite, setFavorite] = useState(existing?.is_favorite ?? false)
  const [formError, setFormError] = useState<string | null>(null)

  const pending = create.isPending || update.isPending
  const canSave = name.trim() !== '' && !pending

  const submit = async () => {
    setFormError(null)
    const trimmed = name.trim()
    try {
      if (existing) {
        await update.mutateAsync({
          id: existing.id,
          patch: { name: trimmed, color, is_favorite: favorite },
        })
      } else {
        const created = await create.mutateAsync({ name: trimmed, color })
        if (favorite) {
          // The label exists now; favouriting is best-effort — a failure here must not block
          // the close, nor risk a duplicate-name re-create if the user retries.
          try {
            await update.mutateAsync({ id: created.id, patch: { is_favorite: true } })
          } catch {
            // ignore — the label was created successfully
          }
        }
      }
      onDone()
    } catch (error) {
      setFormError(
        error instanceof ApiError
          ? (error.problem.detail ?? error.problem.title ?? error.message)
          : 'Could not save the label. Please try again.',
      )
    }
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSave) void submit()
      }}
    >
      <div className="grid gap-1.5">
        <label htmlFor="label-name" className="font-medium text-caption text-text-secondary">
          Name
        </label>
        <Input
          id="label-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Label name"
        />
      </div>

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
        <Button type="submit" disabled={!canSave}>
          {existing ? 'Save changes' : 'Add label'}
        </Button>
      </DialogFooter>
    </form>
  )
}
