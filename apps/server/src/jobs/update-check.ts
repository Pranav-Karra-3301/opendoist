/**
 * GitHub-releases update check — phase 9 (plan Task O), FROZEN signatures (Task A Step 5).
 *
 * A daily croner job (jobs/registry.ts) calls `checkForUpdate(config.version)`; the result is
 * cached in module state and surfaced by `/api/v1/info` via `getUpdateState()` (app.ts). Never
 * throws to the scheduler — a non-200 or network failure warn-logs and keeps the previous state.
 *
 * AS-BUILT ADAPTATION (Task A): `checkForUpdate` takes the current version explicitly
 * (`config.version` — the same accessor `/api/v1/info` reports); there is no global config here.
 */
import type { Logger } from 'pino'
import { loadConfig } from '../config'
import { createLogger } from '../logger'

export interface UpdateState {
  latestVersion: string
  url: string
  updateAvailable: boolean
  checkedAt: string
}

/** GitHub releases API for the published OpenTask repo (dossier §4.5). */
const RELEASES_LATEST_URL =
  'https://api.github.com/repos/pranav-karra-3301/opentask/releases/latest'
/** Fallback when a release has no `html_url` (should not happen for real releases). */
const RELEASES_PAGE_URL = 'https://github.com/pranav-karra-3301/opentask/releases'

/** Module state: most recent successful check. `checkForUpdate` writes `stateRef.current`. */
const stateRef: { current: UpdateState | null } = { current: null }

export function getUpdateState(): UpdateState | null {
  return stateRef.current
}

/** Lazy warn-only logger (no logger is injected into the frozen signature). Silent under Vitest. */
let warn: ((data: Record<string, unknown>, msg: string) => void) | undefined
function warnLog(data: Record<string, unknown>, msg: string): void {
  if (warn === undefined) {
    if (process.env.VITEST) {
      warn = () => {}
    } else {
      const logger: Logger = createLogger(loadConfig())
      warn = (d, m) => logger.warn(d, m)
    }
  }
  warn(data, msg)
}

/**
 * GET releases/latest → update state. On a non-200 or network error, warn-log, keep the previous
 * cached state, and return it (so the daily job is self-healing and never crashes boot).
 */
export async function checkForUpdate(
  currentVersion: string,
  fetchImpl?: typeof fetch,
): Promise<UpdateState | null> {
  const doFetch = fetchImpl ?? fetch
  try {
    const res = await doFetch(RELEASES_LATEST_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `opentask/${currentVersion}`,
      },
    })
    if (!res.ok) {
      warnLog({ status: res.status }, 'update check: non-200 from GitHub releases')
      return stateRef.current
    }
    const body = (await res.json()) as { tag_name?: string; html_url?: string }
    const tag = typeof body.tag_name === 'string' ? body.tag_name.trim() : ''
    if (tag === '') {
      warnLog({}, 'update check: latest release has no tag_name')
      return stateRef.current
    }
    const latestVersion = tag.replace(/^v/i, '')
    const next: UpdateState = {
      latestVersion,
      url:
        typeof body.html_url === 'string' && body.html_url !== ''
          ? body.html_url
          : RELEASES_PAGE_URL,
      updateAvailable: compareSemver(latestVersion, currentVersion) > 0,
      checkedAt: new Date().toISOString(),
    }
    stateRef.current = next
    return next
  } catch (err) {
    warnLog({ err }, 'update check: request to GitHub releases failed')
    return stateRef.current
  }
}

/**
 * Numeric dot-segment compare of two versions. Tolerant of a leading `v`/`V`, missing segments
 * (`1.2` == `1.2.0`), and prerelease/build suffixes (compares only the numeric `major.minor.patch`
 * triple, so `1.2.3-dev` == `1.2.3`). Returns -1 (a<b), 0 (a==b), or 1 (a>b).
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const triple = (v: string): [number, number, number] => {
    // strip leading v, then drop any prerelease (-) or build (+) suffix.
    const core = v.trim().replace(/^v/i, '').split(/[-+]/, 1)[0] ?? ''
    const parts = core.split('.').map((s) => {
      const n = Number.parseInt(s, 10)
      return Number.isFinite(n) ? n : 0
    })
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
  }
  const pa = triple(a)
  const pb = triple(b)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] as number
    const y = pb[i] as number
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}
