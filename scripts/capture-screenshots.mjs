/**
 * Capture the README screenshots against a real, seeded OpenTask instance.
 *
 * Pipeline (all throwaway state in an OS temp dir, torn down on exit):
 *   1. ensure the web app is built (`apps/web/dist`) — the server serves it as the SPA
 *   2. seed a fresh SQLite DB via `pnpm seed` (creates the demo user + the frozen dataset)
 *   3. boot the server (`tsx src/index.ts`) on a random port, serving that dist + DB
 *   4. drive headless Chromium (1440x900 @2x): log in as the demo user, capture
 *        docs/screenshots/hero.png       — Today view, Kale (light)
 *        docs/screenshots/hero-dark.png  — same view, data-theme="dark"
 *        docs/screenshots/quick-add.png  — Quick Add open with live token highlights
 *   5. tear everything down
 *
 * AS-BUILT notes (deviations from the plan's Task K Step 1 draft, all verified against the repo):
 *   - The server has NO build step / no `apps/server/dist` — it runs through `tsx` (see
 *     apps/server/package.json `start`). We therefore start it with `pnpm --filter
 *     @opentask/server start` and point it at the *web* build via OPENTASK_WEB_DIST, so a
 *     single origin serves both the API and the SPA (app.ts static-SPA fallback). All web
 *     API/auth calls are same-origin relative (api/client.ts `BASE='/api/v1'`; auth/client.ts
 *     omits baseURL), so no separate web server or proxy is needed.
 *   - Playwright's `chromium` is imported from `@playwright/test` (a direct web devDependency);
 *     the bare `playwright` package is not hoisted. We resolve it through the web workspace with
 *     `createRequire` — no new dependency is added.
 *   - A random high port (overridable via OPENTASK_SCREENSHOT_PORT) keeps parallel build agents
 *     from colliding, per the crew's "unique random ports" rule.
 *   - Seed runs BEFORE the server starts (zero connection overlap on the WAL DB) rather than the
 *     plan's after-boot ordering.
 *   - Dark mode is toggled the app's real way: `data-theme="dark"` on <html> (lib/theme.ts).
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const OUT_REL = 'docs/screenshots'
const OUT_DIR = join(ROOT, OUT_REL)
const WEB_DIST = join(ROOT, 'apps/web/dist')
const require = createRequire(join(ROOT, 'apps/web/package.json'))
const { chromium } = require('@playwright/test')

const PORT = Number(
  process.env.OPENTASK_SCREENSHOT_PORT ?? 20000 + Math.floor(Math.random() * 40000),
)
const ORIGIN = `http://localhost:${PORT}`
const DEMO = { email: 'demo@opentask.local', password: 'opentask-demo' }
const VIEWPORT = { width: 1440, height: 900 }

/** Run a command to completion; reject with captured output on a non-zero exit. */
function run(cmd, args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env } })
    let out = ''
    child.stdout.on('data', (d) => {
      out += d
    })
    child.stderr.on('data', (d) => {
      out += d
    })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0
        ? resolvePromise(out)
        : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}\n${out}`)),
    )
  })
}

/** Boot the server as a long-lived child; resolve once /api/health reports ok. */
async function startServer(dataDir) {
  const child = spawn('pnpm', ['--filter', '@opentask/server', 'start'], {
    cwd: ROOT,
    env: {
      ...process.env,
      OPENTASK_DATA_DIR: dataDir,
      OPENTASK_PORT: String(PORT),
      OPENTASK_WEB_DIST: WEB_DIST,
      OPENTASK_PUBLIC_URL: ORIGIN,
      OPENTASK_DISABLE_UPDATE_CHECK: 'true',
      OPENTASK_LOG_LEVEL: 'warn',
    },
  })
  let log = ''
  child.stdout.on('data', (d) => {
    log += d
  })
  child.stderr.on('data', (d) => {
    log += d
  })
  let exited = false
  child.on('exit', () => {
    exited = true
  })

  for (let i = 0; i < 60; i++) {
    if (exited) throw new Error(`server exited during boot\n${log}`)
    try {
      const res = await fetch(`${ORIGIN}/api/health`)
      if (res.ok) {
        const body = await res.json()
        if (body?.status === 'ok') return child
      }
    } catch {
      // not up yet
    }
    await sleep(1000)
  }
  throw new Error(`server /api/health never came up on ${ORIGIN}\n${log}`)
}

/** Read a PNG's pixel dimensions from its IHDR chunk. */
async function pngSize(file) {
  const head = await readFile(file)
  return `${head.readUInt32BE(16)}x${head.readUInt32BE(20)}`
}

async function main() {
  // 1. Build the web app if the SPA the server serves is missing.
  if (!existsSync(join(WEB_DIST, 'index.html'))) {
    console.log('building web app (apps/web/dist missing)…')
    await run('pnpm', ['--filter', '@opentask/web', 'build'], {})
  }

  const dataDir = await mkdtemp(join(tmpdir(), 'opentask-shots-'))
  let server = null
  let browser = null
  try {
    // 2. Seed the frozen dataset (creates the demo user + demo data) into the fresh DB.
    console.log('seeding demo data…')
    await run('pnpm', ['--filter', '@opentask/server', 'seed'], {
      OPENTASK_DATA_DIR: dataDir,
      OPENTASK_DISABLE_UPDATE_CHECK: 'true',
    })

    // 3. Boot the server serving that DB + the web build.
    console.log(`starting server on ${ORIGIN}…`)
    server = await startServer(dataDir)

    // 4. Drive the browser.
    browser = await chromium.launch()
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 })
    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', (err) => pageErrors.push(String(err)))

    // Log in as the demo user.
    await page.goto(`${ORIGIN}/login`, { waitUntil: 'domcontentloaded' })
    await page.fill('input[name="email"]', DEMO.email)
    await page.fill('input[name="password"]', DEMO.password)
    await page.click('button[type="submit"]')
    await page.waitForURL('**/today', { timeout: 20_000 })
    // NOT `waitForLoadState('networkidle')`: the app holds a long-lived SSE connection
    // (/api/v1/events), so the network never goes idle — the same as-built pitfall
    // playwright.config.ts documents. A visible task row + settled web fonts are the
    // deterministic "rendered" signal instead (Task O fix; Task K could not execute this
    // script before the integration gate).
    await page.locator('[id^="task-"]').first().waitFor({ state: 'visible', timeout: 20_000 })
    await page.evaluate(() => document.fonts.ready)
    await sleep(400)

    const shots = []

    // (a) Hero — Today, Kale light.
    let file = join(OUT_DIR, 'hero.png')
    await page.screenshot({ path: file })
    shots.push(file)

    // (b) Hero — Today, dark. Toggle the app's real theme mechanism.
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark')
      document.documentElement.style.colorScheme = 'dark'
    })
    await sleep(400)
    file = join(OUT_DIR, 'hero-dark.png')
    await page.screenshot({ path: file })
    shots.push(file)

    // Back to Kale light for the Quick Add capture.
    await page.evaluate(() => {
      document.documentElement.removeAttribute('data-theme')
      document.documentElement.style.colorScheme = ''
    })
    await sleep(200)

    // (c) Quick Add open, showing live token highlights.
    await page.keyboard.press('q')
    await page.getByRole('dialog', { name: 'Quick add task' }).waitFor({ state: 'visible' })
    const input = page.getByRole('textbox', { name: 'Quick add task' })
    // Trailing space: it closes the final `@deep-work` token, so the label-autocomplete
    // popover is not left open (it would clip at the viewport edge in the capture).
    await input.fill('Prepare launch notes tomorrow 9am p2 #Work @deep-work ')
    // Wait for the live highlighter to tokenise (any [data-kind] chip means it parsed).
    await page.locator('[data-kind]').first().waitFor({ state: 'visible', timeout: 10_000 })
    await sleep(400)
    file = join(OUT_DIR, 'quick-add.png')
    await page.screenshot({ path: file })
    shots.push(file)

    if (pageErrors.length > 0) {
      throw new Error(`page raised ${pageErrors.length} error(s):\n${pageErrors.join('\n')}`)
    }

    for (const shot of shots) {
      console.log(`wrote ${OUT_REL}/${shot.split('/').pop()} (${await pngSize(shot)})`)
    }
  } finally {
    if (browser) await browser.close().catch(() => {})
    if (server) {
      server.kill('SIGTERM')
      await new Promise((r) => {
        server.on('exit', r)
        setTimeout(() => {
          server.kill('SIGKILL')
          r()
        }, 5000)
      })
    }
    await rm(dataDir, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
