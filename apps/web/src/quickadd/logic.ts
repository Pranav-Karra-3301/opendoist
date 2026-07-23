import { DEFAULT_PARSE_CONTEXT_SETTINGS, type ParseContext } from '@opentask/core'
import { z } from 'zod'
import { api, endpoints } from '@/api/client'

/** Pure popover logic, kept out of App.tsx so tests (and future callers) can import it
 *  without paying for the component tree's module graph. */
export function desktopParseContext(now: Date = new Date()): ParseContext {
  return {
    now: now.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...DEFAULT_PARSE_CONTEXT_SETTINGS,
  }
}

/** Submit raw Quick Add text to the instance. Rides the shared `api` client, so on desktop it
 *  goes through the paired `ApiSession` (bearer token, tauri-plugin-http, no CORS). The server
 *  re-parses the text and auto-creates any referenced #project/@label. */
export function submitQuickAdd(text: string): Promise<unknown> {
  return api(endpoints.quick, { method: 'POST', body: { text }, schema: z.unknown() })
}
