/**
 * Import settings (plan Task H) — bring existing Todoist data into OpenTask from either a
 * downloaded backup .zip (parsed server-side, one CSV per project) or a live API token. Both
 * modes drive the phase-9 import job runner (Task G): a POST starts a job and returns 202
 * `{ jobId }`, then this page polls `GET /api/v1/import/jobs/:id` every 750 ms while it runs
 * and renders the resulting report (counts found, counts written, and a skip list).
 *
 * "Preview import" runs a dry-run (writes nothing); "Import" runs an apply behind a confirm
 * dialog ("Imports add to your existing data. Nothing is deleted."). Only the sources listed
 * in GET /api/v1/info `available_importers` are offered. Pure display helpers and the response
 * schemas live in `./import-format` so their Vitest suite runs headless (node environment).
 *
 * File placement (AS-BUILT): the plan named `apps/web/src/settings/`, but the real settings
 * feature lives under `apps/web/src/features/settings/pages/` — this sits beside the other
 * registry pages and is lazy-loaded from `../registry` (the phase-9-owned nav entry `import`).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Eye,
  FileArchive,
  Import as ImportIcon,
  KeyRound,
  Loader2,
  TriangleAlert,
} from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { ApiError, api } from '@/api/client'
import { useInfo } from '@/api/hooks/info'
import { qk } from '@/api/keys'
import { Button } from '@/components/ui/button'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/toasts'
import {
  availableSources,
  countRows,
  fetchedSummary,
  type ImportJob,
  ImportJobSchema,
  type ImportMode,
  type ImportSource,
  ImportStartResponseSchema,
  phaseLabel,
} from './import-format'

const PATHS = {
  csv: '/import/todoist-csv',
  api: '/import/todoist-api',
  job: (id: string) => `/import/jobs/${id}`,
} as const

function getImportJob(id: string): Promise<ImportJob> {
  return api(PATHS.job(id), { schema: ImportJobSchema })
}

function startApiImport(token: string, mode: ImportMode): Promise<{ jobId: string }> {
  return api(PATHS.api, {
    method: 'POST',
    body: { token, mode },
    schema: ImportStartResponseSchema,
  })
}

/** Multipart POST — the frozen `api()` client is JSON-only, so the .zip upload rides raw fetch. */
async function startCsvImport(file: File, mode: ImportMode): Promise<{ jobId: string }> {
  const fd = new FormData()
  fd.append('mode', mode)
  fd.append('file', file, file.name)
  const res = await fetch(`/api/v1${PATHS.csv}`, {
    method: 'POST',
    credentials: 'include',
    body: fd,
  })
  if (!res.ok) {
    const problem = (await res
      .json()
      .catch(() => ({ title: res.statusText }))) as ConstructorParameters<typeof ApiError>[1]
    throw new ApiError(res.status, problem)
  }
  return ImportStartResponseSchema.parse(await res.json())
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export default function ImportPage() {
  const { data: info } = useInfo()
  const sources = availableSources(info?.available_importers)
  const both = sources.csv && sources.api

  const [source, setSource] = useState<ImportSource>('todoist-csv')
  const [file, setFile] = useState<File | null>(null)
  const [token, setToken] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [confirmSource, setConfirmSource] = useState<ImportSource | null>(null)
  const [showSkips, setShowSkips] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const notifiedRef = useRef<string | null>(null)
  const qc = useQueryClient()
  const tokenId = useId()

  // When the default source isn't offered by this instance, fall back to the available one.
  useEffect(() => {
    if (source === 'todoist-csv' && !sources.csv && sources.api) setSource('todoist-api')
    else if (source === 'todoist-api' && !sources.api && sources.csv) setSource('todoist-csv')
  }, [source, sources.csv, sources.api])

  const jobQuery = useQuery({
    queryKey: ['import-job', jobId],
    enabled: jobId !== null,
    queryFn: () => getImportJob(jobId as string),
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 750 : false),
  })
  const job = jobQuery.data ?? null

  const startMutation = useMutation({
    mutationFn: ({ source: src, mode }: { source: ImportSource; mode: ImportMode }) => {
      if (src === 'todoist-csv') {
        if (!file) return Promise.reject(new Error('Choose a .zip backup file first.'))
        return startCsvImport(file, mode)
      }
      const trimmed = token.trim()
      if (trimmed === '') return Promise.reject(new Error('Paste your Todoist API token first.'))
      return startApiImport(trimmed, mode)
    },
    onSuccess: ({ jobId: id }) => {
      notifiedRef.current = null
      setShowSkips(false)
      setJobId(id)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not start import.'),
  })

  const busy = startMutation.isPending || job?.status === 'running'

  // Toast + refresh app data once, when a job settles.
  useEffect(() => {
    if (!job || job.status === 'running' || jobId === null || notifiedRef.current === jobId) return
    notifiedRef.current = jobId
    if (job.status === 'done' && job.mode === 'apply') {
      for (const key of [qk.tasks, qk.projects, qk.sections, qk.labels]) {
        void qc.invalidateQueries({ queryKey: key })
      }
      toast.info('Import complete.')
    } else if (job.status === 'error') {
      toast.error(job.error ?? 'Import failed.')
    }
  }, [job, jobId, qc])

  const canSubmit = source === 'todoist-csv' ? file !== null : token.trim() !== ''
  const canApplyJob = job
    ? job.source === 'todoist-csv'
      ? file !== null
      : token.trim() !== ''
    : false

  if (!info) {
    return (
      <div className="flex items-center justify-center py-16 text-text-tertiary">
        <Loader2 size={20} className="animate-spin" aria-label="Loading" />
      </div>
    )
  }

  if (!sources.csv && !sources.api) {
    return (
      <SettingsCard>
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <TriangleAlert size={22} className="text-text-tertiary" aria-hidden="true" />
          <p className="text-copy text-text-secondary">
            Importing is not available on this instance.
          </p>
        </div>
      </SettingsCard>
    )
  }

  const csvCard = (
    <div className="grid gap-2.5">
      <p className="text-copy text-text-secondary">
        Export your data from Todoist ({' '}
        <span className="text-text-primary">Settings → Backups → Download</span> ), then upload the{' '}
        <code className="rounded-xs border border-border bg-surface px-1 font-mono text-caption">
          .zip
        </code>{' '}
        here. Everything is added to your existing data — nothing is replaced.
      </p>
      <div className="flex flex-wrap items-center gap-2.5">
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip"
          aria-label="Todoist backup .zip file"
          className="sr-only"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
          <FileArchive size={16} aria-hidden="true" />
          {file ? 'Change file' : 'Choose .zip file'}
        </Button>
        <span className="min-w-0 truncate text-caption text-text-tertiary">
          {file ? `${file.name} · ${humanBytes(file.size)}` : 'No file selected'}
        </span>
      </div>
    </div>
  )

  const apiCard = (
    <div className="grid gap-2.5">
      <p className="text-copy text-text-secondary">
        Create a token in Todoist ({' '}
        <span className="text-text-primary">Settings → Integrations → Developer</span> ), then paste
        it below. It is used once for this import and never stored.
      </p>
      <div className="grid max-w-md gap-1.5">
        <label htmlFor={tokenId} className="font-medium text-caption text-text-secondary">
          Todoist API token
        </label>
        <Input
          id={tokenId}
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="0123456789abcdef…"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="font-mono text-caption"
        />
      </div>
    </div>
  )

  const actions = (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Button
        variant="outline"
        onClick={() => startMutation.mutate({ source, mode: 'dry-run' })}
        disabled={!canSubmit || busy}
      >
        <Eye size={16} aria-hidden="true" />
        Preview import
      </Button>
      <Button onClick={() => setConfirmSource(source)} disabled={!canSubmit || busy}>
        <ImportIcon size={16} aria-hidden="true" />
        Import
      </Button>
    </div>
  )

  return (
    <div className="max-w-2xl">
      <p className="mb-6 max-w-prose text-copy text-text-secondary">
        Move your projects, sections, labels, tasks, and comments from Todoist into OpenTask.
        Priorities and due dates are converted automatically. Preview first to see exactly what will
        be created.
      </p>

      {both ? (
        <Tabs
          value={source}
          onValueChange={(value: string) => setSource(value as ImportSource)}
          className="mb-4"
        >
          <TabsList>
            <TabsTrigger value="todoist-csv">
              <FileArchive size={14} aria-hidden="true" />
              Backup file
            </TabsTrigger>
            <TabsTrigger value="todoist-api">
              <KeyRound size={14} aria-hidden="true" />
              API token
            </TabsTrigger>
          </TabsList>
          <TabsContent value="todoist-csv" className="mt-4">
            <SettingsCard>{csvCard}</SettingsCard>
          </TabsContent>
          <TabsContent value="todoist-api" className="mt-4">
            <SettingsCard>{apiCard}</SettingsCard>
          </TabsContent>
        </Tabs>
      ) : (
        <div className="mb-4">
          <SettingsCard>{sources.csv ? csvCard : apiCard}</SettingsCard>
        </div>
      )}

      {actions}

      <ResultsPanel
        starting={startMutation.isPending || (jobId !== null && jobQuery.isLoading)}
        job={job}
        pollError={jobId !== null && jobQuery.isError ? jobQuery.error : null}
        onRetryPoll={() => void jobQuery.refetch()}
        showSkips={showSkips}
        onToggleSkips={() => setShowSkips((v) => !v)}
        onImportNow={job ? () => setConfirmSource(job.source) : undefined}
        canImportNow={canApplyJob && !busy}
        onRetryJob={
          job
            ? () => {
                if (job.mode === 'apply') setConfirmSource(job.source)
                else startMutation.mutate({ source: job.source, mode: 'dry-run' })
              }
            : undefined
        }
        canRetryJob={canApplyJob && !busy}
      />

      <Dialog
        open={confirmSource !== null}
        onOpenChange={(open) => !open && setConfirmSource(null)}
      >
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Import to your account</DialogTitle>
            <DialogDescription>
              Imports add to your existing data. Nothing is deleted. Continue?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose
              className={cn(
                'inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-sm px-3 font-medium text-copy text-text-secondary transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-focus-ring)]',
              )}
            >
              Cancel
            </DialogClose>
            <Button
              onClick={() => {
                const src = confirmSource
                setConfirmSource(null)
                if (src) startMutation.mutate({ source: src, mode: 'apply' })
              }}
            >
              <ImportIcon size={16} aria-hidden="true" />
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised px-4 py-4">{children}</div>
  )
}

function ResultsPanel({
  starting,
  job,
  pollError,
  onRetryPoll,
  showSkips,
  onToggleSkips,
  onImportNow,
  canImportNow,
  onRetryJob,
  canRetryJob,
}: {
  starting: boolean
  job: ImportJob | null
  pollError: Error | null
  onRetryPoll: () => void
  showSkips: boolean
  onToggleSkips: () => void
  onImportNow?: () => void
  canImportNow: boolean
  onRetryJob?: () => void
  canRetryJob: boolean
}) {
  if (starting) {
    return (
      <Panel>
        <div className="flex items-center gap-2 text-copy text-text-secondary">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          Starting import…
        </div>
      </Panel>
    )
  }

  if (pollError) {
    return (
      <Panel>
        <div className="flex flex-col items-start gap-2">
          <div className="flex items-center gap-2 text-copy text-danger">
            <CircleAlert size={16} aria-hidden="true" />
            Lost track of this import: {pollError.message}
          </div>
          <Button variant="outline" size="sm" onClick={onRetryPoll}>
            Try again
          </Button>
        </div>
      </Panel>
    )
  }

  if (!job) return null

  if (job.status === 'running') {
    const summary = fetchedSummary(job.progress.fetched)
    return (
      <Panel>
        <div
          className="flex items-center gap-2 text-copy text-text-secondary"
          role="status"
          aria-live="polite"
        >
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          <span className="min-w-0">
            {phaseLabel(job.progress.phase)}
            {summary ? ` ${summary}` : ''}
            {job.progress.detail ? ` — ${job.progress.detail}` : ''}
          </span>
        </div>
      </Panel>
    )
  }

  if (job.status === 'error') {
    return (
      <Panel>
        <div className="flex flex-col items-start gap-2.5">
          <div className="flex items-start gap-2 text-copy text-danger">
            <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0">{job.error ?? 'Import failed.'}</span>
          </div>
          {onRetryJob ? (
            <Button variant="outline" size="sm" onClick={onRetryJob} disabled={!canRetryJob}>
              Try again
            </Button>
          ) : null}
        </div>
      </Panel>
    )
  }

  // status === 'done'
  const report = job.report
  if (!report) return null
  const dryRun = report.mode === 'dry-run'
  const rows = countRows(report)

  return (
    <Panel>
      <div className="mb-3 flex items-center gap-2">
        <CircleCheck
          size={18}
          className={dryRun ? 'text-text-tertiary' : 'text-success'}
          aria-hidden="true"
        />
        <h3 className="font-medium text-body text-text-primary">
          {dryRun ? 'Preview — nothing has been imported yet' : 'Import complete'}
        </h3>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[20rem] text-left text-copy">
          <thead>
            <tr className="border-border border-b text-caption text-text-tertiary">
              <th scope="col" className="px-3 py-2 font-medium">
                Item
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Found
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {dryRun ? 'To create' : 'Created'}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {rows.map((row) => (
              <tr key={row.key} className="text-text-primary">
                <td className="px-3 py-2">{row.label}</td>
                <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                  {row.found}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{row.created}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {report.skips.length > 0 ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={onToggleSkips}
            aria-expanded={showSkips}
            className="inline-flex items-center gap-1 rounded-sm text-caption text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-focus-ring)]"
          >
            {showSkips ? (
              <ChevronDown size={14} aria-hidden="true" />
            ) : (
              <ChevronRight size={14} aria-hidden="true" />
            )}
            {report.skips.length} item{report.skips.length === 1 ? '' : 's'} skipped
          </button>
          {showSkips ? (
            <ul className="mt-2 flex flex-col gap-1.5 border-border border-l pl-3">
              {report.skips.map((skip, i) => (
                <li
                  key={`${skip.entity}-${skip.ref}-${i}`}
                  className="text-caption text-text-secondary"
                >
                  <span className="text-text-tertiary">{skip.entity}</span>
                  {skip.ref ? <span className="text-text-primary"> · {skip.ref}</span> : null} —{' '}
                  {skip.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {dryRun && onImportNow ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={onImportNow} disabled={!canImportNow}>
            <ImportIcon size={16} aria-hidden="true" />
            Import now
          </Button>
          {!canImportNow ? (
            <span className="text-caption text-text-tertiary">
              {job.source === 'todoist-csv'
                ? 'Re-select the backup file to import.'
                : 'Re-enter your token to import.'}
            </span>
          ) : null}
        </div>
      ) : null}
    </Panel>
  )
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 rounded-lg border border-border bg-surface-raised px-4 py-4">
      {children}
    </div>
  )
}
