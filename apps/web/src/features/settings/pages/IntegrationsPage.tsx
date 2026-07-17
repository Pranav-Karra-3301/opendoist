/**
 * Integrations settings (plan Task V) — API tokens, Developer links, and the calendar feed.
 * Tokens are listed from GET /api/v1/tokens (the secret is never returned by the list; only
 * the create response reveals it once — see TokenCreateDialog). Revoke is a confirmed DELETE
 * that refreshes the list. The calendar feed lives in <CalendarFeedCard /> (phase 6 Task M;
 * mounted here by phase 6 Task A).
 */
import type { ApiToken } from '@opendoist/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, ExternalLink, FileJson, KeyRound, Plus, Terminal } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { ApiError } from '@/api/client'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { listTokens, revokeToken } from '@/lib/api/phase5'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/toasts'
import CalendarFeedCard from '../CalendarFeedCard'
import { SettingRow, SettingsSection } from '../ui'
import {
  BEARER_EXAMPLE,
  formatLastUsed,
  formatTokenDate,
  scopeLabel,
  tokenHint,
} from './integrations-logic'
import TokenCreateDialog from './TokenCreateDialog'

const TOKENS_QUERY_KEY = ['tokens'] as const

export default function IntegrationsPage() {
  const qc = useQueryClient()
  const tokensQuery = useQuery({
    queryKey: TOKENS_QUERY_KEY,
    queryFn: listTokens,
    staleTime: 30_000,
  })
  const tokens = tokensQuery.data ?? []

  const [createOpen, setCreateOpen] = useState(false)
  const [revoking, setRevoking] = useState<ApiToken | null>(null)

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeToken(id),
    onSuccess: () => {
      toast.info('Token revoked')
      setRevoking(null)
      void qc.invalidateQueries({ queryKey: TOKENS_QUERY_KEY })
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError
          ? (error.problem.detail ?? error.problem.title ?? error.message)
          : 'Could not revoke the token. Please try again.',
      )
    },
  })

  return (
    <div className="max-w-2xl">
      <SettingsSection
        title="API tokens"
        description="Personal tokens authenticate the CLI, scripts, and third-party tools against your account."
      >
        {tokensQuery.isLoading ? (
          <div className="px-4 py-6 text-copy text-text-tertiary">Loading tokens…</div>
        ) : tokens.length === 0 ? (
          <EmptyTokens />
        ) : (
          <TokenTable tokens={tokens} onRevoke={setRevoking} />
        )}
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <span className="text-caption text-text-tertiary">
            Each token carries your full access for its scope. Revoke any you no longer use.
          </span>
          <Button className="shrink-0" onClick={() => setCreateOpen(true)}>
            <Plus size={16} aria-hidden="true" />
            Create token
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Developer"
        description="Every route the app and CLI use is documented and typed."
      >
        <SettingRow
          label="API reference"
          description="Explore and try endpoints in the browser (Scalar)."
          control={
            <ExternalLinkButton
              href="/api/v1/docs"
              ariaLabel="API reference (Scalar), opens in a new tab"
            >
              <BookOpen size={14} aria-hidden="true" />
              Open
            </ExternalLinkButton>
          }
        />
        <SettingRow
          label="OpenAPI spec"
          description="Machine-readable schema for client generation."
          control={
            <ExternalLinkButton
              href="/api/v1/openapi.json"
              ariaLabel="OpenAPI spec, opens in a new tab"
            >
              <FileJson size={14} aria-hidden="true" />
              View
            </ExternalLinkButton>
          }
        />
        <SettingRow
          label="Command-line tool"
          description="Sign the opendoist CLI in with a token created above."
          control={
            <code className="flex items-center gap-1.5 whitespace-nowrap rounded-sm bg-surface px-2 py-1 font-mono text-caption text-text-secondary">
              <Terminal size={13} aria-hidden="true" className="text-text-tertiary" />
              {'opendoist login <url> <token>'}
            </code>
          }
        />
      </SettingsSection>

      <CalendarFeedCard />

      <TokenCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => void qc.invalidateQueries({ queryKey: TOKENS_QUERY_KEY })}
      />

      <RevokeConfirm
        token={revoking}
        pending={revokeMutation.isPending}
        onCancel={() => setRevoking(null)}
        onConfirm={(id) => revokeMutation.mutate(id)}
      />
    </div>
  )
}

function EmptyTokens() {
  return (
    <div className="flex flex-col items-start gap-2 px-4 py-6">
      <div className="flex items-center gap-2 text-body text-text-primary">
        <KeyRound size={16} className="text-text-tertiary" aria-hidden="true" />
        No API tokens yet
      </div>
      <p className="text-caption text-text-tertiary">
        Create one, then send it as a Bearer header on every request:
      </p>
      <code className="rounded-sm bg-surface px-2 py-1 font-mono text-caption text-text-secondary">
        {BEARER_EXAMPLE}
      </code>
    </div>
  )
}

function TokenTable({
  tokens,
  onRevoke,
}: {
  tokens: ApiToken[]
  onRevoke: (token: ApiToken) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-left">
        <thead>
          <tr className="text-caption text-text-tertiary">
            <th scope="col" className="px-4 py-2 font-medium">
              Name
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Scope
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Token
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Created
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Last used
            </th>
            <th scope="col" className="px-4 py-2 text-right">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle border-border-subtle border-t">
          {tokens.map((token) => (
            <tr key={token.id}>
              <td className="px-4 py-3 text-body text-text-primary">{token.name}</td>
              <td className="px-4 py-3">
                <ScopeBadge scope={token.scope} />
              </td>
              <td className="px-4 py-3">
                <code className="font-mono text-caption text-text-secondary">
                  {tokenHint(token.start)}
                </code>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-caption text-text-tertiary">
                {formatTokenDate(token.createdAt)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-caption text-text-tertiary">
                {formatLastUsed(token.lastUsedAt)}
              </td>
              <td className="px-4 py-3 text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:bg-danger/10 hover:text-danger"
                  onClick={() => onRevoke(token)}
                >
                  Revoke
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ScopeBadge({ scope }: { scope: ApiToken['scope'] }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm px-1.5 py-0.5 font-medium text-caption',
        scope === 'read_write' ? 'bg-accent-soft text-accent' : 'bg-hover text-text-secondary',
      )}
    >
      {scopeLabel(scope)}
    </span>
  )
}

function ExternalLinkButton({
  href,
  ariaLabel,
  children,
}: {
  href: string
  ariaLabel: string
  children: ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={ariaLabel}
      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5')}
    >
      {children}
      <ExternalLink size={13} aria-hidden="true" className="text-text-tertiary" />
    </a>
  )
}

function RevokeConfirm({
  token,
  pending,
  onCancel,
  onConfirm,
}: {
  token: ApiToken | null
  pending: boolean
  onCancel: () => void
  onConfirm: (id: string) => void
}) {
  return (
    <Dialog
      open={token !== null}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      {token && (
        <DialogContent className="w-full max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Revoke token</DialogTitle>
            <DialogDescription>
              {`“${token.name}” stops working immediately and cannot be restored. Anything using it will need a new token.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => onConfirm(token.id)}
            >
              Revoke token
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
