/**
 * Backups settings (phase 9, Task I) — real wiring over the phase-9 backups API.
 *
 * Sections:
 *  - Snapshots: `GET /api/v1/backups` list + per-row download link, and a "Back up now"
 *    button (`POST /api/v1/backups`).
 *  - Backup settings: retention (`OPENDOIST_BACKUP_RETENTION` default) and a tri-state
 *    include-attachments override, both PATCHed to `/api/v1/backups/settings`.
 *  - Restore: upload an OpenDoist backup .zip with a type-to-confirm dialog, an XHR upload
 *    (so we can show progress), a full-page blocking overlay while the server swaps the DB
 *    under its maintenance lock, then a success dialog that reloads the app. Any transient
 *    503s other queries hit during the lock resolve on that reload.
 *  - Export: inert download links to the phase-9 export endpoints (Task P).
 *
 * Pure helpers (formatting, view state, retention parsing, confirm gate) live in
 * `./backups-logic` so their Vitest suite runs under the repo's node environment.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  Clock,
  DatabaseBackup,
  Download,
  FileArchive,
  FileJson,
  Hand,
  Loader2,
  Paperclip,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ApiError, api } from '@/api/client'
import { paginated } from '@/api/schemas'
import { EmptyState } from '@/components/feedback'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/toasts'
import { SettingRow, SettingsSection } from '../ui'
import {
  type BackupInfo,
  BackupInfoSchema,
  type BackupKind,
  type BackupSettingsDto,
  BackupSettingsDtoSchema,
  type BackupSettingsPatch,
  backupDownloadHref,
  backupKindLabel,
  confirmMatchesRestore,
  formatBackupSize,
  formatBackupTimestamp,
  formatRelativeTime,
  parseRetentionInput,
  RETENTION_MAX,
  RETENTION_MIN,
  resolveBackupsView,
} from './backups-logic'

const BACKUPS_ENDPOINT = '/backups'
const SETTINGS_ENDPOINT = '/backups/settings'
const RESTORE_URL = '/api/v1/backups/restore'
const BackupListSchema = paginated(BackupInfoSchema)

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BackupsPage() {
  return (
    <div className="flex max-w-2xl flex-col">
      <SnapshotsSection />
      <BackupSettingsSection />
      <RestoreSection />
      <ExportSection />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Snapshots (list + back up now)
// ---------------------------------------------------------------------------

function SnapshotsSection() {
  const queryClient = useQueryClient()
  const query = useQuery<BackupInfo[], Error>({
    queryKey: ['backups'],
    queryFn: async () => (await api(BACKUPS_ENDPOINT, { schema: BackupListSchema })).results,
    staleTime: 30_000,
  })
  const backupNow = useMutation({
    mutationFn: () => api(BACKUPS_ENDPOINT, { method: 'POST', schema: BackupInfoSchema }),
    onSuccess: () => {
      toast.info('Backup created')
      void queryClient.invalidateQueries({ queryKey: ['backups'] })
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Could not create a backup.'),
  })

  const view = resolveBackupsView({
    isLoading: query.isLoading,
    isError: query.isError,
    data: query.data,
    errorMessage: query.error?.message,
  })

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="mb-1 font-medium text-subtitle text-text-primary">Snapshots</h2>
          <p className="max-w-prose text-copy text-text-secondary">
            OpenDoist takes a nightly snapshot of your database and keeps the most recent copies so
            you can download or restore them.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => backupNow.mutate()}
          disabled={backupNow.isPending}
          aria-busy={backupNow.isPending}
          className="shrink-0"
        >
          {backupNow.isPending ? (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          ) : (
            <DatabaseBackup size={16} aria-hidden="true" />
          )}
          {backupNow.isPending ? 'Backing up…' : 'Back up now'}
        </Button>
      </div>

      {view.kind === 'loading' ? <ListSkeleton /> : null}
      {view.kind === 'empty' ? (
        <EmptyState
          icon={Archive}
          title="No backups yet"
          description="Snapshots are written as a nightly VACUUM INTO of your database. Use “Back up now” to create one immediately."
          action={{ label: 'Back up now', onClick: () => backupNow.mutate() }}
        />
      ) : null}
      {view.kind === 'error' ? (
        <ErrorCard message={view.message} onRetry={() => void query.refetch()} />
      ) : null}
      {view.kind === 'list' ? <BackupsTable backups={view.backups} /> : null}
    </section>
  )
}

function KindBadge({ kind }: { kind: BackupKind }) {
  const meta = {
    scheduled: { Icon: Clock, tone: 'text-info' },
    manual: { Icon: Hand, tone: 'text-accent' },
    pre_restore: { Icon: ShieldCheck, tone: 'text-warning' },
  }[kind]
  const { Icon, tone } = meta
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-sm border border-border bg-surface px-1.5 py-0.5 text-caption text-text-secondary">
      <Icon size={12} className={cn('shrink-0', tone)} aria-hidden="true" />
      {backupKindLabel(kind)}
    </span>
  )
}

function BackupsTable({ backups }: { backups: BackupInfo[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface-raised">
      <table className="w-full min-w-[38rem] text-left text-copy">
        <thead>
          <tr className="border-border border-b text-caption text-text-tertiary">
            <th scope="col" className="px-4 py-2 font-medium">
              Name
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Kind
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Size
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Created
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {backups.map((backup) => (
            <BackupRow key={backup.id} backup={backup} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BackupRow({ backup }: { backup: BackupInfo }) {
  return (
    <tr className="text-text-primary">
      <td className="max-w-0 px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 truncate font-mono text-caption">{backup.filename}</span>
          {backup.includesAttachments ? (
            <Paperclip
              size={13}
              className="shrink-0 text-text-tertiary"
              aria-label="Includes attachments"
            />
          ) : null}
        </div>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5">
        <KindBadge kind={backup.kind} />
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-text-secondary tabular-nums">
        {formatBackupSize(backup.sizeBytes)}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-text-secondary">
        <span title={formatBackupTimestamp(backup.createdAt)}>
          {formatRelativeTime(backup.createdAt)}
        </span>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center justify-end">
          <a
            href={backupDownloadHref(backup.filename)}
            download
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
          >
            <Download size={16} aria-hidden="true" />
            Download
          </a>
        </div>
      </td>
    </tr>
  )
}

function ListSkeleton() {
  return (
    <div className="flex items-center justify-center rounded-lg border border-border bg-surface-raised py-12 text-text-tertiary">
      <Loader2 size={20} className="animate-spin" aria-label="Loading backups" />
    </div>
  )
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface-raised px-6 py-12 text-center">
      <TriangleAlert size={24} strokeWidth={1.75} className="text-danger" aria-hidden="true" />
      <div className="font-medium text-body text-text-primary">Couldn't load backups</div>
      <p className="max-w-prose text-copy text-text-secondary">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Backup settings (retention + include attachments)
// ---------------------------------------------------------------------------

function BackupSettingsSection() {
  const queryClient = useQueryClient()
  const query = useQuery<BackupSettingsDto, Error>({
    queryKey: ['backup-settings'],
    queryFn: () => api(SETTINGS_ENDPOINT, { schema: BackupSettingsDtoSchema }),
    staleTime: 30_000,
  })
  const patch = useMutation({
    mutationFn: (body: BackupSettingsPatch) =>
      api(SETTINGS_ENDPOINT, { method: 'PATCH', body, schema: BackupSettingsDtoSchema }),
    onSuccess: (dto) => queryClient.setQueryData(['backup-settings'], dto),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Could not update backup settings.'),
  })

  const dto = query.data
  const busy = patch.isPending

  return (
    <SettingsSection
      title="Backup settings"
      description="How many backups to keep and whether to bundle attachments."
    >
      {query.isLoading || !dto ? (
        <div className="flex items-center gap-2 px-4 py-6 text-caption text-text-tertiary">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          Loading settings…
        </div>
      ) : (
        <>
          <SettingRow
            label="Backups to keep"
            description={
              dto.retentionDays === null
                ? `Using the default (${dto.effective.retentionDays}).`
                : `Keeping the newest ${dto.retentionDays}.`
            }
            control={
              <RetentionControl
                value={dto.retentionDays}
                effective={dto.effective.retentionDays}
                disabled={busy}
                onCommit={(retentionDays) => patch.mutate({ retentionDays })}
              />
            }
          />
          <SettingRow
            label="Include attachments"
            description={attachmentsDescription(dto)}
            control={
              <AttachmentsControl
                value={dto.includeAttachments}
                disabled={busy}
                onChange={(includeAttachments) => patch.mutate({ includeAttachments })}
              />
            }
          />
          <div className="px-4 py-3 text-caption text-text-tertiary">
            Defaults come from{' '}
            <code className="rounded-sm border border-border bg-surface px-1 font-mono">
              OPENDOIST_BACKUP_RETENTION
            </code>{' '}
            /{' '}
            <code className="rounded-sm border border-border bg-surface px-1 font-mono">
              OPENDOIST_BACKUP_INCLUDE_ATTACHMENTS
            </code>
            .
          </div>
        </>
      )}
    </SettingsSection>
  )
}

function attachmentsDescription(dto: BackupSettingsDto): string {
  if (dto.includeAttachments === null) {
    return `Using the default (${dto.effective.includeAttachments ? 'included' : 'excluded'}).`
  }
  return dto.includeAttachments ? 'Attachments are included.' : 'Attachments are excluded.'
}

/** Number field for "Backups to keep": empty draft resets to the env default (PATCH null). */
function RetentionControl({
  value,
  effective,
  disabled,
  onCommit,
}: {
  value: number | null
  effective: number
  disabled: boolean
  onCommit: (next: number | null) => void
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  useEffect(() => {
    setDraft(value === null ? '' : String(value))
  }, [value])

  const commit = () => {
    const parsed = parseRetentionInput(draft)
    if (!parsed.ok) {
      setDraft(value === null ? '' : String(value))
      toast.error(
        `Enter a whole number from ${RETENTION_MIN} to ${RETENTION_MAX}, or clear for the default.`,
      )
      return
    }
    if (parsed.value !== value) onCommit(parsed.value)
    else setDraft(parsed.value === null ? '' : String(parsed.value))
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        inputMode="numeric"
        min={RETENTION_MIN}
        max={RETENTION_MAX}
        value={draft}
        placeholder={String(effective)}
        aria-label="Backups to keep"
        disabled={disabled}
        className="w-24 text-right tabular-nums"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      {value !== null ? (
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onCommit(null)}>
          Default
        </Button>
      ) : null}
    </div>
  )
}

/** Tri-state segmented control: Default (env) / On / Off. */
function AttachmentsControl({
  value,
  disabled,
  onChange,
}: {
  value: boolean | null
  disabled: boolean
  onChange: (next: boolean | null) => void
}) {
  const options: { label: string; value: boolean | null }[] = [
    { label: 'Default', value: null },
    { label: 'On', value: true },
    { label: 'Off', value: false },
  ]
  return (
    <fieldset
      aria-label="Include attachments"
      className="m-0 inline-flex min-w-0 overflow-hidden rounded-sm border border-input-border p-0"
    >
      {options.map((option, index) => {
        const selected = value === option.value
        return (
          <button
            key={option.label}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => {
              if (!selected) onChange(option.value)
            }}
            className={cn(
              'h-8 cursor-pointer px-2.5 font-medium text-caption transition-colors duration-150 ease-standard focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--od-focus-ring)] disabled:cursor-not-allowed disabled:opacity-60',
              index > 0 && 'border-input-border border-l',
              selected
                ? 'bg-selected text-selected-text'
                : 'bg-surface-raised text-text-secondary hover:bg-hover hover:text-text-primary',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </fieldset>
  )
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

type RestorePhase = 'idle' | 'confirm' | 'uploading' | 'processing' | 'done' | 'error'
interface RestoreResult {
  restored: true
  preRestoreBackup: string
}

/** Multipart upload via XHR so we can report upload progress; `api()` is JSON-only. */
function uploadRestore(
  file: File,
  onUploadProgress: (pct: number) => void,
  onUploaded: () => void,
): Promise<RestoreResult> {
  return new Promise<RestoreResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', RESTORE_URL)
    xhr.withCredentials = true
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onUploadProgress(Math.round((event.loaded / event.total) * 100))
    }
    xhr.upload.onload = () => onUploaded()
    xhr.onload = () => {
      let body: unknown = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        body = null
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as RestoreResult)
      } else {
        const problem = (body && typeof body === 'object' ? body : {}) as {
          title?: string
          detail?: string
        }
        reject(new ApiError(xhr.status, problem))
      }
    }
    xhr.onerror = () =>
      reject(
        new ApiError(0, {
          title: 'Network error',
          detail: 'The upload failed. Check your connection and try again.',
        }),
      )
    const form = new FormData()
    form.append('file', file)
    xhr.send(form)
  })
}

function RestoreSection() {
  const [phase, setPhase] = useState<RestorePhase>('idle')
  const [file, setFile] = useState<File | null>(null)
  const [typed, setTyped] = useState('')
  const [pct, setPct] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const confirmOpen = phase === 'confirm' || phase === 'error'
  const restoring = phase === 'uploading' || phase === 'processing'

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null
    // Clear so picking the same file again still fires onChange.
    event.target.value = ''
    if (!chosen) return
    setFile(chosen)
    setTyped('')
    setErrorMsg(null)
    setPhase('confirm')
  }

  function resetToIdle() {
    setPhase('idle')
    setFile(null)
    setTyped('')
    setErrorMsg(null)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || !confirmMatchesRestore(typed)) return
    setErrorMsg(null)
    setPct(0)
    setPhase('uploading')
    try {
      const result = await uploadRestore(file, setPct, () => setPhase('processing'))
      setSnapshot(result.preRestoreBackup)
      setPhase('done')
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Restore failed.')
      setPhase('error')
    }
  }

  return (
    <>
      <SettingsSection
        title="Restore"
        description="Replace all current data with a backup. A safety snapshot is taken first."
      >
        <SettingRow
          label="Restore from backup"
          description="Upload an OpenDoist backup .zip. The app pauses while the restore runs."
          control={
            <Button variant="outline" onClick={() => inputRef.current?.click()}>
              <RotateCcw size={16} aria-hidden="true" />
              Restore from backup…
            </Button>
          }
        />
      </SettingsSection>
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={onFileChange}
      />

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open) resetToIdle()
        }}
      >
        <DialogContent className="max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Restore from backup</DialogTitle>
            <DialogDescription>
              This replaces ALL current data. A safety snapshot is taken first. The app pauses
              during restore.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            {file ? (
              <div className="flex items-center gap-2 rounded-sm border border-border bg-surface px-2.5 py-2 text-caption">
                <FileArchive size={14} className="shrink-0 text-text-tertiary" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-mono text-text-primary">
                  {file.name}
                </span>
                <span className="shrink-0 text-text-tertiary tabular-nums">
                  {formatBackupSize(file.size)}
                </span>
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              <label htmlFor="restore-confirm" className="text-copy text-text-secondary">
                Type <span className="font-mono text-text-primary">restore</span> to confirm
              </label>
              <Input
                id="restore-confirm"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                value={typed}
                aria-invalid={errorMsg ? true : undefined}
                onChange={(event) => setTyped(event.target.value)}
              />
            </div>
            {errorMsg ? (
              <p role="alert" className="text-copy text-danger">
                {errorMsg}
              </p>
            ) : null}
            <DialogFooter>
              <DialogClose className={cn(buttonVariants({ variant: 'ghost' }))}>Cancel</DialogClose>
              <Button type="submit" variant="destructive" disabled={!confirmMatchesRestore(typed)}>
                {errorMsg ? 'Try again' : 'Restore'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {restoring ? <RestoringOverlay phase={phase} pct={pct} /> : null}

      <Dialog open={phase === 'done'} onOpenChange={() => undefined}>
        <DialogContent showCloseButton={false} className="max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Restore complete</DialogTitle>
            <DialogDescription>
              Your data was restored. A safety snapshot of the previous data was saved as{' '}
              <span className="break-all font-mono text-text-primary">{snapshot}</span>.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => window.location.reload()}>Reload app</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function RestoringOverlay({ phase, pct }: { phase: 'uploading' | 'processing'; pct: number }) {
  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-busy="true"
      aria-label="Restoring"
      className="fixed inset-0 z-[var(--z-tooltip)] flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
    >
      <div className="flex flex-col items-center gap-3 rounded-lg bg-surface-raised px-8 py-6 text-center [box-shadow:var(--shadow-dialog)]">
        <Loader2 size={28} className="animate-spin text-accent" aria-hidden="true" />
        <div className="font-medium text-body text-text-primary">
          {phase === 'uploading' ? 'Uploading backup…' : 'Restoring…'}
        </div>
        <p className="max-w-xs text-caption text-text-tertiary">
          {phase === 'uploading'
            ? `${pct}% uploaded`
            : 'Applying your backup. The app will reload when it finishes.'}
        </p>
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function ExportSection() {
  return (
    <SettingsSection
      title="Export"
      description="Download all of your data. Exports are read-only and never delete anything."
    >
      <SettingRow
        label="Full JSON export"
        description="Every project, task, label, comment, and setting as canonical JSON."
        control={
          <a
            href="/api/v1/export/json"
            download
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            <FileJson size={16} aria-hidden="true" />
            Download JSON
          </a>
        }
      />
      <SettingRow
        label="CSV (Todoist-compatible) zip"
        description="One CSV per project — importable into Todoist or back into OpenDoist."
        control={
          <a
            href="/api/v1/export/csv"
            download
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            <FileArchive size={16} aria-hidden="true" />
            Download CSV zip
          </a>
        }
      />
    </SettingsSection>
  )
}
