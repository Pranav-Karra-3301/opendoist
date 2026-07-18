/**
 * Unit tests for the desktop pairing session layer (Task B):
 *  - `normalizeInstanceUrl` / `normalizeToken` validation + normalization (pure)
 *  - save → load round-trip through a mocked `@tauri-apps/plugin-store`
 *  - the frozen `getDesktopSession`/`saveDesktopSession` contract (ApiSession shape,
 *    https rejection, and — critically — that reads NEVER throw when the store is
 *    unavailable, which is what keeps the unpaired-desktop fallback in `transport.test.ts`
 *    green now that `getDesktopSession` is store-backed).
 *
 * The real store hits Tauri IPC (absent in node-env vitest), so it is faked in memory —
 * the same approach `transport.test.ts` takes for `@tauri-apps/plugin-http`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const backing = new Map<string, unknown>()
const storeGet = vi.fn((key: string): Promise<unknown> => Promise.resolve(backing.get(key)))
const storeSet = vi.fn((key: string, value: unknown): Promise<void> => {
  backing.set(key, value)
  return Promise.resolve()
})
const storeDelete = vi.fn((key: string): Promise<boolean> => Promise.resolve(backing.delete(key)))
const storeSave = vi.fn((): Promise<void> => Promise.resolve())
const storeLoad = vi.fn(() =>
  Promise.resolve({ get: storeGet, set: storeSet, delete: storeDelete, save: storeSave }),
)

vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load: storeLoad } }))

beforeEach(() => {
  backing.clear()
  vi.clearAllMocks()
})

describe('normalizeInstanceUrl', () => {
  it('strips a trailing slash', async () => {
    const { normalizeInstanceUrl } = await import('./session-store')
    expect(normalizeInstanceUrl('https://tasks.example.com/')).toBe('https://tasks.example.com')
  })

  it('strips multiple trailing slashes', async () => {
    const { normalizeInstanceUrl } = await import('./session-store')
    expect(normalizeInstanceUrl('https://tasks.example.com///')).toBe('https://tasks.example.com')
  })

  it('keeps a URL that has no trailing slash', async () => {
    const { normalizeInstanceUrl } = await import('./session-store')
    expect(normalizeInstanceUrl('https://tasks.example.com')).toBe('https://tasks.example.com')
  })

  it('preserves a sub-path deploy while stripping its trailing slash', async () => {
    const { normalizeInstanceUrl } = await import('./session-store')
    expect(normalizeInstanceUrl('https://host.example.com/opendoist/')).toBe(
      'https://host.example.com/opendoist',
    )
  })

  it('trims surrounding whitespace', async () => {
    const { normalizeInstanceUrl } = await import('./session-store')
    expect(normalizeInstanceUrl('  https://tasks.example.com  ')).toBe('https://tasks.example.com')
  })

  it('rejects a non-https (http) URL', async () => {
    const { normalizeInstanceUrl } = await import('./session-store')
    expect(() => normalizeInstanceUrl('http://tasks.example.com')).toThrow(/https/i)
  })

  it('rejects an empty URL', async () => {
    const { normalizeInstanceUrl } = await import('./session-store')
    expect(() => normalizeInstanceUrl('   ')).toThrow(/required/i)
  })

  it('rejects a string that is not an absolute URL', async () => {
    const { normalizeInstanceUrl } = await import('./session-store')
    expect(() => normalizeInstanceUrl('tasks.example.com')).toThrow(/valid/i)
  })
})

describe('normalizeToken', () => {
  it('accepts and trims an od_ token', async () => {
    const { normalizeToken } = await import('./session-store')
    expect(normalizeToken('  od_abc123  ')).toBe('od_abc123')
  })

  it('rejects an empty token', async () => {
    const { normalizeToken } = await import('./session-store')
    expect(() => normalizeToken('   ')).toThrow(/required/i)
  })

  it('rejects a token without the od_ prefix', async () => {
    const { normalizeToken } = await import('./session-store')
    expect(() => normalizeToken('abc123')).toThrow(/od_/)
  })
})

describe('savePairing / loadPairing', () => {
  it('round-trips a normalized pairing through the store', async () => {
    const { savePairing, loadPairing } = await import('./session-store')
    await savePairing('https://tasks.example.com/', 'od_secret123')
    expect(storeSave).toHaveBeenCalled()
    expect(await loadPairing()).toEqual({
      instanceUrl: 'https://tasks.example.com',
      token: 'od_secret123',
    })
  })

  it('persists the URL already stripped of its trailing slash', async () => {
    const { savePairing } = await import('./session-store')
    await savePairing('https://tasks.example.com/', 'od_secret123')
    expect(storeSet).toHaveBeenCalledWith('instanceUrl', 'https://tasks.example.com')
  })

  it('rejects a non-https URL WITHOUT writing to the store', async () => {
    const { savePairing } = await import('./session-store')
    await expect(savePairing('http://insecure.example.com', 'od_secret123')).rejects.toThrow(
      /https/i,
    )
    expect(storeSet).not.toHaveBeenCalled()
    expect(storeSave).not.toHaveBeenCalled()
  })

  it('rejects a bad token WITHOUT writing to the store', async () => {
    const { savePairing } = await import('./session-store')
    await expect(savePairing('https://tasks.example.com', 'nope')).rejects.toThrow(/od_/)
    expect(storeSet).not.toHaveBeenCalled()
  })

  it('returns null when unpaired (empty store)', async () => {
    const { loadPairing } = await import('./session-store')
    expect(await loadPairing()).toBeNull()
  })

  it('returns null when only one of the two keys is present', async () => {
    const { loadPairing } = await import('./session-store')
    backing.set('instanceUrl', 'https://tasks.example.com')
    expect(await loadPairing()).toBeNull()
  })

  it('returns null (never throws) when the store is unavailable', async () => {
    const { loadPairing } = await import('./session-store')
    storeLoad.mockRejectedValueOnce(new Error('no tauri ipc'))
    await expect(loadPairing()).resolves.toBeNull()
  })
})

/**
 * Load-time hardening: `settings.json` is a plain file in the app data dir, so a
 * hand-edited (or corrupted) pairing must NOT be trusted just because it parses as
 * strings. In particular a non-https instance URL read back from disk must be treated
 * as unpaired — otherwise the `od_` bearer would travel over cleartext http even though
 * `savePairing` could never have written that URL (plan: "Reject non-https:// instance
 * URLs", enforced on BOTH write and read).
 */
describe('loadPairing re-validation (hand-edited store)', () => {
  it('treats a stored http:// instance URL as unpaired', async () => {
    const { loadPairing } = await import('./session-store')
    backing.set('instanceUrl', 'http://localhost:32416')
    backing.set('token', 'od_secret123')
    expect(await loadPairing()).toBeNull()
  })

  it('treats a stored non-URL instance URL as unpaired', async () => {
    const { loadPairing } = await import('./session-store')
    backing.set('instanceUrl', 'tasks.example.com')
    backing.set('token', 'od_secret123')
    expect(await loadPairing()).toBeNull()
  })

  it('re-normalizes a hand-edited https URL (trailing slash stripped on load)', async () => {
    const { loadPairing } = await import('./session-store')
    backing.set('instanceUrl', 'https://tasks.example.com///')
    backing.set('token', 'od_secret123')
    expect(await loadPairing()).toEqual({
      instanceUrl: 'https://tasks.example.com',
      token: 'od_secret123',
    })
  })

  it('never mints a bearer ApiSession from a hand-edited http:// pairing', async () => {
    const { getDesktopSession } = await import('../api/desktop-session')
    backing.set('instanceUrl', 'http://localhost:32416')
    backing.set('token', 'od_secret123')
    expect(await getDesktopSession()).toBeNull()
  })
})

describe('clearPairing', () => {
  it('removes the persisted pairing', async () => {
    const { savePairing, clearPairing, loadPairing } = await import('./session-store')
    await savePairing('https://tasks.example.com', 'od_secret123')
    await clearPairing()
    expect(storeDelete).toHaveBeenCalledWith('instanceUrl')
    expect(storeDelete).toHaveBeenCalledWith('token')
    expect(await loadPairing()).toBeNull()
  })
})

describe('getDesktopSession / saveDesktopSession (frozen contract)', () => {
  it('returns null while unpaired', async () => {
    const { getDesktopSession } = await import('../api/desktop-session')
    expect(await getDesktopSession()).toBeNull()
  })

  it('exposes a paired instance as a bearer, cookie-less ApiSession', async () => {
    const { saveDesktopSession, getDesktopSession } = await import('../api/desktop-session')
    await saveDesktopSession('https://tasks.example.com/', 'od_secret123')
    const session = await getDesktopSession()
    expect(session).not.toBeNull()
    expect(session?.baseUrl).toBe('https://tasks.example.com')
    expect(session?.credentials).toBe('omit')
    expect(session?.authHeaders()).toEqual({ authorization: 'Bearer od_secret123' })
  })

  it('never puts the token in the base URL', async () => {
    const { saveDesktopSession, getDesktopSession } = await import('../api/desktop-session')
    await saveDesktopSession('https://tasks.example.com', 'od_secret123')
    const session = await getDesktopSession()
    expect(session?.baseUrl).not.toContain('od_secret123')
  })

  it('saveDesktopSession rejects a non-https instance URL', async () => {
    const { saveDesktopSession } = await import('../api/desktop-session')
    await expect(saveDesktopSession('http://insecure.example.com', 'od_secret123')).rejects.toThrow(
      /https/i,
    )
  })

  it('getDesktopSession never throws when the store is unavailable', async () => {
    const { getDesktopSession } = await import('../api/desktop-session')
    storeLoad.mockRejectedValueOnce(new Error('no tauri ipc'))
    await expect(getDesktopSession()).resolves.toBeNull()
  })
})
