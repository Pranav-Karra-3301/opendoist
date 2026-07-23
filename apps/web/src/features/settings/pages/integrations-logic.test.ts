import { describe, expect, it } from 'vitest'
import {
  BEARER_EXAMPLE,
  canCreateToken,
  formatLastUsed,
  formatTokenDate,
  SCOPE_OPTIONS,
  scopeLabel,
  tokenHint,
} from './integrations-logic'

describe('scopeLabel', () => {
  it('labels read as Read-only', () => {
    expect(scopeLabel('read')).toBe('Read-only')
  })
  it('labels read_write as Read & write', () => {
    expect(scopeLabel('read_write')).toBe('Read & write')
  })
})

describe('SCOPE_OPTIONS', () => {
  it('offers exactly the two frozen scopes in order', () => {
    expect(SCOPE_OPTIONS.map((option) => option.id)).toEqual(['read', 'read_write'])
  })
  it('gives every option a label and description', () => {
    for (const option of SCOPE_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0)
      expect(option.description.length).toBeGreaterThan(0)
    }
  })
})

describe('tokenHint', () => {
  it('appends an ellipsis to the token start', () => {
    expect(tokenHint('ot_3fa9')).toBe('ot_3fa9…')
  })
  it('does not double the ellipsis', () => {
    expect(tokenHint('ot_3fa9…')).toBe('ot_3fa9…')
  })
  it('falls back to the ot_ prefix when the start is empty', () => {
    expect(tokenHint('')).toBe('ot_…')
    expect(tokenHint('   ')).toBe('ot_…')
  })
})

describe('formatTokenDate', () => {
  it('formats an ISO instant in the given zone', () => {
    expect(formatTokenDate('2026-07-15T10:00:00.000Z', 'UTC')).toBe('Jul 15, 2026')
  })
  it('returns an empty string for an unparseable value', () => {
    expect(formatTokenDate('not-a-date', 'UTC')).toBe('')
  })
})

describe('formatLastUsed', () => {
  it('shows Never for a null timestamp', () => {
    expect(formatLastUsed(null)).toBe('Never')
  })
  it('formats a real timestamp', () => {
    expect(formatLastUsed('2026-01-03T00:00:00.000Z', 'UTC')).toBe('Jan 3, 2026')
  })
})

describe('canCreateToken', () => {
  it('rejects blank or whitespace-only names', () => {
    expect(canCreateToken('')).toBe(false)
    expect(canCreateToken('   ')).toBe(false)
  })
  it('accepts a real name', () => {
    expect(canCreateToken('Laptop CLI')).toBe(true)
  })
})

describe('BEARER_EXAMPLE', () => {
  it('documents the ot_ bearer header', () => {
    expect(BEARER_EXAMPLE).toContain('Bearer ot_')
  })
})
