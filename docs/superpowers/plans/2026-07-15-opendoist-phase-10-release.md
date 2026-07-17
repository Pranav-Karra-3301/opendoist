# OpenDoist Phase 10: Polish, PWA, A11y, Docs → 0.1.0 Release — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This run executes via a Workflow: Task A first (sequential), Tasks B–N in parallel (disjoint file sets, no commits, no `pnpm install`), Task O integrates, Task P runs the 0.1.0 release checklist.** Commits happen at integration checkpoints, not per-task, because tasks run concurrently in one working tree. Implementation agents run as Opus; integration/review agents as Fable.

**Goal:** Ship-quality 0.1.0: installable PWA (manifest + maskable icons + Workbox offline app shell + install prompts incl. iOS), an accessibility pass across every surface (axe-clean, labeled, focus-managed, reduced-motion-safe), a performance pass (virtualized long lists, SSE reconnect backoff, bundle budget), empty/error/skeleton states everywhere, a demo seed script, final README + docs pages, and a fully rehearsed release pipeline (git-cliff CHANGELOG, `prepare-release.yml`, docker smoke test in CI).

**Architecture:** Phase 10 adds no new product features — it hardens what phases 1–9 built. New code lands in: `apps/web/src/pwa/` (service-worker registration, install UX), `apps/web/src/sw.ts` (Workbox service worker), `apps/web/src/components/feedback/` (EmptyState/Skeleton/ErrorBoundary primitives), `apps/server/src/seed.ts`, `scripts/` (icons, screenshots, bundle check, docker smoke), `docs/` (user docs), `.github/workflows/` (release + docker smoke). Everything else is surgical edits to existing phase 3–9 files, guarded by AS-BUILT CHECKs because those phases may have drifted from their plans.

**Tech Stack (this phase):** vite-plugin-pwa (injectManifest strategy) + workbox-* 7, sharp (icon rasterization), @axe-core/playwright (a11y assertions), @tanstack/react-virtual 3, git-cliff 2 (via existing `cliff.toml`), GitHub Actions (`workflow_dispatch` release, docker build + smoke), gh CLI in workflows.

**Reference documents (already in repo, read before your task):**
- Spec: `docs/superpowers/specs/2026-07-15-opendoist-design.md` — §5 (release engineering & quality), §6 phase 10, §1 non-goals, §3.3 (PWA), §3.5 (env vars, ops)
- Dossier: `docs/superpowers/research/2026-07-15-opendoist-research.md` — §4.8–4.9 (docs/README/release patterns), §4.12 items 10–20, §5.2–5.3 (push platform support, permission UX)
- Exemplar repo state: phases 1–9 are already merged. **The FROZEN core contract is `packages/core/src/types.ts` — authoritative; never edit it; do not assume engine internals beyond exported signatures.**

## Global Constraints

- Priorities stored **1 = highest (p1) … 4 = default**. (Docs tasks must state the Todoist-API inversion explicitly.)
- Server port **7968**; env prefix **`OPENDOIST_`**; API tokens prefix **`od_`**; image `ghcr.io/pranav-karra-3301/opendoist`.
- Radii **5px / 10px only**; Kale accent **`#4c7a45`** (hover `#3e6737`); focus ring **always blue `#1f60c2`** (never the accent); `prefers-reduced-motion` respected.
- Biome formatting (`pnpm lint` must stay green); TypeScript `strict`, no `any`; `verbatimModuleSyntax`.
- Tests colocated (`src/**/*.test.ts` for unit; Playwright specs live in the web app's existing e2e dir).
- License AGPL-3.0. Conventional commit messages. SemVer 0.x, default branch `main`.
- **Parallel-execution rules:** builders touch ONLY their listed files; never run `pnpm install` (Task A declares all deps and installs once); never `git commit`; never edit another task's files — if a needed fix lands in a file owned by another task, write it into your result notes as `DEFERRED-FIX: <file>: <exact change>` for Task O to apply.
- **Drift rule:** phases 3–9 were built from separate plans and may differ in file names/paths. Every `AS-BUILT CHECK:` bullet below MUST be executed (with `ls`/`grep`) before editing; adapt paths to what actually exists and record adaptations in your result notes. If a whole capability your task depends on is missing (e.g. no Playwright at all), stop that step and report — do not build the missing phase.
- **Scope guard (spec §1 non-goals):** NO board/calendar layouts, NO CalDAV, NO email reminder channel, NO sharing/collaboration, NO localization. Docs must list these as non-goals, not promises. Nothing in this phase adds product features.

---

### Task A: Dependency + contract freeze (SEQUENTIAL — everything depends on this)

**Files:**
- Edit: `pnpm-workspace.yaml` (catalog additions), root `package.json` (scripts), `apps/web/package.json` (deps), `apps/server/package.json` (seed script)
- Create: `apps/web/src/components/feedback/empty-state.tsx`, `apps/web/src/components/feedback/skeleton.tsx`, `apps/web/src/components/feedback/error-boundary.tsx`, `apps/web/src/components/feedback/index.ts` (typed stubs; Task H replaces wholesale)
- Create: `apps/web/e2e/helpers/a11y.ts` (or the as-built e2e dir — see Step 1)
- Create: `apps/web/public/manifest.webmanifest`

- [ ] **Step 1: As-built survey (record all answers in your result notes — parallel tasks read them):**
  - `ls apps/` → confirm `server`, `web`, and CLI package location (`packages/cli` per spec).
  - AS-BUILT CHECK: Playwright — `ls apps/web/playwright.config.ts apps/web/e2e 2>/dev/null || grep -r "playwright" apps/web/package.json`. Record the e2e directory (assumed `apps/web/e2e/` below; substitute everywhere if different). Record how e2e serves the app (webServer command, port).
  - AS-BUILT CHECK: `grep -rn "OPENDOIST_" apps/server/src --include="*.ts" -l | head` → the config module path; record every env var actually read (docs Task L needs the true list).
  - AS-BUILT CHECK: `ls Dockerfile .github/workflows/` → record whether `docker.yml` exists and its trigger shape.
  - AS-BUILT CHECK: `grep -rn "better-auth" apps/server/src | head` → record the auth route mount path (assumed `/api/auth/*`) and the API-key creation route.
  - AS-BUILT CHECK: `grep -rn "EventSource\|/api/v1/events" apps/web/src -l` → record the SSE client file path.
  - AS-BUILT CHECK: `grep -rn "addEventListener('push'\|addEventListener(\"push\"" apps/web -l` → record where phase 6 put the push service worker (it must be merged into the single Workbox SW by Task C).
  - AS-BUILT CHECK: `grep -rn "seed" apps/server/package.json` and `grep -rn "tsx\|--experimental-strip-types" apps/server/package.json` → record how server TS files are executed for scripts.
- [ ] **Step 2: Catalog additions** — append to the `catalog:` map in `pnpm-workspace.yaml` (skip any key that already exists; record skips):
```yaml
  sharp: ^0.34.4
  vite-plugin-pwa: ^1.2.0
  workbox-core: ^7.3.0
  workbox-precaching: ^7.3.0
  workbox-routing: ^7.3.0
  workbox-strategies: ^7.3.0
  workbox-expiration: ^7.3.0
  workbox-window: ^7.3.0
  '@axe-core/playwright': ^4.10.2
  '@tanstack/react-virtual': ^3.13.0
```
  If a version fails to resolve at install time, set it to the latest published (`pnpm view <pkg> version`) and record the change.
- [ ] **Step 3: Root `package.json` scripts** — merge these entries into `"scripts"` (keep every existing entry, especially `verify`, unchanged):
```json
{
  "icons": "node scripts/generate-icons.mjs",
  "seed": "pnpm --filter @opendoist/server seed",
  "screenshots": "node scripts/capture-screenshots.mjs",
  "check:bundle": "node scripts/check-bundle.mjs",
  "smoke:docker": "bash scripts/smoke-docker.sh"
}
```
  Add `"sharp": "catalog:"` to root `devDependencies` (the two root scripts `icons`/`screenshots` run from root).
- [ ] **Step 4: `apps/web/package.json`** — add to `dependencies`: `"workbox-core"`, `"workbox-precaching"`, `"workbox-routing"`, `"workbox-strategies"`, `"workbox-expiration"`, `"workbox-window"`, `"@tanstack/react-virtual"` (all `"catalog:"`); add to `devDependencies`: `"vite-plugin-pwa": "catalog:"`, `"@axe-core/playwright": "catalog:"`. Do not remove anything.
- [ ] **Step 5: `apps/server/package.json`** — add script `"seed": "<as-built TS runner> src/seed.ts"` using the same runner the server's own dev/migrate scripts use (Step 1 survey). Example if the server uses tsx: `"seed": "tsx src/seed.ts"`.
- [ ] **Step 6: Frozen feedback primitives (typed stubs — Task H replaces implementation, API is FROZEN):**

`apps/web/src/components/feedback/empty-state.tsx`:
```tsx
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  /** optional single call-to-action */
  action?: { label: string; onClick: () => void }
  children?: ReactNode
}

/** Centered empty-state block: 48px icon in --od-text-tertiary, title 16/600, description 13px secondary, optional secondary button. Implemented by Task H. */
export function EmptyState({ title }: EmptyStateProps) {
  return <div role="status">{title}</div>
}
```

`apps/web/src/components/feedback/skeleton.tsx`:
```tsx
/** Shimmering placeholder rows. aria-hidden; parent supplies aria-busy. Implemented by Task H. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={className} />
}
export function TaskListSkeleton({ rows = 8 }: { rows?: number }) {
  return <div aria-hidden data-rows={rows} />
}
```

`apps/web/src/components/feedback/error-boundary.tsx`:
```tsx
import { Component, type ReactNode } from 'react'

export interface ODErrorBoundaryProps {
  /** surface name shown in the fallback, e.g. 'Today' */
  label: string
  children: ReactNode
}
interface State { error: Error | null }

/** Per-view error boundary: fallback card (radius 10px) with label, error message, and a Retry button that resets the boundary. Implemented by Task H. */
export class ODErrorBoundary extends Component<ODErrorBoundaryProps, State> {
  override state: State = { error: null }
  static getDerivedStateFromError(error: Error): State { return { error } }
  reset = () => this.setState({ error: null })
  override render() {
    if (this.state.error) return <div role="alert">{this.props.label} failed to load</div>
    return this.props.children
  }
}
```

`apps/web/src/components/feedback/index.ts`:
```ts
export { EmptyState, type EmptyStateProps } from './empty-state'
export { Skeleton, TaskListSkeleton } from './skeleton'
export { ODErrorBoundary, type ODErrorBoundaryProps } from './error-boundary'
```
- [ ] **Step 7: Frozen a11y test helper** — `apps/web/e2e/helpers/a11y.ts` (adjust dir to as-built):
```ts
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/** Shared axe gate: WCAG 2.x A+AA, zero serious/critical violations. */
export async function expectNoAxeViolations(page: Page, options?: { include?: string; exclude?: string[] }) {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
  if (options?.include) builder = builder.include(options.include)
  for (const sel of options?.exclude ?? []) builder = builder.exclude(sel)
  const results = await builder.analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(
    blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([])
}
```
- [ ] **Step 8: Frozen PWA manifest** — `apps/web/public/manifest.webmanifest` (verbatim; icons generated by Task B):
```json
{
  "name": "OpenDoist",
  "short_name": "OpenDoist",
  "description": "Self-hosted, single-user, keyboard-first task manager.",
  "id": "/",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#ffffff",
  "theme_color": "#fcfcf8",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "shortcuts": [
    { "name": "Today", "url": "/today", "icons": [{ "src": "/icons/icon-192.png", "sizes": "192x192" }] },
    { "name": "Inbox", "url": "/inbox", "icons": [{ "src": "/icons/icon-192.png", "sizes": "192x192" }] }
  ]
}
```
  AS-BUILT CHECK: `grep -rn "path:" apps/web/src` (router) — if routes are not `/today` and `/inbox`, fix the two `shortcuts.url` values to the real routes now.
- [ ] **Step 9: FROZEN A11Y ACCEPTANCE CHECKLIST** (Tasks D–G each apply all of it to their surfaces; copy verbatim into your working notes):
  1. `expectNoAxeViolations` passes on every screen/dialog the task owns (seeded data, light Kale + dark).
  2. Every icon-only button has `aria-label`; every input has a `<label>` or `aria-label`; task checkboxes read "Complete task: {content}".
  3. Landmarks: exactly one `main`; sidebar is `nav` with `aria-label="Projects and views"`; active nav item has `aria-current="page"`.
  4. Dialogs/popovers: focus moves in on open, is trapped, returns to the invoker on close; `Esc` closes; `role="dialog"` + `aria-labelledby` (verify Base UI provides it; add only what is missing).
  5. Focus visibility: interactive elements show the 2px `#1f60c2` ring via `:focus-visible` (token `--od-focus-ring`), never `outline: none` without replacement.
  6. Live regions: toasts/undo announce via `role="status"` (polite); destructive errors via `role="alert"`.
  7. Reduced motion: no transform/opacity animation runs under `prefers-reduced-motion: reduce` (rely on the tokens.css gate Task H owns; remove any component-level inline animations that bypass it).
  8. Keyboard walk documented in the spec file as assertions: the surface's primary flow is completable with keyboard only.
- [ ] **Step 10: FROZEN SEED DATASET** (Task J implements; Task K's screenshots and docs show it; do not deviate). One demo user `demo@opendoist.local` / password `opendoist-demo` (created only when the instance has no users). All due dates are computed relative to seed-run time via Quick Add strings so screenshots are always "today"-correct:
  - Projects: `Work` (blue, sections `Admin`, `Meetings`) · `Home` (lime_green) · `Groceries` (orange) · `Reading List` (taupe, favorite)
  - Labels: `email` (red) · `errands` (orange) · `deep-work` (blue) · `waiting` (grey) · `15min` (mint_green)
  - Filters: `Priority focus` = `(today | overdue) & (p1 | p2)` (red, favorite) · `Errands` = `@errands & !subtask` (grape)
  - Open tasks (Quick Add strings, target project in parens): `Ship weekly status update today 4pm p2 #Work /Admin @email` · `Prepare board deck tom 10am for 45min p1 #Work /Meetings @deep-work {friday}` · `Review pull requests every workday 9am p3 #Work` · `1:1 with future self every mon 2pm #Work /Meetings` · `Renew passport p1 @errands` (overdue: due yesterday — seed with `yesterday`) · `Water the plants every 3 days #Home` · `Fix squeaky door p4 #Home @15min` · `Deep clean kitchen this weekend #Home` · `Milk #Groceries` · `Eggs #Groceries` · `Coffee beans p2 #Groceries @errands` · `Read "The Design of Everyday Things" #Reading List @deep-work` · `* Reading queue #Reading List` (uncompletable) with subtasks `Article: local-first software #Reading List` and `Article: SQLite as app format #Reading List` · `Call the bank tom 9am !30 min before p2 @errands` · `Plan weekend trip next week #Home // collect ideas in comments` · `Submit expense report {end of month} p2 #Work /Admin @waiting`
  - Completed (for activity/productivity screenshots): 6 plain tasks in `Work`/`Home`, completed spread over the past 5 days (2/1/1/1/1).
- [ ] **Step 11: Frozen docs IA** (Tasks L/M write/extend pages; K links them): `docs/README.md` (index) → `docs/install.md` → `docs/configuration.md` → `docs/import-todoist.md` → `docs/voice-ramble.md` (EXISTS — phase 7 Task M created it; phase 10 Task M extends it with the STT sidecar recipe instead of creating a duplicate `docs/stt.md`) → `docs/backups.md` (EXISTS — phase 9 Task C created it; index it, don't recreate) → `docs/api.md` → `docs/cli.md` → `docs/faq.md`. Nine pages total; the index must link every doc that exists and no topic gets two pages. Plain markdown, relative links, no docs-site generator in 0.1.0 (Docusaurus is post-1.0 per spec §3.1).
- [ ] **Step 12: Install & gate** — run `pnpm install` once from repo root. Then `pnpm verify` MUST be green before parallel tasks start (phases 1–9 each ended green; if verify is red, STOP and report — phase 10 does not begin on a broken tree). Expected: lockfile updated; stubs compile; `pnpm lint` clean.

---

### Task B: PWA manifest wiring + icon generation (PARALLEL)

**Files:**
- Create: `scripts/generate-icons.mjs`
- Create (generated, committed): `apps/web/public/icons/icon-192.png`, `icon-512.png`, `maskable-192.png`, `maskable-512.png`, `apple-touch-icon.png`
- Edit: `apps/web/index.html`

**Interfaces:** consumes `assets/brand/icon.svg` (glyph uses `currentColor`) and the frozen manifest from Task A. Produces the icon set the manifest references.

- [ ] **Step 1:** `scripts/generate-icons.mjs` — sharp script, run from repo root:
```js
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const OUT = 'apps/web/public/icons'
const BRAND_GREEN = '#3e6737'
const svg = await readFile('assets/brand/icon.svg', 'utf8')
const tinted = (color) => Buffer.from(svg.replace(/currentColor/g, color))
await mkdir(OUT, { recursive: true })

/** any-purpose: green glyph, transparent bg, 12% padding */
async function anyIcon(size, file) {
  const glyph = await sharp(tinted(BRAND_GREEN)).resize(Math.round(size * 0.76)).png().toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: glyph, gravity: 'centre' }]).png().toFile(`${OUT}/${file}`)
}
/** maskable: white glyph at 62% inside full-bleed brand-green square (80% safe zone) */
async function maskableIcon(size, file) {
  const glyph = await sharp(tinted('#ffffff')).resize(Math.round(size * 0.62)).png().toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background: BRAND_GREEN } })
    .composite([{ input: glyph, gravity: 'centre' }]).png().toFile(`${OUT}/${file}`)
}
/** apple-touch: white bg (iOS shows black behind transparency), green glyph */
async function appleIcon() {
  const glyph = await sharp(tinted(BRAND_GREEN)).resize(126).png().toBuffer()
  await sharp({ create: { width: 180, height: 180, channels: 4, background: '#ffffff' } })
    .composite([{ input: glyph, gravity: 'centre' }]).png().toFile(`${OUT}/apple-touch-icon.png`)
}
await anyIcon(192, 'icon-192.png')
await anyIcon(512, 'icon-512.png')
await maskableIcon(192, 'maskable-192.png')
await maskableIcon(512, 'maskable-512.png')
await appleIcon()
console.log('icons written to', OUT)
```
- [ ] **Step 2:** Run `pnpm icons`. Verify: `ls apps/web/public/icons` shows the 5 PNGs; open `maskable-512.png` (Read tool renders images) and confirm the glyph sits fully inside the center 80% with the green bleeding to all edges.
- [ ] **Step 3:** `apps/web/index.html` `<head>` additions (keep the existing theme head script and everything else intact):
```html
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<meta name="theme-color" content="#fcfcf8" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="OpenDoist" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
```
  AS-BUILT CHECK: `grep -n "favicon\|<title>" apps/web/index.html` — keep whatever favicon link phases 1–4 installed; add `<link rel="icon" href="/icons/icon-192.png" type="image/png">` only if no favicon link exists.
- [ ] **Step 4:** Verify: `pnpm --filter @opendoist/web build` succeeds and `ls apps/web/dist/manifest.webmanifest apps/web/dist/icons` shows manifest + icons copied. `pnpm lint` clean.

---

### Task C: Service worker, offline shell, install prompts (PARALLEL)

**Files:**
- Create: `apps/web/src/sw.ts`
- Create: `apps/web/src/pwa/register.ts`, `apps/web/src/pwa/install.ts`, `apps/web/src/pwa/theme-color.ts`, `apps/web/src/pwa/pwa-provider.tsx`, `apps/web/src/pwa/offline-banner.tsx`, `apps/web/src/pwa/ios-install-dialog.tsx`, `apps/web/src/pwa/update-toast.tsx`
- Edit: `apps/web/vite.config.ts`, `apps/web/src/main.tsx`

**Interfaces:** consumes the manifest/icons contract (Task A/B) and phase 6's push-handler code. Produces `<PwaProvider>` wrapping the app root, and a single Workbox SW that also owns push.

- [ ] **Step 1:** AS-BUILT CHECK: find phase 6's service worker (`grep -rln "addEventListener('push'" apps/web` — likely `apps/web/public/sw.js` or similar) and the file that registers it (`grep -rln "serviceWorker.register" apps/web/src`). The push/notificationclick handlers MUST move verbatim into the new `src/sw.ts`; the old SW file and old registration call are deleted (same URL scope `/` means the new SW replaces it on activate). If push subscription code references the SW registration, keep using `navigator.serviceWorker.ready` — no API change.
- [ ] **Step 2:** `apps/web/vite.config.ts` — add vite-plugin-pwa in injectManifest mode (we own the static manifest; plugin only builds/injects the SW):
```ts
import { VitePWA } from 'vite-plugin-pwa'
// inside plugins array, after react() and tailwindcss():
VitePWA({
  strategies: 'injectManifest',
  srcDir: 'src',
  filename: 'sw.ts',
  registerType: 'prompt',
  injectRegister: false,
  manifest: false,
  injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'], maximumFileSizeToCacheInBytes: 3 * 1024 * 1024 },
  devOptions: { enabled: false },
})
```
- [ ] **Step 3:** `apps/web/src/sw.ts` — Workbox app shell + API runtime cache + push (merged from phase 6):
```ts
/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope
import { clientsClaim } from 'workbox-core'
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { NetworkFirst } from 'workbox-strategies'
import { createHandlerBoundToURL } from 'workbox-precaching'

self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// SPA navigations → precached index.html; never intercept API/feed/auth/doc URLs
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), {
  denylist: [/^\/api\//, /^\/ical\//],
}))

// Offline read of last-cached queries: GET /api/v1/* NetworkFirst (SSE + auth excluded)
registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    url.pathname.startsWith('/api/v1/') &&
    !url.pathname.startsWith('/api/v1/events') &&
    !url.pathname.startsWith('/api/v1/docs') &&
    !url.pathname.startsWith('/api/v1/openapi.json'),
  new NetworkFirst({
    cacheName: 'od-api',
    networkTimeoutSeconds: 4,
    plugins: [new ExpirationPlugin({ maxEntries: 128, maxAgeSeconds: 7 * 24 * 3600 })],
  }),
)

/* ---- push handlers: PASTE phase 6 handlers here verbatim (push, notificationclick focus-or-open) ---- */
```
- [ ] **Step 4:** `pwa/register.ts` — `workbox-window` registration exporting `registerSW(onNeedRefresh: () => void): { update(): void }`; call `new Workbox('/sw.js', { scope: '/' })`, listen for `waiting` → `onNeedRefresh`, `messageSkipWaiting()` + reload on accept. Skip entirely when `import.meta.env.DEV`.
- [ ] **Step 5:** `pwa/theme-color.ts` — `syncThemeColor()`: sets `<meta name="theme-color">` to `getComputedStyle(document.documentElement).getPropertyValue('--od-surface').trim()`; observe `documentElement` attribute changes (`data-theme`, `class`) with a MutationObserver + `matchMedia('(prefers-color-scheme: dark)')` change listener.
- [ ] **Step 6:** `pwa/install.ts` — capture `beforeinstallprompt` (Chromium) into module state; export `useInstallPrompt(): { canInstall: boolean; promptInstall(): Promise<void>; isIos: boolean; isStandalone: boolean }` where `isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)` and `isStandalone = matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true)`.
- [ ] **Step 7:** `pwa/ios-install-dialog.tsx` — dialog (radius 10px, uses the app's existing dialog primitive; AS-BUILT CHECK the shadcn/Base UI dialog import path) with exact copy: title "Install OpenDoist on iPhone or iPad"; body steps: "1. Tap the Share button in Safari's toolbar. 2. Scroll and tap **Add to Home Screen**. 3. Tap **Add**."; note: "Push notifications on iOS (16.4+) only work after installing to the Home Screen. If you can't install, the ntfy channel in Settings → Notifications is a reliable alternative."
- [ ] **Step 8:** `pwa/offline-banner.tsx` — `role="status"` bar pinned above the app: "You're offline — showing cached data. Changes need a connection." shown when `navigator.onLine === false` (plus `online`/`offline` listeners); `pwa/update-toast.tsx` — toast "A new version of OpenDoist is available" with Reload button (uses the app's existing toast system if present — AS-BUILT CHECK — else render a fixed-corner div with `role="status"`).
- [ ] **Step 9:** `pwa/pwa-provider.tsx` — client component that on mount runs `registerSW`, `syncThemeColor()`, renders `{children}` + `<OfflineBanner/>` + update toast + an "Install app" affordance: if `canInstall` → button calling `promptInstall()`; else if `isIos && !isStandalone` → button opening the iOS dialog. Placement: AS-BUILT CHECK for the account/help menu or sidebar footer component name — if reachable without editing files owned by Tasks D–G, mount the button there via this provider's context export `useInstallAffordance()`; otherwise render it inside the provider as a dismissible corner card (localStorage `od-install-dismissed`, re-show after 30 days per dossier §5.3) and note `DEFERRED-FIX` for menu placement.
- [ ] **Step 10:** `main.tsx`: wrap the existing root element with `<PwaProvider>` (keep all existing providers/order otherwise).
- [ ] **Step 11:** Verify: `pnpm --filter @opendoist/web build` → output lists `dist/sw.js`; `grep -c "od-api" apps/web/dist/sw.js` ≥ 1; `pnpm --filter @opendoist/web typecheck` clean; `pnpm lint` clean. Manual (if e2e server available): `pnpm --filter @opendoist/web preview`, DevTools → Application shows manifest + SW activated, toggling offline still renders the last-viewed list.

---

### Task D: A11y + polish — app chrome, Inbox, Today, Upcoming (PARALLEL)

**Files (ownership by as-built discovery, then exclusive):**
- Edit: app layout/shell, sidebar, topbar components; Inbox, Today, Upcoming view components (AS-BUILT CHECK: `ls apps/web/src/views apps/web/src/components 2>/dev/null; grep -rln "Upcoming\|Overdue" apps/web/src --include="*.tsx" | head`). Record the exact file list you claim in notes. Do NOT touch: router file (Task I), task-list virtualization target (Task I), Quick Add/task-detail/palette dialogs (Task F), settings/auth (Task G), `main.tsx` (Task C).
- Create: `apps/web/e2e/a11y-core.spec.ts`

**Steps:**
- [ ] **Step 1:** Apply the frozen A11Y ACCEPTANCE CHECKLIST (Task A Step 9) to: sidebar (nav landmark, `aria-current`, project tree disclosure buttons labeled "Expand/Collapse {project}"), topbar, skip-to-content link as first focusable (`<a href="#main" class="sr-only focus:not-sr-only">Skip to content</a>` targeting `id="main"` on the main region), Inbox, Today (Overdue section = `<section aria-labelledby>` with visible "Overdue" heading + Reschedule button labeled), Upcoming (week strip buttons labeled with full date, month picker labeled, per-day add buttons "Add task on {date}").
- [ ] **Step 2:** Wire feedback primitives (import from `../components/feedback`): empty states — Inbox: `inbox` icon, "Your Inbox is clear", "Capture anything with Q — sort it later."; Today: `sun` icon (Lucide), "No tasks today", "Enjoy the calm, or press Q to plan something."; Upcoming per-empty-day: subtle inline "Nothing scheduled" text (not the block). Loading: `TaskListSkeleton` while queries are pending (`aria-busy="true"` on the list container). Errors: wrap each view body in `<ODErrorBoundary label="Inbox">` etc.
- [ ] **Step 3:** `e2e/a11y-core.spec.ts` — Playwright spec (follow the as-built auth/login helper pattern used by existing specs — AS-BUILT CHECK `ls apps/web/e2e`): logs in, visits Inbox/Today/Upcoming with seeded-or-created data, runs `expectNoAxeViolations(page)` per view in light + `data-theme="dark"`, asserts skip-link is first Tab stop, asserts `nav[aria-label]` exists and the active item has `aria-current="page"`, asserts checkbox accessible name contains task content.
- [ ] **Step 4:** Verify: `pnpm --filter @opendoist/web exec playwright test a11y-core` green; `pnpm --filter @opendoist/web typecheck && pnpm lint` clean. Record every cross-owned finding as `DEFERRED-FIX`.

---

### Task E: A11y + polish — Project, Label, Filter, Search, Reporting views (PARALLEL)

**Files:**
- Edit: Project view (incl. sections + subtask collapse), Label view, Filter view (multi-pane), search results / ⌘K results list only if it is a separate view (the palette dialog itself is Task F's), Reporting/activity + completed + productivity views (AS-BUILT CHECK: `grep -rln "ActivityEvent\|activity\|karma\|completed" apps/web/src --include="*.tsx" | head`; claim exact list in notes; same exclusions as Task D).
- Create: `apps/web/e2e/a11y-views.spec.ts`

**Steps:**
- [ ] **Step 1:** Apply the frozen A11Y ACCEPTANCE CHECKLIST: section headers are real headings with collapse buttons labeled ("Collapse section {name}"); filter panes each get `role="region"` + `aria-label` = pane query; activity feed day groups are headings; charts (goal/karma) get text alternatives (`role="img"` + `aria-label` summarizing values).
- [ ] **Step 2:** Wire feedback primitives: Project empty → `hash` icon, "No tasks in {project}", "Add one with A, or press Q from anywhere."; Label empty → `tag` icon, "No tasks with @{label}"; Filter empty/zero-match pane → `list-filter` icon, "No tasks match this filter", description shows the query verbatim; Filter syntax error → `ODErrorBoundary` is NOT used for this — render inline `role="alert"` with the parser message and position (AS-BUILT CHECK: how phase 5 surfaces `FilterSyntaxError`); Search empty → "No results for “{q}”". Skeletons + error boundaries per view as in Task D Step 2.
- [ ] **Step 3:** `e2e/a11y-views.spec.ts`: visits a seeded project (with sections + a subtask), a label view, a two-pane filter (`#Work, @errands`), reporting/activity, completed view; `expectNoAxeViolations` each (light + dark); asserts empty state renders (`role="status"`) on an empty fresh project; asserts pane regions have labels.
- [ ] **Step 4:** Verify: `pnpm --filter @opendoist/web exec playwright test a11y-views` green; typecheck + lint clean; `DEFERRED-FIX` notes recorded.

---

### Task F: A11y — dialogs & overlays (Quick Add, task detail, palette, shortcuts, scheduler, undo) (PARALLEL)

**Files:**
- Edit: Quick Add dialog + token chips, task detail modal, ⌘K command palette, `?` shortcuts overlay, scheduler/date-picker popover, undo toast component, Ramble record/review dialog (AS-BUILT CHECK: `grep -rln "QuickAdd\|CommandPalette\|cmdk\|Scheduler\|undo" apps/web/src --include="*.tsx" | head`; claim exact list; do not touch view files (D/E), settings (G), feedback primitives (H)).
- Create: `apps/web/e2e/a11y-dialogs.spec.ts`

**Steps:**
- [ ] **Step 1:** Apply the frozen A11Y ACCEPTANCE CHECKLIST with dialog emphasis: focus trap + restore on every dialog; Quick Add live token highlighting must not break the input's accessible value (overlay is `aria-hidden="true"`; the real textarea keeps the raw text); token chips are buttons labeled "Remove {kind}: {text}" (click-to-detokenize); priority picker options read "Priority 1 (highest)" … "Priority 4 (default)"; ⌘K palette: cmdk listbox roles verified, results announce count via `aria-live="polite"` region; `?` overlay: table of shortcuts uses real `<table>` + caption, `Esc` closes; scheduler popover: natural-language input labeled "Due date", preset buttons labeled; undo toast: `role="status"`, the 10 s timer PAUSES on hover/focus, Undo reachable by keyboard (toast gets focus via F6 or is next in DOM order — document which in the spec file); Ramble hold-to-record button: `aria-pressed` + explicit label "Hold to record".
- [ ] **Step 2:** Reduced-motion: dialog enter/leave transitions and the checkbox complete animation must be disabled under `prefers-reduced-motion: reduce` — if implemented as inline styles/JS animations, gate on `matchMedia('(prefers-reduced-motion: reduce)')`; if CSS, confirm Task H's global gate covers them (coordinate via notes, do not edit tokens.css).
- [ ] **Step 3:** `e2e/a11y-dialogs.spec.ts`: opens each dialog (Q, Enter on a task, Cmd+K, ?, scheduler via T, complete→undo toast), runs `expectNoAxeViolations(page, { include: '[role="dialog"]' })` (or the overlay root), asserts focus is inside on open and returns to invoker on Esc, asserts undo toast has `role="status"` and its Undo button works by keyboard.
- [ ] **Step 4:** Verify: `pnpm --filter @opendoist/web exec playwright test a11y-dialogs` green; typecheck + lint clean.

---

### Task G: A11y — settings pages + auth screens (PARALLEL)

**Files:**
- Edit: all Settings pages (Account/General/Theme/Sidebar/Quick Add/Productivity/Reminders/Notifications/Backups/Integrations/About) and auth screens (login/register/TOTP/OIDC buttons) (AS-BUILT CHECK: `ls apps/web/src/**/settings* 2>/dev/null; grep -rln "Settings\|login\|sign" apps/web/src --include="*.tsx" | head`; claim exact list; exclusions as above).
- Create: `apps/web/e2e/a11y-settings.spec.ts`

**Steps:**
- [ ] **Step 1:** Apply the frozen A11Y ACCEPTANCE CHECKLIST: every form control labeled (theme radio group = `fieldset`+`legend` "Theme", each theme swatch labeled with theme name); toggles are real switches with `aria-checked`; danger zone buttons describe consequence ("Delete account and all data"); settings nav = `nav aria-label="Settings"`; auth forms: `autocomplete` attributes (`email`, `current-password`, `new-password`, `one-time-code`), error summaries `role="alert"`, OIDC button reads "Continue with {OPENDOIST_OIDC_NAME}".
- [ ] **Step 2:** Empty/edge states with feedback primitives: Backups page with no backups → `archive` icon EmptyState "No backups yet" + "Back up now" action; Notifications with no push devices → "No devices registered — enable notifications on a device to see it here"; Integrations token list empty → "No API tokens". Test buttons (Reminders "Send test notification") get busy state (`aria-disabled` while inflight) and result announced via `role="status"`.
- [ ] **Step 3:** `e2e/a11y-settings.spec.ts`: walks every settings page + the login screen (logged-out context), `expectNoAxeViolations` each in light + dark; asserts theme change persists and the `<html>` `data-theme` updates; asserts each page has exactly one `h1`.
- [ ] **Step 4:** Verify: `pnpm --filter @opendoist/web exec playwright test a11y-settings` green; typecheck + lint clean.

---

### Task H: Feedback primitives implementation + reduced-motion gate (PARALLEL)

**Files:**
- Replace wholesale: `apps/web/src/components/feedback/empty-state.tsx`, `skeleton.tsx`, `error-boundary.tsx` (keep `index.ts` exports and the FROZEN prop types from Task A verbatim)
- Create: `apps/web/src/components/feedback/feedback.test.tsx`
- Edit: `apps/web/src/styles/tokens.css` (reduced-motion + skeleton shimmer only — this task owns this file)

**Steps:**
- [ ] **Step 1:** `EmptyState` — vertical center block, max-width 320px: icon 48px `stroke-width: 1.5` in `var(--od-text-tertiary)`; title 16px/600 `--od-text-primary`; description 13px `--od-text-secondary`; optional action = secondary button (height 32, radius 5px); `role="status"` on the wrapper so appearance is announced.
- [ ] **Step 2:** `Skeleton` — `background: var(--od-hover)`, radius 5px, shimmer via CSS class `od-skeleton` (keyframe added to tokens.css); `TaskListSkeleton` renders `rows` rows shaped like task rows (18px circle + two text bars, row height 42px), wrapper `aria-hidden="true"`.
- [ ] **Step 3:** `ODErrorBoundary` — implements the frozen class contract: fallback card radius 10px, border `var(--od-border)`, `role="alert"`, heading "{label} couldn't load", body = `error.message` in 13px secondary, "Try again" button calling `this.reset()`. Also export unchanged.
- [ ] **Step 4:** tokens.css additions (append; do not restructure existing blocks):
```css
@keyframes od-shimmer { from { opacity: 0.6; } 50% { opacity: 1; } to { opacity: 0.6; } }
.od-skeleton { animation: od-shimmer 1.5s var(--ease-standard) infinite; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```
  AS-BUILT CHECK: `grep -n "prefers-reduced-motion" apps/web/src/styles/tokens.css` — if a gate already exists, keep the stronger of the two, never both.
- [ ] **Step 5:** `feedback.test.tsx` (Vitest; AS-BUILT CHECK: does apps/web run Vitest with jsdom? If web has no unit-test rig, write these as a Playwright component-less spec `e2e/feedback.spec.ts` instead and note it): EmptyState renders title/description/action and fires onClick; ODErrorBoundary catches a thrower, shows label + message, Retry re-renders children; TaskListSkeleton renders N rows aria-hidden.
- [ ] **Step 6:** Verify: `pnpm --filter @opendoist/web test` (or the substituted spec) green; typecheck + lint clean.

---

### Task I: Performance pass — virtualization, SSE backoff, route splitting, bundle budget (PARALLEL)

**Files:**
- Edit: the task-list rendering component (AS-BUILT CHECK: `grep -rln "TaskRow\|TaskList" apps/web/src --include="*.tsx" | head` — claim the list container file, not row internals), the SSE client module (path from Task A survey), the router/routes file (`grep -rln "createBrowserRouter\|Routes\|createRootRoute" apps/web/src`)
- Create: `scripts/check-bundle.mjs`, `apps/web/e2e/perf-virtual.spec.ts`

**Steps:**
- [ ] **Step 1: Virtualization.** In the task-list container: when `tasks.length > 500`, render through `useVirtualizer` (`@tanstack/react-virtual`): `estimateSize: () => 42`, `overscan: 12`, `getScrollElement` = the view's existing scroll container (AS-BUILT CHECK which element scrolls — likely the main content div). Below the threshold render exactly as before (drag-and-drop and keyboard focus code paths untouched for the common case; document in code why 500). Keyboard focus (J/K) must still scroll the focused row into view — call `virtualizer.scrollToIndex` when the focused index is virtualized.
- [ ] **Step 2: SSE reconnect backoff.** In the SSE client: replace any naive reconnect with exponential backoff — base 1 s, factor 2, cap 30 s, full jitter (`delay = random(0, min(cap, base * 2**attempt))`), reset attempt counter on a successful `open`; preserve existing `Last-Event-ID` replay behavior; on `document.visibilitychange` to visible, reconnect immediately. Export nothing new; keep the module's existing public API (AS-BUILT CHECK its exports first).
- [ ] **Step 3: Route-level code splitting.** Wrap Settings, Reporting/Productivity, and the Todoist-importer screens in `React.lazy` + `<Suspense fallback={<TaskListSkeleton rows={4}/>}>` at the router level (import from `components/feedback`). Only these three surfaces — views on the hot path stay eager.
- [ ] **Step 4:** `scripts/check-bundle.mjs` — walks `apps/web/dist/assets/*.js`, gzips each (`node:zlib gzipSync`), prints a table (file, raw KB, gzip KB), fails (`process.exit(1)`) if total gzip JS > 900 KB or any single chunk > 400 KB. Run after `pnpm --filter @opendoist/web build`; expected output ends `bundle OK: <total> KB gzip total`.
- [ ] **Step 5:** `e2e/perf-virtual.spec.ts`: seeds/creates a project with 1,200 tasks via the API (AS-BUILT CHECK: reuse the existing e2e API helper; batch-create), opens it, asserts `page.locator('[data-task-row], [role="listitem"]')` count is < 200 (virtualized window), scrolls to bottom, asserts the last task's content becomes visible, and J/K navigation still moves focus.
- [ ] **Step 6:** Verify: `pnpm --filter @opendoist/web build && pnpm check:bundle` → `bundle OK`; `pnpm --filter @opendoist/web exec playwright test perf-virtual` green; typecheck + lint clean.

---

### Task J: Seed script (`pnpm seed`) (PARALLEL)

**Files:**
- Create: `apps/server/src/seed.ts` (+ colocated `apps/server/src/seed.test.ts` only if it can run against a temp DB without a server — else assertions live in the script's `--verify` mode)

**Interfaces:** implements the FROZEN SEED DATASET (Task A Step 10) exactly. Runs via `pnpm seed` (script wired by Task A).

**Steps:**
- [ ] **Step 1:** AS-BUILT CHECK (mandatory before writing code): `ls apps/server/src` and `grep -rn "export const" apps/server/src/db/schema.ts | head -40` (or wherever Drizzle tables live); find how the server opens the DB (`grep -rln "better-sqlite3\|drizzle(" apps/server/src`), how migrations run, how users are created by better-auth (password hashing — `grep -rln "argon2\|signUpEmail" apps/server/src node_modules/.pnpm 2>/dev/null | head`), and whether a task-creation service function exists that the quick-add route uses (`grep -rln "parseQuickAdd" apps/server/src`). **Prefer calling the server's own service/repository functions over raw inserts** so ordering, day_order, FTS triggers, and activity events stay correct.
- [ ] **Step 2:** Script behavior: reads `OPENDOIST_DATA_DIR` (default as-built), opens the DB the same way the server does, runs migrations if the schema is empty; **idempotency**: if any non-Inbox project exists, print `seed: database already has data — pass --force to add demo data anyway` and exit 0 (exit 2 on unknown flags). Creates the demo user via better-auth's server-side API only when zero users exist (email `demo@opendoist.local`, password `opendoist-demo`, name `Demo`).
- [ ] **Step 3:** Create projects/sections/labels/filters from the frozen dataset, then create tasks by feeding each frozen Quick Add string through `parseQuickAdd` from `@opendoist/core` (ctx: now = run time, tz = `America/New_York`, defaults from `DEFAULT_PARSE_CONTEXT_SETTINGS`) and persisting via the same code path the `/tasks/quick` route uses. Subtasks: create parents first, pass `parent_id`. Completed set: create 6 tasks then mark completed with `completed_at` back-dated 1–5 days (2/1/1/1/1) so DayStats/karma rollup has history — AS-BUILT CHECK: if a completion service exists, call it, then adjust timestamps directly.
- [ ] **Step 4:** Output: one line per entity group, final line `seed: done — 4 projects, 5 labels, 2 filters, 18 open tasks, 6 completed`. `--verify` flag re-opens the DB and asserts those counts, exiting non-zero on mismatch. *(Corrected during the phase-10 review: an earlier draft said "19", an arithmetic slip — the frozen Task A Step 10 dataset enumerates exactly 18 open tasks: 15 top-level + 1 uncompletable parent + 2 subtasks.)*
- [ ] **Step 5:** Verify: `OPENDOIST_DATA_DIR=$(mktemp -d) pnpm seed && OPENDOIST_DATA_DIR=<same dir> pnpm seed` → second run prints the already-has-data line; `pnpm --filter @opendoist/server typecheck && pnpm lint` clean.

---

### Task K: README finalization + screenshot capture (PARALLEL)

**Files:**
- Edit: `README.md`
- Create: `scripts/capture-screenshots.mjs`, `docs/screenshots/.gitkeep`

**Steps:**
- [ ] **Step 1:** `scripts/capture-screenshots.mjs` — plain Node script using the web app's installed Playwright (`import { chromium } from 'playwright'` — AS-BUILT CHECK: import from `apps/web/node_modules` or add a `createRequire` resolve; do NOT add a new dependency): (1) `OPENDOIST_DATA_DIR=$(mktemp)` equivalent via `fs.mkdtemp`, (2) start the built server (`node apps/server/dist/index.js` — AS-BUILT CHECK the server start command and build output path; build first if `dist` missing) on port 7999 with the temp data dir, (3) run the seed script against the same env, (4) launch chromium 1440×900 `deviceScaleFactor: 2`, log in as the demo user, (5) capture: Today view (Kale light) → `docs/screenshots/hero.png`; same view with `data-theme="dark"` → `docs/screenshots/hero-dark.png`; Quick Add open with the text `Prepare launch notes tomorrow 9am p2 #Work @deep-work` showing live token highlights → `docs/screenshots/quick-add.png`, (6) kill server, remove temp dir. Idempotent; exits non-zero if any page errors. Expected output: `wrote docs/screenshots/hero.png (2880x1800)` ×3.
- [ ] **Step 2:** Run `pnpm screenshots` and commit the three PNGs (leave files in tree; the orchestrator commits). If the server/web build is broken for reasons outside this task, record `DEFERRED: screenshots pending gate` and continue — Task O re-runs it.
- [ ] **Step 3:** Rewrite `README.md` (keep the existing brand header + attribution; this is the 0.1.0 face of the project):
  1. Centered logo + name + one-liner (keep current).
  2. Badges row: CI (`.github/workflows/ci.yml` badge), Release (`img.shields.io/github/v/release/pranav-karra-3301/opendoist`), GHCR (`ghcr.io` pull badge or plain link), License AGPL-3.0, Node ≥ 22.
  3. Hero: `<img src="docs/screenshots/hero.png" ...>` with `<picture>` dark variant (`hero-dark.png`).
  4. Remove the pre-alpha warning block entirely.
  5. **Features table with done checkmarks** — convert the current checkbox list: every shipped capability (all of them, phases 1–9 + this phase) becomes `✅` rows in a two-column table (Feature | Notes), grouped: Capture (Quick Add grammar + Ramble) · Organize (projects/sections/labels/filters) · Plan (views, keyboard, ⌘K) · Remind (push/ntfy/gotify/webhook, iCal) · Own your data (importer, export, backups) · Platform (PWA/offline, API + CLI, OIDC/TOTP). AS-BUILT CHECK: verify each row against the repo before marking ✅ — anything not actually shipped stays out (do not ship aspirational checkmarks).
  6. Quick start: the canonical one-liner `docker run -d -p 7968:7968 -v ./data:/data ghcr.io/pranav-karra-3301/opendoist` **plus the 5-line compose**:
```yaml
services:
  opendoist:
    image: ghcr.io/pranav-karra-3301/opendoist:latest
    ports: ["7968:7968"]
    volumes: ["./data:/data"]
```
  7. CLI install: `npm install -g opendoist` then `opendoist login` (AS-BUILT CHECK: the CLI package's published name + bin from `packages/cli/package.json`; if unpublished at 0.1.0, phrase as "ships inside the container: `docker exec -it opendoist opendoist …`" + npm publish note).
  8. Screenshots section (quick-add.png), Docs links (the 9 pages from the frozen IA, incl. voice-ramble + backups), Development (keep current), Non-goals (keep, verbatim scope guard), License + attribution (keep).
- [ ] **Step 4:** Verify: `pnpm lint` clean (Biome formats md? if not, at minimum markdown renders — check with `grep -c "]("` sanity and view the file); every relative link target exists (`node -e` one-liner that regex-extracts `](...)` paths and `fs.existsSync` each, ignoring http/#; expected `all README links resolve`).

---

### Task L: Docs pages I — index, install, configuration, FAQ (PARALLEL)

**Files:**
- Create: `docs/README.md`, `docs/install.md`, `docs/configuration.md`, `docs/faq.md`

**Steps:**
- [ ] **Step 1:** `docs/README.md` — index page: one-paragraph description + linked table of the 9 pages (frozen IA, Task A Step 11) with one-line summaries — this INCLUDES phase 7's `docs/voice-ramble.md` and phase 9's `docs/backups.md` (link them; their content is owned elsewhere).
- [ ] **Step 2:** `docs/install.md`: requirements (Docker; or Node ≥22 from source), the canonical `docker run` one-liner, the compose block (identical to README's), first-run walkthrough (open `http://localhost:7968`, create the first account, **registration auto-locks after the first user** — reopen with `OPENDOIST_ALLOW_REGISTRATION=true`), volume layout (`/data`: `opendoist.db`, `attachments/`, `backups/`, `secrets.json` — auto-generated, never required as env), reverse-proxy section (set `OPENDOIST_PUBLIC_URL`; HTTPS required for Web Push and PWA install; `OPENDOIST_TRUST_PROXY` when behind one), updating (`docker compose pull && docker compose up -d`; images: `latest`, `X.Y`, `X.Y.Z`, `nightly`), Litestream S3 replication pointer as documented optional sidecar (spec §2.6), uninstall.
- [ ] **Step 3:** `docs/configuration.md` — the one page listing EVERY env var (spec §3.5). AS-BUILT CHECK (mandatory): `grep -rn "OPENDOIST_" apps/server/src` and reconcile — document what the code actually reads; if a spec var is missing from code, list it under "Planned" instead of silently documenting fiction. Baseline table to reconcile against (all optional, prefix `OPENDOIST_`):

| Var | Default | Purpose |
|---|---|---|
| `PUBLIC_URL` | — | Recommended. Absolute origin; enables correct push/iCal/OIDC URLs |
| `PORT` | `7968` | Listen port |
| `DATA_DIR` | `/data` | SQLite DB, attachments, backups, secrets |
| `ALLOW_REGISTRATION` | `false` after first user | Reopen sign-up |
| `DISABLE_UPDATE_CHECK` | `false` | Skip GitHub-release update poll |
| `LOG_LEVEL` | `info` | pino level |
| `TRUST_PROXY` | `false` | Honor X-Forwarded-* |
| `UPLOAD_MAX_MB` | `25` | Attachment/Ramble upload cap |
| `BACKUP_RETENTION` | `14` | Nightly snapshots kept |
| `BACKUP_INCLUDE_ATTACHMENTS` | `true` | Zip attachments into backups |
| `BACKUP_CRON` | nightly | Backup schedule |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_NAME` | — | Generic OIDC SSO |
| `STT_PROVIDER` / `STT_BASE_URL` / `STT_MODEL` / `STT_API_KEY` | — | Ramble transcription defaults |
| `LLM_PROVIDER` / `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` | — | Ramble extraction defaults |

  Note under the table: env = instance defaults; Settings overrides; secrets in `/data/secrets.json` are auto-generated.
- [ ] **Step 4:** `docs/faq.md` — at minimum these Q&As: Where is my data? (single `/data` volume) · How do backups/restore work? (Settings → Backups; nightly `VACUUM INTO`) · Why don't push notifications work on iPhone? (iOS 16.4+ requires Add to Home Screen — link install dialog; ntfy fallback) · Why does Google Calendar lag behind my iCal feed? (Google refreshes every 8–24 h) · Why is priority 1 "highest" here but 4 in Todoist's API? (we store 1=p1; importer maps) · How do I re-open registration? · How do I turn off the update check? · Do I need HTTPS? (yes, for push + PWA install; localhost exempt) · What's explicitly out of scope? (board/calendar layouts, CalDAV, email channel, sharing — spec §1).
- [ ] **Step 5:** Verify: all four files exist; `node` link-check one-liner (same as Task K Step 4) over `docs/*.md` passes; `pnpm lint` clean.

---

### Task M: Docs pages II — importer, STT sidecar, API, CLI (PARALLEL)

**Files:**
- Create: `docs/import-todoist.md`, `docs/api.md`, `docs/cli.md`
- Edit: `docs/voice-ramble.md` (phase 7 Task M created it — EXTEND with the sidecar recipe; do NOT create a separate `docs/stt.md`, which would duplicate this page)

**Steps:**
- [ ] **Step 1:** `docs/import-todoist.md`: two paths — (a) backup ZIP upload (Todoist Settings → Backups → download; upload in OpenDoist Settings → Integrations/Import), (b) live import via Todoist API token (where to find it; what's fetched: projects/sections/tasks/labels/comments/reminders where representable). Mapping table: priority `4↔1` inversion · collaborators/assignees dropped · board/calendar view prefs dropped · per-import skip report shown in UI. AS-BUILT CHECK: `grep -rln "importer\|todoist" apps/server/src | head` — align endpoint names, accepted file shape, and the skip-report shape with phase 9's implementation; documented importers must match `GET /api/v1/info` → `available_importers`.
- [ ] **Step 2:** `docs/voice-ramble.md` — EXTEND phase 7's existing page (keep its pipeline/config/provider-matrix content; reconcile rather than repeat the `STT_PROVIDER` table — `openai-compatible` covering OpenAI `gpt-4o-mini-transcribe`, Speaches, whisper.cpp server; `deepgram`; `elevenlabs`) by adding the self-hosted sidecar recipe (dossier §5.7):
```yaml
services:
  speaches:
    image: ghcr.io/speaches-ai/speaches:latest-cpu
    ports: ["8000:8000"]
    volumes: ["hf-cache:/home/ubuntu/.cache/huggingface"]
volumes:
  hf-cache:
```
  with `OPENDOIST_STT_PROVIDER=openai-compatible`, `OPENDOIST_STT_BASE_URL=http://speaches:8000/v1`, `OPENDOIST_STT_MODEL=Systran/faster-whisper-small`; note keys are stored encrypted at rest; optional LLM extraction section (`LLM_*` vars, `none` = whole transcript becomes one task; the LLM never invents dates — spoken phrases are parsed by the same date engine). AS-BUILT CHECK: adapter names against phase 7 code (`grep -rn "openai-compatible\|deepgram\|elevenlabs" apps/server/src | head`).
- [ ] **Step 3:** `docs/api.md` — pointer page, not a reference: interactive docs live at `/api/v1/docs` (Scalar) and the spec at `/api/v1/openapi.json`; auth = `Authorization: Bearer od_…` (create tokens in Settings → Integrations; scopes `read`/`read_write`); cursor pagination `{results, next_cursor}`; errors = RFC 9457 problem-JSON; **priority note (1=highest)**; quick-create example:
```sh
curl -X POST "$URL/api/v1/tasks/quick" -H "Authorization: Bearer od_…" \
  -H "Content-Type: application/json" -d '{"text": "Pay rent tomorrow 9am p1 #Home"}'
```
  plus SSE (`/api/v1/events`) and iCal feed (`/ical/<token>/tasks.ics`, rotate in Settings) one-paragraph sections. AS-BUILT CHECK each path via `grep -rn "tasks/quick\|/ical/\|/events" apps/server/src | head`.
- [ ] **Step 4:** `docs/cli.md` — install (`npm install -g opendoist` — AS-BUILT CHECK name per Task K; plus "bundled in the Docker image: `docker exec -it <container> opendoist …`"), `opendoist login` (or `OPENDOIST_URL`/`OPENDOIST_TOKEN` env), command table (`add`, `list`, `today`, `upcoming [filter]`, `done <id>`, `rm <id>`, `projects`, `labels`, `filters`, `search <q>`, `open`, `whoami`), `--json` on read commands with a `jq` pipe example, config file location `~/.config/opendoist/config.json` (chmod 600), alias tip `alias od=opendoist`. AS-BUILT CHECK: run `pnpm --filter <cli pkg> exec opendoist --help` (or `node packages/cli/dist/…`) and reconcile the table with real commands/flags.
- [ ] **Step 5:** Verify: link-check passes across `docs/*.md`; every documented command/endpoint was as-built-verified (list the greps you ran in notes); `pnpm lint` clean.

---

### Task N: Release engineering — CHANGELOG, prepare-release.yml, docker smoke (PARALLEL)

**Files:**
- Create: `.github/workflows/prepare-release.yml`, `scripts/smoke-docker.sh`
- Edit (regenerate via git-cliff): `CHANGELOG.md` — phase 9 Task A already created it with seeded Unreleased content; this task replaces that seed with git-cliff output, it does NOT create the file
- Create if missing / else edit: `deploy/docker-compose.yml`, `deploy/.env.example`
- Edit: `.github/workflows/docker.yml`

**Steps:**
- [ ] **Step 1:** `CHANGELOG.md` regeneration: run `pnpm dlx git-cliff@2 -o CHANGELOG.md` (uses the repo's existing `cliff.toml`). This OVERWRITES the hand-seeded file phase 9 Task A created — that seed is intentionally replaced by the git-cliff output from here on (What's-New parsing must still work: phase 9's `parseChangelog` reads the same Keep-a-Changelog headings). Expected: Keep-a-Changelog headings with an `## [Unreleased]` section grouping Features/Bug Fixes/Maintenance from the phase 1–9 conventional commits. Commit the generated file as-is (no hand edits except an intro line if git-cliff emitted none).
- [ ] **Step 2:** `deploy/docker-compose.yml` (create if phase 3/9 didn't):
```yaml
services:
  opendoist:
    image: ghcr.io/pranav-karra-3301/opendoist:${OPENDOIST_VERSION:-latest}
    restart: unless-stopped
    ports: ["7968:7968"]
    volumes: ["./data:/data"]
    env_file: [.env]
```
  `deploy/.env.example`: `OPENDOIST_VERSION=latest`, `OPENDOIST_PUBLIC_URL=`, commented `OPENDOIST_ALLOW_REGISTRATION=`, `OPENDOIST_LOG_LEVEL=info`. AS-BUILT CHECK: if a compose file already exists elsewhere (repo root?), move/align rather than duplicate — one canonical compose only, path recorded in notes (README/docs tasks reference `deploy/`; leave a `DEFERRED-FIX` if their links need updating).
- [ ] **Step 3:** `.github/workflows/prepare-release.yml` (verbatim; adjust only as-built repo owner/name):
```yaml
name: Prepare Release
on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Version to release (X.Y.Z, no v prefix)'
        required: true
permissions:
  contents: write
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: Validate version
        run: echo "${{ inputs.version }}" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - name: Bump version
        run: npm pkg set version=${{ inputs.version }}
      - name: Generate changelog
        run: pnpm dlx git-cliff@2 --tag v${{ inputs.version }} -o CHANGELOG.md
      - name: Commit + tag
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add package.json CHANGELOG.md
          git commit -m "chore(release): v${{ inputs.version }}"
          git tag "v${{ inputs.version }}"
          git push origin HEAD:main --follow-tags
      - name: Create GitHub Release
        env: { GH_TOKEN: '${{ github.token }}' }
        run: |
          gh release create "v${{ inputs.version }}" \
            --generate-notes \
            --title "v${{ inputs.version }}" \
            deploy/docker-compose.yml deploy/.env.example
```
- [ ] **Step 4:** `.github/workflows/docker.yml` — AS-BUILT CHECK first (`cat .github/workflows/docker.yml`): it must (a) trigger on `push: branches: [main]` → `nightly` tag AND `release: types: [published]` → `X.Y.Z`, `X.Y`, `latest` tags (Karakeep-pattern per-arch builds + manifest merge; version build-arg so `/api/v1/info` is truthful) — fix the trigger/tags if phase plans drifted; and (b) gain a NEW `smoke` job that runs BEFORE any push job on both triggers:
```yaml
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/build-push-action@v6
        with: { context: ., load: true, push: false, tags: 'opendoist:smoke' }
      - run: bash scripts/smoke-docker.sh opendoist:smoke
```
  Make existing build/push jobs `needs: [smoke]`.
- [ ] **Step 5:** `scripts/smoke-docker.sh` — end-to-end container smoke (also runs locally via `pnpm smoke:docker`; requires only docker + curl):
```bash
#!/usr/bin/env bash
set -euo pipefail
IMAGE="${1:-opendoist:smoke}"
NAME="opendoist-smoke-$$"
docker run -d --rm --name "$NAME" -p 17968:7968 "$IMAGE" >/dev/null
trap 'docker stop "$NAME" >/dev/null 2>&1 || true' EXIT
for i in $(seq 1 30); do
  sleep 2
  if curl -fsS http://localhost:17968/api/health | grep -q '"ok"'; then break; fi
  [ "$i" = 30 ] && { echo "health never came up"; docker logs "$NAME"; exit 1; }
done
echo "health OK"
curl -fsS http://localhost:17968/api/v1/info | grep -q '"version"' && echo "info OK"
# first-user registration (open on fresh volume) — AS-BUILT: confirm better-auth sign-up path
curl -fsS -X POST http://localhost:17968/api/auth/sign-up/email \
  -H 'Content-Type: application/json' \
  -d '{"email":"smoke@test.local","password":"smoke-test-pass-1","name":"Smoke"}' \
  -c /tmp/od-smoke-cookies.txt >/dev/null && echo "signup OK"
# create an API token with the session, then use the CLI inside the container
TOKEN=$(curl -fsS -X POST http://localhost:17968/api/auth/api-key/create \
  -b /tmp/od-smoke-cookies.txt -H 'Content-Type: application/json' \
  -d '{"name":"smoke","permissions":{"opendoist":["read","read_write"]}}' | grep -o '"key":"od_[^"]*"' | cut -d'"' -f4)
[ -n "$TOKEN" ] && echo "token OK"
docker exec -e OPENDOIST_URL=http://localhost:7968 -e OPENDOIST_TOKEN="$TOKEN" "$NAME" \
  opendoist add "Smoke test task tomorrow p1"
docker exec -e OPENDOIST_URL=http://localhost:7968 -e OPENDOIST_TOKEN="$TOKEN" "$NAME" \
  opendoist list --json | grep -q "Smoke test task" && echo "cli OK"
echo "smoke PASSED"
```
  AS-BUILT CHECKS (fix the script to reality, keep the five `… OK` checkpoints): exact better-auth sign-up + api-key routes (`grep -rn "api-key\|sign-up" apps/server/src`, or better-auth docs for the mounted version); the API-key create response field name; the permissions namespace — phase 3 Task A Step 11 freezes `permissions: { opendoist: ['read'] }` / `{ opendoist: ['read', 'read_write'] }` as the ONLY two shapes and the auth guard computes scope from `permissions.opendoist`, so a `tasks` (or any other) namespace resolves to read-only and 403s `opendoist add`; the CLI binary name inside the image (`docker run --rm <image> which opendoist` — if the CLI is not baked in, that is a phase-8/Dockerfile drift: add `DEFERRED-FIX` for Task O to bake it, and meanwhile run the add/list steps via curl `/api/v1/tasks/quick` + `/api/v1/tasks` so the smoke still exercises auth+create).
- [ ] **Step 6:** Verify: `bash scripts/smoke-docker.sh` after a local `docker build -t opendoist:smoke .` prints all checkpoints + `smoke PASSED`; workflows lint clean via `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color`; `pnpm lint` clean.

---

### Task O: Integration gate (SEQUENTIAL — after B–N)

**Files:** may touch anything needed to make the gate pass (smallest possible diffs); applies all `DEFERRED-FIX` notes from B–N.

- [ ] **Step 1:** Apply every `DEFERRED-FIX` from parallel-task notes (these are the cross-ownership edits builders were forbidden to make). Re-run `pnpm install` only if any manifest changed.
- [ ] **Step 2:** `pnpm verify` (lint + typecheck + test + build across the workspace) → green.
- [ ] **Step 3:** Full Playwright suite: `pnpm --filter @opendoist/web exec playwright test` → green, including the four new a11y specs + perf-virtual + all pre-existing phase 4–9 specs (regressions from polish edits are this gate's to fix).
- [ ] **Step 4:** PWA end-to-end: `pnpm --filter @opendoist/web build && pnpm check:bundle` → `bundle OK`; `ls apps/web/dist/sw.js apps/web/dist/manifest.webmanifest apps/web/dist/icons/icon-512.png` all exist; serve the built app (`pnpm --filter @opendoist/web preview` or via server), assert with a quick Playwright/curl pass: `manifest.webmanifest` served with 200 + correct MIME, `GET /sw.js` 200, page has `<link rel="manifest">` and `theme-color` meta.
- [ ] **Step 5:** Seed + screenshots end-to-end: fresh temp `OPENDOIST_DATA_DIR` → `pnpm seed` prints the frozen final line; `pnpm screenshots` writes the 3 PNGs; visually confirm `docs/screenshots/hero.png` (Read the image) shows the seeded Today view in Kale with priority colors + overdue block.
- [ ] **Step 6:** Docker end-to-end: `docker build -t opendoist:smoke .` then `pnpm smoke:docker` → `smoke PASSED`.
- [ ] **Step 7:** Docs link integrity: run the link-check one-liner across `README.md docs/*.md`; `GET /api/v1/docs` renders Scalar on the running container (curl 200, body contains "OpenDoist").
- [ ] **Step 8:** A11y whole-app sanity: run the four a11y specs once more against the PRODUCTION build (not dev server) — `pnpm --filter @opendoist/web exec playwright test a11y- --project=<as-built chromium project>`.
- [ ] **Step 9:** Do not commit — report ready-for-checkpoint with: list of applied DEFERRED-FIXes, any budget numbers (bundle KB), and remaining known issues.

---

### Task P: 0.1.0 release checklist + dry run (SEQUENTIAL — after O; produces the release-ready tree, does NOT publish)

**Files:**
- Edit: root `package.json` (version), `CHANGELOG.md` (regenerate), `README.md` (only if a badge/link is broken)

- [ ] **Step 1: Phase gates.** Confirm every phase's integration checkpoint is in history: `git log --oneline | head -50` shows phase 1–10 checkpoint commits; `pnpm verify` green; working tree contains all Task B–N outputs.
- [ ] **Step 2: Version.** `npm pkg set version=0.1.0` at root. AS-BUILT CHECK: `grep -rn "version" apps/server/src --include="*.ts" | grep -i "info\|VERSION" | head` — the server's `/api/v1/info` version must come from the build-arg/package.json (not a hardcoded string); fix if drifted, and confirm the Dockerfile passes it (`grep -n "ARG.*VERSION" Dockerfile`).
- [ ] **Step 3: Changelog dry run.** `pnpm dlx git-cliff@2 --tag v0.1.0 -o CHANGELOG.md` → file starts with `## [0.1.0] - <today>`; skim: no leaked WIP noise; the Unreleased section is empty.
- [ ] **Step 4: Tag dry run (local only, never pushed):** `git tag v0.1.0-dryrun && git tag -d v0.1.0-dryrun` succeeds; `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest` clean on all three workflows; read `prepare-release.yml` once more and confirm the release attaches `deploy/docker-compose.yml` + `deploy/.env.example` and that `docker.yml` fires on `release: [published]`.
- [ ] **Step 5: Final smoke.** `docker build -t opendoist:0.1.0-rc .` (with the version build-arg) → `pnpm smoke:docker opendoist:0.1.0-rc` → `smoke PASSED`; `curl -s http://localhost:17968/api/v1/info` during the run reports `"version":"0.1.0"` (temporarily keep the container up or add the assertion into the smoke run).
- [ ] **Step 6: Release-readiness report** (final output, no commit/tag/push — the human presses the button): checklist table of Steps 1–5 with evidence lines, then the exact human instructions: "Actions → Prepare Release → Run workflow → version `0.1.0`". List post-release verifications for the human: GHCR shows `0.1.0`/`0.1`/`latest`, GitHub Release has notes + 2 assets, `docker run …opendoist:0.1.0` boots, What's-New dialog shows 0.1.0 notes on next login (phase 9 feature — AS-BUILT CHECK it reads the bundled CHANGELOG).

---

## Self-Review (done)

- **Spec §6 phase 10 coverage:** PWA install (Tasks A/B/C) · a11y pass (D/E/F/G + H's primitives/motion) · docs/README/screenshots (K/L/M + J's seed powering screenshots) · release flow dry run (N/P) · performance + empty/error/skeleton polish (H/I, spec §5 quality bar). Section-5 items: git-cliff CHANGELOG (N), workflow_dispatch release with generated notes + compose/.env assets triggering docker publish (N/P), docker smoke in CI (N), in-app version/What's-New verified not rebuilt (P Step 6 — phase 9 owns it).
- **Non-goals guard:** no board/calendar, no CalDAV, no email channel, no sharing anywhere; docs tasks explicitly document them as out of scope (L Step 4).
- **Disjointness:** file ownership is exclusive by construction: B (index.html/manifest/icons/scripts-icons) · C (vite.config, main.tsx, sw.ts, pwa/) · D/E/F/G (surface-partitioned component dirs + one spec each, with the claim-and-record rule + DEFERRED-FIX escalation for collisions) · H (feedback/ + tokens.css) · I (task-list, SSE client, router, check-bundle) · J (server seed) · K (README, screenshots script) · L/M (docs pages, disjoint filenames) · N (workflows, CHANGELOG, deploy/, smoke script). All package.json/catalog edits happen once, in Task A.
- **Drift protection:** every dependency on phases 3–9 output is behind an AS-BUILT CHECK with a concrete discovery command (Playwright dir, SSE client, push SW, better-auth routes, importer/STT adapter names, CLI bin, Dockerfile/docker.yml, env vars actually read).
- **No placeholders:** stubs in Task A are explicitly replaced wholesale by Task H; every verify step names its command and expected output; the only intentionally deferred artifacts (screenshots when the tree is temporarily broken) have a named owner (Task O Step 5).
- **Release safety:** nothing in this plan pushes a tag, creates a GitHub release, or publishes an image; Task P ends at a human-actionable report, matching "each phase ends working + committed" with the actual 0.1.0 button press left to the maintainer.
