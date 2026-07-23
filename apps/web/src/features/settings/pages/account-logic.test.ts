import { describe, expect, it } from 'vitest'
import {
  canDeleteAccount,
  isValidTotpCode,
  providerLabel,
  totpSecretFromUri,
  validatePasswordChange,
} from './account-logic'

describe('validatePasswordChange', () => {
  it('accepts a valid change', () => {
    expect(
      validatePasswordChange({ current: 'old-pass-1', next: 'new-pass-1', confirm: 'new-pass-1' }),
    ).toBeNull()
  })

  it('requires the current password', () => {
    expect(
      validatePasswordChange({ current: '', next: 'new-pass-1', confirm: 'new-pass-1' }),
    ).toMatch(/current password/i)
  })

  it('enforces a minimum length of 8', () => {
    expect(
      validatePasswordChange({ current: 'old-pass-1', next: 'short', confirm: 'short' }),
    ).toMatch(/at least 8/i)
  })

  it('requires the confirmation to match', () => {
    expect(
      validatePasswordChange({ current: 'old-pass-1', next: 'new-pass-1', confirm: 'nope-pass-2' }),
    ).toMatch(/do not match/i)
  })

  it('rejects reusing the current password', () => {
    expect(
      validatePasswordChange({
        current: 'same-pass-1',
        next: 'same-pass-1',
        confirm: 'same-pass-1',
      }),
    ).toMatch(/different/i)
  })
})

describe('canDeleteAccount', () => {
  it('matches case-insensitively and trims whitespace', () => {
    expect(canDeleteAccount('  Owner@Example.com ', 'owner@example.com')).toBe(true)
  })

  it('rejects a mismatch', () => {
    expect(canDeleteAccount('someone@else.com', 'owner@example.com')).toBe(false)
  })

  it('never confirms against an empty account email', () => {
    expect(canDeleteAccount('', '')).toBe(false)
  })
})

describe('isValidTotpCode', () => {
  it('accepts exactly six digits', () => {
    expect(isValidTotpCode('123456')).toBe(true)
    expect(isValidTotpCode(' 000000 ')).toBe(true)
  })

  it('rejects wrong lengths and non-digits', () => {
    expect(isValidTotpCode('12345')).toBe(false)
    expect(isValidTotpCode('1234567')).toBe(false)
    expect(isValidTotpCode('12a456')).toBe(false)
  })
})

describe('totpSecretFromUri', () => {
  it('extracts the secret param', () => {
    expect(
      totpSecretFromUri(
        'otpauth://totp/OpenTask:owner@example.com?secret=JBSWY3DPEHPK3PXP&issuer=OpenTask',
      ),
    ).toBe('JBSWY3DPEHPK3PXP')
  })

  it('returns null when absent', () => {
    expect(totpSecretFromUri('otpauth://totp/OpenTask?issuer=OpenTask')).toBeNull()
  })
})

describe('providerLabel', () => {
  it('maps the credential provider to Password', () => {
    expect(providerLabel('credential')).toBe('Password')
  })

  it('uses the configured OIDC display name', () => {
    expect(providerLabel('oidc', 'Authentik')).toBe('Authentik')
    expect(providerLabel('oidc', null)).toBe('Single sign-on')
  })

  it('title-cases any other provider id', () => {
    expect(providerLabel('github')).toBe('Github')
  })
})
