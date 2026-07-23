/**
 * FROZEN transport + session seam (desktop Task A). The SPA runs in two shells:
 *
 *  - **web** (browser, served by the instance): same-origin relative URLs, cookie auth,
 *    `window.fetch` — byte-identical to the pre-desktop behavior.
 *  - **desktop** (Tauri webview): user-configured instance base URL, `ot_` bearer token,
 *    and `@tauri-apps/plugin-http`'s `fetch` (Rust reqwest — no browser CORS; the
 *    self-hosted server ships no CORS headers, so `window.fetch` cannot work there).
 *
 * `isTauri()` selects the shell at runtime; the desktop-only module is loaded via dynamic
 * import so the web bundle never executes (or needs) any Tauri code.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** Browser fetch for web; tauri-plugin-http fetch for desktop (bypasses CORS). */
export async function resolveTransport(): Promise<FetchLike> {
  if (isTauri()) {
    const { fetch } = await import('@tauri-apps/plugin-http')
    return fetch as unknown as FetchLike
  }
  // Bare global `fetch` — exactly what the pre-desktop client called (in the browser this
  // IS window.fetch; in node-env vitest it stays the undici global, keeping tests shellless).
  return (input, init) => fetch(input, init)
}

export interface ApiSession {
  /** `''` for web same-origin; `'https://instance.example'` (no trailing slash) for desktop. */
  baseUrl: string
  /** `{}` for cookie-authenticated web; `{ authorization: 'Bearer ot_…' }` for desktop. */
  authHeaders(): Record<string, string>
  /** `'include'` for web (session cookie); `'omit'` for desktop (bearer only). */
  credentials: RequestCredentials
}

/** The unchanged web behavior: same-origin, cookies, no extra headers. */
export const WEB_SESSION: ApiSession = {
  baseUrl: '',
  authHeaders: () => ({}),
  credentials: 'include',
}
