/**
 * Pure, framework-free helpers for the Integrations settings page (Task V). Kept in a
 * separate module (zero React / zero window access) so the colocated Vitest suite runs
 * under the repo's `environment: 'node'` config without a DOM. Presentation + validation
 * only — the network lives in `lib/api/phase5.ts` (frozen).
 */

export type TokenScope = 'read' | 'read_write'

export interface ScopeOption {
  id: TokenScope
  label: string
  description: string
}

/** The two frozen scopes (core `ApiTokenScopeSchema`), in the order the create dialog shows them. */
export const SCOPE_OPTIONS: readonly ScopeOption[] = [
  { id: 'read', label: 'Read-only', description: 'View tasks, projects, labels, and settings.' },
  {
    id: 'read_write',
    label: 'Read & write',
    description: 'Create, edit, complete, and delete anything in your account.',
  },
]

/** Human label for a token scope. */
export function scopeLabel(scope: TokenScope): string {
  return scope === 'read_write' ? 'Read & write' : 'Read-only'
}

/**
 * Identifying hint for a token from its stored `start` (e.g. `ot_3fa9` → `ot_3fa9…`).
 * Never the secret — the full value only exists in the create response. Falls back to the
 * `ot_` prefix, and never doubles the ellipsis.
 */
export function tokenHint(start: string): string {
  const base = start.trim().length > 0 ? start.trim() : 'ot_'
  return base.endsWith('…') ? base : `${base}…`
}

/**
 * Short calendar date for token metadata. `timeZone` defaults to the runtime zone (correct
 * for the viewer); tests pass `'UTC'` for determinism. Returns `''` for an unparseable value.
 */
export function formatTokenDate(iso: string, timeZone?: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

/** `'Never'` when the token has not been used, else its formatted date. */
export function formatLastUsed(iso: string | null, timeZone?: string): string {
  return iso === null ? 'Never' : formatTokenDate(iso, timeZone)
}

/** A token needs a non-blank name before it can be created. */
export function canCreateToken(name: string): boolean {
  return name.trim().length > 0
}

/** Bearer-header example shown in the empty state. */
export const BEARER_EXAMPLE = 'Authorization: Bearer ot_…'
