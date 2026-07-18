/**
 * Desktop pairing persistence (Task B) — the store-backed source of truth for the
 * `{ instanceUrl, token }` pair that `../api/desktop-session.ts` turns into an
 * `ApiSession`, and that the pairing UI reads/writes.
 *
 * Persisted via `@tauri-apps/plugin-store` (`settings.json` in the app data dir),
 * pulled in through a dynamic `import()` (mirrors `../api/transport.ts`) so the web
 * bundle never links any Tauri store code — every entry point here is desktop-only.
 *
 * Failure semantics: reads (`loadPairing`) treat any store failure as "unpaired"
 * (`null`) and never throw — a not-yet-paired or non-Tauri shell simply has no session.
 * Reads also re-validate the stored URL (the store file is hand-editable; a non-https
 * URL on disk reads as unpaired rather than leaking the bearer over cleartext).
 * Writes (`savePairing`) validate BEFORE persisting and surface store failures so the
 * pairing flow can report them.
 *
 * Security: the `od_` token is persisted verbatim but MUST NEVER be logged, echoed, or
 * placed in a URL — only in the `Authorization` header built by `desktop-session.ts`.
 */

const STORE_PATH = 'settings.json'
const KEY_INSTANCE_URL = 'instanceUrl'
const KEY_TOKEN = 'token'

export interface StoredPairing {
  /** https instance base URL, no trailing slash. */
  instanceUrl: string
  /** `od_` bearer token. */
  token: string
}

/**
 * Validate + normalize a user-supplied instance URL: require an absolute `https://`
 * URL and strip trailing slashes (so `baseUrl + '/api/v1'` never double-slashes).
 * Throws with a human-readable message on anything else. Pure — no store access.
 */
export function normalizeInstanceUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim()
  if (trimmed === '') throw new Error('Instance URL is required')
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('Instance URL is not a valid URL')
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Instance URL must use https://')
  }
  return trimmed.replace(/\/+$/, '')
}

/**
 * Validate + normalize a user-supplied API token: non-empty and `od_`-prefixed.
 * Throws on anything else. Pure — no store access.
 */
export function normalizeToken(rawToken: string): string {
  const trimmed = rawToken.trim()
  if (trimmed === '') throw new Error('API token is required')
  if (!trimmed.startsWith('od_')) throw new Error('API token must start with "od_"')
  return trimmed
}

async function openStore() {
  const { Store } = await import('@tauri-apps/plugin-store')
  return Store.load(STORE_PATH)
}

/**
 * Read the persisted pairing, or `null` when unpaired (or when the store is
 * unavailable, e.g. outside a Tauri webview). Never throws.
 *
 * The stored URL is re-validated through the SAME `normalizeInstanceUrl` gate as
 * `savePairing`: `settings.json` is a plain, hand-editable file in the app data dir, and
 * a non-https instance URL read back from it must be treated as unpaired — never let the
 * `od_` bearer travel over cleartext http (plan: "Reject non-https:// instance URLs",
 * enforced on write AND read). The Rust reminders watcher applies the same load-time
 * rule (`is_https_url` in `apps/desktop/src-tauri/src/reminders.rs`) — keep them in sync.
 */
export async function loadPairing(): Promise<StoredPairing | null> {
  try {
    const store = await openStore()
    const storedUrl = await store.get<string>(KEY_INSTANCE_URL)
    const token = await store.get<string>(KEY_TOKEN)
    if (typeof storedUrl !== 'string' || typeof token !== 'string') return null
    if (storedUrl === '' || token === '') return null
    // Throws on http:// / non-URL values → caught below → unpaired.
    return { instanceUrl: normalizeInstanceUrl(storedUrl), token }
  } catch {
    return null
  }
}

/**
 * Validate, normalize, and persist a pairing. Throws on invalid input (bad URL or
 * token) BEFORE touching the store, so a rejected call leaves the store untouched.
 * Surfaces store write failures. Never logs the token.
 */
export async function savePairing(rawUrl: string, rawToken: string): Promise<void> {
  const instanceUrl = normalizeInstanceUrl(rawUrl)
  const token = normalizeToken(rawToken)
  const store = await openStore()
  await store.set(KEY_INSTANCE_URL, instanceUrl)
  await store.set(KEY_TOKEN, token)
  await store.save()
}

/** Remove the persisted pairing (unpair / disconnect). */
export async function clearPairing(): Promise<void> {
  const store = await openStore()
  await store.delete(KEY_INSTANCE_URL)
  await store.delete(KEY_TOKEN)
  await store.save()
}
