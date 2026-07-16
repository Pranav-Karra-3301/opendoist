/**
 * Pure, framework-free helpers for the Account settings page (Task M). Kept in a
 * separate module (zero React / zero window access) so the colocated Vitest suite
 * runs under the repo's `environment: 'node'` config without a DOM.
 */

export interface PasswordForm {
  current: string
  next: string
  confirm: string
}

/**
 * Validate a password-change form. Returns a human message for the first failing
 * rule, or `null` when the form is submittable. Rules mirror the server's minimum
 * (better-auth default min length 8) plus obvious client-side guards.
 */
export function validatePasswordChange(form: PasswordForm): string | null {
  if (form.current.length === 0) return 'Enter your current password.'
  if (form.next.length < 8) return 'New password must be at least 8 characters.'
  if (form.next !== form.confirm) return 'New passwords do not match.'
  if (form.next === form.current) return 'New password must be different from the current one.'
  return null
}

/** Delete-account confirmation gate: the typed value must equal the account email. */
export function canDeleteAccount(typed: string, accountEmail: string): boolean {
  const target = accountEmail.trim().toLowerCase()
  return target.length > 0 && typed.trim().toLowerCase() === target
}

/** A TOTP code is exactly six digits (whitespace tolerated around it). */
export function isValidTotpCode(code: string): boolean {
  return /^\d{6}$/.test(code.trim())
}

/**
 * Extract the base32 `secret` parameter from an `otpauth://` URI so it can be
 * shown for manual authenticator entry when no QR renderer is available.
 */
export function totpSecretFromUri(uri: string): string | null {
  const value = uri.match(/[?&]secret=([^&]+)/i)?.[1]
  return value ? decodeURIComponent(value) : null
}

/** Human label for a linked account's providerId. */
export function providerLabel(providerId: string, oidcName?: string | null): string {
  if (providerId === 'credential') return 'Password'
  if (providerId === 'oidc') return oidcName && oidcName.length > 0 ? oidcName : 'Single sign-on'
  // Fall back to a title-cased id for any other provider better-auth may report.
  return providerId.charAt(0).toUpperCase() + providerId.slice(1)
}
