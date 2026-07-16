/**
 * Backups settings (Task U) — a placeholder shell for phase 9 (spec §2.6).
 *
 * The final layout is in place: a "Back up now" primary button (disabled until phase
 * 9), the retention note, and a snapshots table (Name / Size / Date / download +
 * restore). Data comes from `GET /api/v1/backups`, which does not exist yet — the
 * query fn maps its 404 to `null` so the page shows the "arrive in phase 9"
 * empty-state card instead of an error. No rows are fabricated; the table renders
 * only if a future server actually returns snapshots. Phase 9 (Task in the backups
 * milestone) wires "Back up now", download, and restore for real.
 */
import { useQuery } from '@tanstack/react-query'
import {
  DatabaseBackup,
  Download,
  FolderClock,
  Loader2,
  RotateCcw,
  TriangleAlert,
} from 'lucide-react'
import { ApiError, api } from '@/api/client'
import { buttonVariants } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  type BackupEntry,
  BackupListSchema,
  backupDownloadHref,
  DEFAULT_BACKUP_RETENTION,
  formatBackupDate,
  formatBackupSize,
  resolveBackupsView,
} from './backups-logic'

const BACKUPS_ENDPOINT = '/backups'

/** GET /api/v1/backups — ships in phase 9. Today it 404s; map that to `null` (the
 *  "unavailable" placeholder) and let any other failure surface as the error card. */
async function fetchBackups(): Promise<BackupEntry[] | null> {
  try {
    return await api(BACKUPS_ENDPOINT, { schema: BackupListSchema })
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

export default function BackupsPage() {
  const query = useQuery<BackupEntry[] | null, Error>({
    queryKey: ['backups'],
    queryFn: fetchBackups,
    staleTime: 60_000,
    retry: false,
  })
  const view = resolveBackupsView({
    isLoading: query.isLoading,
    isError: query.isError,
    data: query.data,
    errorMessage: query.error?.message,
  })

  return (
    <div className="flex flex-col gap-6">
      <Header />
      {view.kind === 'loading' ? <ListSkeleton /> : null}
      {view.kind === 'unavailable' ? <EmptyState unavailable /> : null}
      {view.kind === 'empty' ? <EmptyState /> : null}
      {view.kind === 'error' ? (
        <ErrorCard message={view.message} onRetry={() => void query.refetch()} />
      ) : null}
      {view.kind === 'list' ? <BackupsTable backups={view.backups} /> : null}
    </div>
  )
}

function Header() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-medium text-subtitle text-text-primary">Snapshots</h2>
          <p className="mt-0.5 max-w-prose text-copy text-text-secondary">
            OpenDoist takes a nightly snapshot of your database and keeps the most recent copies so
            you can download or restore them.
          </p>
        </div>
        <div className="shrink-0">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                aria-disabled="true"
                aria-label="Back up now (available in phase 9)"
                onClick={(event) => event.preventDefault()}
                className={cn(
                  buttonVariants({ variant: 'default' }),
                  'cursor-not-allowed bg-accent-disabled hover:bg-accent-disabled',
                )}
              >
                <DatabaseBackup size={16} aria-hidden="true" />
                Back up now
              </TooltipTrigger>
              <TooltipContent>Backups ship in phase 9</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      <p className="text-caption text-text-tertiary">
        Nightly snapshots, {DEFAULT_BACKUP_RETENTION} kept — configurable via{' '}
        <code className="rounded-xs border border-border bg-surface px-1 font-mono">
          OPENDOIST_BACKUP_RETENTION
        </code>
        .
      </p>
    </div>
  )
}

function EmptyState({ unavailable = false }: { unavailable?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border border-dashed bg-surface-raised px-6 py-12 text-center">
      <FolderClock size={28} strokeWidth={1.75} className="text-text-tertiary" aria-hidden="true" />
      <div className="font-medium text-body text-text-primary">
        {unavailable
          ? 'No backups yet — automatic nightly backups arrive in phase 9'
          : 'No backups yet — your first nightly snapshot will appear here'}
      </div>
      <p className="max-w-prose text-copy text-text-secondary">
        Snapshots are written to <code className="font-mono text-caption">/data/backups</code> as a
        nightly <code className="font-mono text-caption">VACUUM INTO</code> of your database.
        Litestream S3 replication is available as an optional sidecar for point-in-time recovery.
      </p>
    </div>
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
      <button
        type="button"
        onClick={onRetry}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
      >
        Try again
      </button>
    </div>
  )
}

function BackupsTable({ backups }: { backups: BackupEntry[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface-raised">
      <table className="w-full min-w-[34rem] text-left text-copy">
        <thead>
          <tr className="border-border border-b text-caption text-text-tertiary">
            <th scope="col" className="px-4 py-2 font-medium">
              Name
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Size
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Date
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {backups.map((backup) => (
            <BackupRow key={backup.name} backup={backup} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BackupRow({ backup }: { backup: BackupEntry }) {
  return (
    <tr className="text-text-primary">
      <td className="max-w-0 truncate px-4 py-2.5 font-mono text-caption">{backup.name}</td>
      <td className="whitespace-nowrap px-4 py-2.5 text-text-secondary">
        {formatBackupSize(backup.size)}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-text-secondary">
        {formatBackupDate(backup.createdAt)}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center justify-end gap-1">
          <a
            href={backupDownloadHref(backup)}
            download
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
          >
            <Download size={16} aria-hidden="true" />
            Download
          </a>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                aria-disabled="true"
                aria-label="Restore (available in phase 9)"
                onClick={(event) => event.preventDefault()}
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'sm' }),
                  'cursor-not-allowed text-text-tertiary hover:bg-transparent hover:text-text-tertiary',
                )}
              >
                <RotateCcw size={16} aria-hidden="true" />
                Restore
              </TooltipTrigger>
              <TooltipContent>Restore ships in phase 9</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </td>
    </tr>
  )
}
