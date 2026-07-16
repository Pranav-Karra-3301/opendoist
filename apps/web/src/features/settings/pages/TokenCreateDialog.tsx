/**
 * TokenCreateDialog (plan Task V) — the two-phase "create API token" flow the Integrations
 * page opens. Phase 1 collects a name + scope and POSTs to /api/v1/tokens; phase 2 reveals
 * the full `od_…` secret exactly once (the server never returns it again) with a copy button
 * and a store-it-now warning. Closing clears the secret from component state so a reopened
 * form can never leak it.
 */
import type { CreatedApiToken } from '@opendoist/core'
import { useMutation } from '@tanstack/react-query'
import { Check, Copy, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { createToken } from '@/lib/api/phase5'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/toasts'
import { canCreateToken, SCOPE_OPTIONS, type TokenScope } from './integrations-logic'

export default function TokenCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fired once the token exists (dialog still open, showing the secret) so the list can refresh. */
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [scope, setScope] = useState<TokenScope>('read')
  const [created, setCreated] = useState<CreatedApiToken | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: (body: { name: string; scope: TokenScope }) => createToken(body),
    onSuccess: (token) => {
      setCreated(token)
      onCreated()
    },
    onError: (err) => {
      setError(
        err instanceof ApiError
          ? (err.problem.detail ?? err.problem.title ?? err.message)
          : 'Could not create the token. Please try again.',
      )
    },
  })

  const reset = () => {
    setName('')
    setScope('read')
    setCreated(null)
    setCopied(false)
    setError(null)
  }

  // Reset on any close (Done / Cancel / Esc / backdrop) so the one-time secret never survives.
  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const submittable = canCreateToken(name) && !createMutation.isPending

  const submit = () => {
    setError(null)
    createMutation.mutate({ name: name.trim(), scope })
  }

  const copy = async () => {
    if (created === null) return
    try {
      await navigator.clipboard.writeText(created.token)
      setCopied(true)
      toast.info('Token copied to clipboard')
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy automatically — select the token and copy it manually.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {open && (
        <DialogContent className="w-full max-w-[460px]">
          <DialogHeader>
            <DialogTitle>{created ? 'Copy your token' : 'Create API token'}</DialogTitle>
            <DialogDescription>
              {created
                ? 'Store this token now — you will not be able to see it again.'
                : 'Name the token and choose what it can do. The secret appears once, right after you create it.'}
            </DialogDescription>
          </DialogHeader>

          {created ? (
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <label
                  htmlFor="token-secret"
                  className="font-medium text-caption text-text-secondary"
                >
                  Token
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    id="token-secret"
                    readOnly
                    aria-label="API token"
                    value={created.token}
                    onFocus={(event) => event.currentTarget.select()}
                    className="font-mono text-caption"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => void copy()}
                    aria-label="Copy token"
                  >
                    {copied ? (
                      <Check size={16} aria-hidden="true" />
                    ) : (
                      <Copy size={16} aria-hidden="true" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-sm border border-warning/25 bg-warning/10 px-3 py-2 text-caption text-warning">
                <TriangleAlert size={16} className="mt-px shrink-0" aria-hidden="true" />
                <span>This token is shown only once — store it now.</span>
              </div>

              <DialogFooter>
                <Button type="button" onClick={() => handleOpenChange(false)}>
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                if (submittable) submit()
              }}
            >
              <div className="grid gap-1.5">
                <label
                  htmlFor="token-name"
                  className="font-medium text-caption text-text-secondary"
                >
                  Name
                </label>
                <Input
                  id="token-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Laptop CLI"
                  autoFocus
                />
              </div>

              <fieldset className="grid gap-2 border-0 p-0">
                <legend className="mb-1 font-medium text-caption text-text-secondary">Scope</legend>
                {SCOPE_OPTIONS.map((option) => (
                  <label
                    key={option.id}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-sm border px-3 py-2.5 transition-colors',
                      scope === option.id
                        ? 'border-accent bg-accent-soft'
                        : 'border-input-border hover:bg-hover',
                    )}
                  >
                    <input
                      type="radio"
                      name="token-scope"
                      value={option.id}
                      checked={scope === option.id}
                      onChange={() => setScope(option.id)}
                      aria-label={option.label}
                      className="mt-0.5 size-4 shrink-0"
                      style={{ accentColor: 'var(--od-accent)' }}
                    />
                    <span className="grid gap-0.5">
                      <span className="text-body text-text-primary">{option.label}</span>
                      <span className="text-caption text-text-tertiary">{option.description}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              {error !== null && (
                <p role="alert" className="text-caption text-danger">
                  {error}
                </p>
              )}

              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!submittable}>
                  Create token
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      )}
    </Dialog>
  )
}
