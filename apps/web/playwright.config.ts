import { defineConfig, devices } from '@playwright/test'
import { STORAGE_STATE } from './e2e/helpers'

const API_ORIGIN = 'http://127.0.0.1:7968'
const WEB_ORIGIN = 'http://127.0.0.1:5173'

/**
 * E2E config for the OpenDoist web shell. A `setup` project registers the first-run owner and
 * saves its session; every spec runs in the `chromium` project seeded from that storage state.
 *
 * AS-BUILT adjustments to the plan's draft webServer block (apps/server/package.json inspected):
 *  - Runs the server via `start` (`tsx src/index.ts`), NOT `dev`: the `dev` script hardcodes
 *    `OPENDOIST_DATA_DIR=./data`, which would clobber the outer env var and reuse a persistent DB
 *    (breaking first-run registration on the second run). `start` sets no data dir of its own.
 *  - `OPENDOIST_DATA_DIR="$(mktemp -d)"` gives every run a fresh SQLite DB (auto-migrated on boot),
 *    so `owner@example.com` can always be registered as the first account.
 *  - `OPENDOIST_PUBLIC_URL=http://127.0.0.1:5173` makes the API's public origin the web origin the
 *    browser actually uses (vite proxies /api → 7968). better-auth trusts only its baseURL origin,
 *    so without this the register/login POSTs would be rejected as cross-origin. This is the
 *    intended use of a public URL behind a reverse proxy (vite is that proxy here).
 *  - Health probe is the confirmed `GET /api/health` (app.ts) → `{ status: 'ok' }`.
 *
 * Tests share one server + one DB, so they run serially (workers: 1, fullyParallel: false) to keep
 * cross-spec task/count state deterministic.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: 'list',
  expect: { timeout: 10_000 },
  use: {
    baseURL: WEB_ORIGIN,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
  ],
  webServer: [
    {
      command:
        // OPENDOIST_DISABLE_UPDATE_CHECK: the phase-9 boot-time update.check job would otherwise
        // call the real GitHub releases API on every suite run (external network, nondeterministic).
        'OPENDOIST_DATA_DIR="$(mktemp -d)" OPENDOIST_PUBLIC_URL=http://127.0.0.1:5173 OPENDOIST_DISABLE_UPDATE_CHECK=true pnpm --filter @opendoist/server start',
      // Everything in the e2e path is pinned to the IPv4 literal: this host's resolver is
      // slow/erratic (~300ms+ per localhost lookup, hangs in bad windows), and vite binds
      // `localhost` as ::1-only — the combination produced webServer timeouts with a healthy
      // stack. 127.0.0.1 end-to-end (probe, bind via --host, baseURL, PUBLIC_URL) removes
      // DNS from the loop entirely; better-auth's dev trustedOrigins already include it.
      url: 'http://127.0.0.1:7968/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // `exec vite` (not the dev script): pnpm forwarded the `--` separator INTO vite, which
      // treats everything after a bare `--` as non-flags — so --host/--port/--strictPort were
      // silently ignored and vite sat on its defaults (::1-only bind, port 5173 by luck).
      command: 'pnpm --filter @opendoist/web exec vite --host 127.0.0.1 --port 5173 --strictPort',
      url: 'http://127.0.0.1:5173/',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
