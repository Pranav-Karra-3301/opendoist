import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config'

/**
 * Production-build variant of the e2e harness (phase-10 Task O Step 8): instead of the
 * vite dev server + API proxy pair, the built SPA (`apps/web/dist` — run
 * `pnpm --filter @opendoist/web build` first) is served BY the API server itself via
 * `OPENDOIST_WEB_DIST`, exactly like the shipped Docker image. Specs run same-origin on
 * :7968, which also exercises the real `/sw.js` + `/manifest.webmanifest` static serving.
 *
 * Usage: `pnpm --filter @opendoist/web exec playwright test a11y- --config playwright.prod.config.ts`
 */
const ORIGIN = 'http://localhost:7968'

export default defineConfig({
  ...baseConfig,
  use: { ...baseConfig.use, baseURL: ORIGIN },
  webServer: [
    {
      command:
        'OPENDOIST_DATA_DIR="$(mktemp -d)" OPENDOIST_PUBLIC_URL=http://localhost:7968 OPENDOIST_DISABLE_UPDATE_CHECK=true OPENDOIST_WEB_DIST=../web/dist pnpm --filter @opendoist/server start',
      url: `${ORIGIN}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
