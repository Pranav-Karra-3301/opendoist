/**
 * Ramble review-confirm dialog (plan Task K). Mounted once at the app root; opens when the
 * ramble UI store flips `reviewOpen` (set by the mic button after a successful upload).
 *
 * It drives entirely off `useRamble(activeRambleId)`, which self-polls while the server-side
 * pipeline runs (`uploaded` → `transcribed`) and stops once it reaches a terminal state. Each
 * status renders a distinct surface: a spinner while transcribing/extracting, an error + retry
 * card on `failed`, and the editable task list on `extracted`. Confirming sends the EDITED rows
 * to `POST /rambles/:id/confirm`, which creates real tasks through the same service as Quick Add
 * and deletes the audio. Closing (Esc / backdrop / ✕) is a plain dismiss — the ramble stays in
 * `extracted` and remains reachable, so no work is lost.
 */
import { AlertTriangle, CircleCheck, Loader2, Plus } from 'lucide-react'
import { type ReactElement, useEffect, useState } from 'react'
import type { ExtractedTask } from '@/api/rambles'
import { useConfirmRamble, useDiscardRamble, useRamble, useRetryStage } from '@/api/rambles'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useParseCtx } from '@/lib/parse-context'
import { useRambleStore } from '@/ramble/store'
import { toast } from '@/stores/toasts'
import { RambleReviewRow } from './RambleReviewRow'

/** Editable row = a draft task plus a stable client key (extracted tasks have no server id, and
 *  index keys would mis-reconcile popover/focus state across add/remove). */
interface Row {
  key: string
  task: ExtractedTask
}

function emptyTask(): ExtractedTask {
  return { title: '', notes: null, due: null, priority: null, labels: [] }
}

function toRow(task: ExtractedTask): Row {
  return { key: crypto.randomUUID(), task }
}

/** Vertically centred spinner used by the in-flight pipeline states. */
function StageSpinner({ label }: { label: string }): ReactElement {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 px-5 py-10 text-center">
      <Loader2 size={28} className="animate-spin text-accent" aria-hidden />
      <p className="text-body text-text-secondary">{label}</p>
    </div>
  )
}

/** Collapsible transcript shown above the task list. */
function Transcript({ text }: { text: string }): ReactElement {
  return (
    <details className="rounded-sm border border-border-subtle bg-surface px-3 py-2">
      <summary className="cursor-pointer select-none text-copy text-text-secondary outline-none focus-visible:underline">
        Transcript
      </summary>
      <p className="mt-2 whitespace-pre-wrap text-copy text-text-secondary">{text}</p>
    </details>
  )
}

function ReviewBody({
  rambleId,
  onClose,
}: {
  rambleId: string
  onClose: () => void
}): ReactElement {
  const { data: ramble, isLoading } = useRamble(rambleId)
  const ctx = useParseCtx()
  const retry = useRetryStage()
  const confirm = useConfirmRamble()
  const discard = useDiscardRamble()
  const [rows, setRows] = useState<Row[] | null>(null)

  // Seed the editable rows once, when extraction first completes. Guarded on `rows === null`
  // so re-renders (or a late poll) never clobber the user's edits.
  useEffect(() => {
    if (ramble?.status === 'extracted' && rows === null) {
      setRows((ramble.extractedTasks ?? []).map(toRow))
    }
  }, [ramble?.status, ramble?.extractedTasks, rows])

  // Fallback auto-close if we ever observe an already-confirmed ramble (the confirm handler
  // normally closes first). Effect owns the timer so it is always cleared.
  useEffect(() => {
    if (ramble?.status !== 'confirmed') return
    const timer = setTimeout(onClose, 1200)
    return () => clearTimeout(timer)
  }, [ramble?.status, onClose])

  const updateRow = (key: string, next: ExtractedTask): void =>
    setRows((prev) => prev?.map((r) => (r.key === key ? { key, task: next } : r)) ?? prev)
  const removeRow = (key: string): void =>
    setRows((prev) => prev?.filter((r) => r.key !== key) ?? prev)
  const addRow = (): void => setRows((prev) => [...(prev ?? []), toRow(emptyTask())])

  const handleDiscard = (): void => {
    discard.mutate(rambleId)
    onClose()
  }

  const handleRetry = async (): Promise<void> => {
    if (!ramble?.failedStage) return
    try {
      const after = await retry.mutateAsync({ id: rambleId, stage: ramble.failedStage })
      // A retried transcribe lands on `transcribed`; continue into extraction so the pipeline
      // reaches a reviewable state (the initial upload auto-chains server-side; a manual retry
      // does not, so we chain it here).
      if (after.status === 'transcribed') {
        await retry.mutateAsync({ id: rambleId, stage: 'extract' })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Retry failed')
    }
  }

  const handleConfirm = async (): Promise<void> => {
    if (rows === null) return
    try {
      const res = await confirm.mutateAsync({ id: rambleId, tasks: rows.map((r) => r.task) })
      const n = res.createdTaskIds.length
      toast.info(`${n} ${n === 1 ? 'task' : 'tasks'} added`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add tasks')
    }
  }

  // ---- loading / in-flight ------------------------------------------------
  if (isLoading || !ramble) return <StageSpinner label="Loading…" />
  if (ramble.status === 'uploaded') return <StageSpinner label="Transcribing…" />
  if (ramble.status === 'transcribed') return <StageSpinner label="Extracting tasks…" />

  // ---- confirmed (fallback success) --------------------------------------
  if (ramble.status === 'confirmed') {
    return (
      <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 px-5 py-10 text-center">
        <CircleCheck size={28} className="text-accent" aria-hidden />
        <p className="text-body text-text-secondary">Tasks added</p>
      </div>
    )
  }

  // ---- failed -------------------------------------------------------------
  if (ramble.status === 'failed') {
    const stageLabel = ramble.failedStage === 'extract' ? 'extract tasks' : 'transcribe audio'
    return (
      <>
        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <AlertTriangle size={28} className="text-danger" aria-hidden />
            <p className="text-body text-text-primary">Couldn&rsquo;t {stageLabel}</p>
            {ramble.error !== null && (
              <p className="max-w-[380px] text-copy text-text-secondary">{ramble.error}</p>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-border border-t px-5 py-3">
          <Button variant="ghost" onClick={handleDiscard} disabled={discard.isPending}>
            Discard
          </Button>
          <Button onClick={() => void handleRetry()} disabled={retry.isPending}>
            {retry.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
            Retry
          </Button>
        </div>
      </>
    )
  }

  // ---- extracted → review list -------------------------------------------
  if (rows === null) return <StageSpinner label="Preparing tasks…" />

  const canConfirm =
    rows.length > 0 && rows.every((r) => r.task.title.trim() !== '') && !confirm.isPending

  return (
    <>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 py-4">
        {ramble.transcript !== null && ramble.transcript.trim() !== '' && (
          <Transcript text={ramble.transcript} />
        )}
        {rows.length === 0 && (
          <p className="px-1 py-2 text-copy text-text-tertiary">
            No tasks were found in this note. Add one below, or discard it.
          </p>
        )}
        {rows.map((row, index) => (
          <RambleReviewRow
            key={row.key}
            task={row.task}
            index={index}
            ctx={ctx}
            onChange={(next) => updateRow(row.key, next)}
            onRemove={() => removeRow(row.key)}
          />
        ))}
        <button
          type="button"
          onClick={addRow}
          className="flex h-9 items-center gap-2 rounded-sm border border-border-subtle border-dashed px-3 text-copy text-text-secondary outline-none transition-colors duration-150 hover:bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]"
        >
          <Plus size={16} aria-hidden />
          Add task
        </button>
      </div>
      <div className="flex items-center justify-between gap-3 border-border border-t px-5 py-3">
        <span className="text-copy text-text-tertiary">
          {rows.length} {rows.length === 1 ? 'task' : 'tasks'}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={handleDiscard} disabled={discard.isPending}>
            Discard
          </Button>
          <Button onClick={() => void handleConfirm()} disabled={!canConfirm}>
            {confirm.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
            Add {rows.length} {rows.length === 1 ? 'task' : 'tasks'}
          </Button>
        </div>
      </div>
    </>
  )
}

export function RambleReview(): ReactElement {
  const reviewOpen = useRambleStore((s) => s.reviewOpen)
  const activeRambleId = useRambleStore((s) => s.activeRambleId)
  const closeReview = useRambleStore((s) => s.closeReview)

  return (
    <Dialog
      open={reviewOpen}
      onOpenChange={(open) => {
        if (!open) closeReview()
      }}
    >
      <DialogContent className="grid max-h-[85vh] w-[min(640px,92vw)] max-w-[min(640px,92vw)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0">
        <div className="border-border border-b px-5 py-4">
          <DialogTitle>Review voice note</DialogTitle>
          <DialogDescription className="sr-only">
            Review and edit the tasks found in your voice note, then add them. Closing this dialog
            keeps the note so you can finish reviewing it later.
          </DialogDescription>
        </div>
        {activeRambleId !== null ? (
          <ReviewBody key={activeRambleId} rambleId={activeRambleId} onClose={closeReview} />
        ) : (
          <div />
        )}
      </DialogContent>
    </Dialog>
  )
}
