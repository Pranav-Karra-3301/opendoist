/**
 * FROZEN contract (desktop Task A), implemented in Task B over `../desktop/session-store`
 * (which persists `{ instanceUrl, token }` via `@tauri-apps/plugin-store`). The signatures
 * here are what `client.ts` compiles against and MUST NOT change.
 *
 * Semantics:
 *  - `getDesktopSession()` resolves the paired instance as an `ApiSession`
 *    (`baseUrl` = https instance URL without trailing slash, `authHeaders` = ot_ bearer,
 *    `credentials: 'omit'`) or `null` while unpaired. Never throws for "unpaired".
 *  - `saveDesktopSession(url, token)` validates (https only, non-empty ot_ token),
 *    normalizes (strips trailing slashes), and persists. Never log or echo the token.
 */
import { loadPairing, savePairing } from '../desktop/session-store'
import type { ApiSession } from './transport'

/** The paired instance as an `ApiSession`, or `null` while unpaired. Never throws. */
export async function getDesktopSession(): Promise<ApiSession | null> {
  const pairing = await loadPairing()
  if (pairing === null) return null
  const { instanceUrl, token } = pairing
  return {
    baseUrl: instanceUrl,
    authHeaders: () => ({ authorization: `Bearer ${token}` }),
    credentials: 'omit',
  }
}

/** Validate, normalize, and persist the desktop pairing. Rejects on invalid input. */
export function saveDesktopSession(url: string, token: string): Promise<void> {
  return savePairing(url, token)
}
