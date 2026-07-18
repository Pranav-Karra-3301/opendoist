/**
 * Frozen-contract tests for the desktop transport seam (Task A):
 *  - `isTauri()` detection, `WEB_SESSION` shape, transport selection
 *  - the web path through `client.ts` stays byte-identical (same URL, cookie
 *    credentials, no extra headers)
 *  - under Tauri the tauri-plugin-http fetch carries the request (and an unpaired
 *    desktop falls back to the web session values)
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const pluginFetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: pluginFetch }))

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  pluginFetch.mockReset()
})

describe('isTauri', () => {
  it('is false outside a Tauri webview (no window at all in node)', async () => {
    const { isTauri } = await import('./transport')
    expect(isTauri()).toBe(false)
  })

  it('is true when window.__TAURI_INTERNALS__ exists', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
    const { isTauri } = await import('./transport')
    expect(isTauri()).toBe(true)
  })

  it('is false for a window without the marker', async () => {
    vi.stubGlobal('window', {})
    const { isTauri } = await import('./transport')
    expect(isTauri()).toBe(false)
  })
})

describe('WEB_SESSION (frozen web behavior)', () => {
  it('is same-origin, cookie-authenticated, header-free', async () => {
    const { WEB_SESSION } = await import('./transport')
    expect(WEB_SESSION.baseUrl).toBe('')
    expect(WEB_SESSION.credentials).toBe('include')
    expect(WEB_SESSION.authHeaders()).toEqual({})
  })
})

describe('resolveTransport', () => {
  it('web: passes through to the global fetch', async () => {
    const globalFetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', globalFetch)
    const { resolveTransport } = await import('./transport')
    const transport = await resolveTransport()
    await transport('/api/v1/info', { method: 'GET' })
    expect(globalFetch).toHaveBeenCalledWith('/api/v1/info', { method: 'GET' })
  })

  it('tauri: returns the tauri-plugin-http fetch', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
    pluginFetch.mockResolvedValue(jsonResponse({ ok: true }))
    const { resolveTransport } = await import('./transport')
    const transport = await resolveTransport()
    // The plugin fetch is returned directly (no wrapper), so the single argument passes through.
    await transport('https://instance.example/api/v1/info')
    expect(pluginFetch).toHaveBeenCalledWith('https://instance.example/api/v1/info')
  })
})

describe('client.ts through the seam', () => {
  it('web GET is byte-identical: BASE + path, cookies included, no headers', async () => {
    const globalFetch = vi.fn().mockResolvedValue(jsonResponse({ id: 'u1' }))
    vi.stubGlobal('fetch', globalFetch)
    const { api } = await import('./client')
    await api('/user', { schema: z.object({ id: z.string() }) })
    expect(globalFetch).toHaveBeenCalledTimes(1)
    expect(globalFetch).toHaveBeenCalledWith('/api/v1/user', {
      method: 'GET',
      credentials: 'include',
      headers: {},
      body: undefined,
    })
  })

  it('web POST is byte-identical: json content-type only, no auth header', async () => {
    const globalFetch = vi.fn().mockResolvedValue(jsonResponse({ id: 't1' }))
    vi.stubGlobal('fetch', globalFetch)
    const { api } = await import('./client')
    await api('/tasks/quick', {
      method: 'POST',
      body: { text: 'pay rent tomorrow' },
      schema: z.object({ id: z.string() }),
    })
    expect(globalFetch).toHaveBeenCalledWith('/api/v1/tasks/quick', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'pay rent tomorrow' }),
    })
  })

  it('tauri: requests ride the plugin fetch; unpaired falls back to web session values', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
    const globalFetch = vi.fn()
    vi.stubGlobal('fetch', globalFetch)
    pluginFetch.mockResolvedValue(jsonResponse({ id: 'u1' }))
    const { api } = await import('./client')
    await api('/user', { schema: z.object({ id: z.string() }) })
    expect(globalFetch).not.toHaveBeenCalled()
    // getDesktopSession() is the Task A unpaired stub (null) → web session values.
    expect(pluginFetch).toHaveBeenCalledWith('/api/v1/user', {
      method: 'GET',
      credentials: 'include',
      headers: {},
      body: undefined,
    })
  })
})
