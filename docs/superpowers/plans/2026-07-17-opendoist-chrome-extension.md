# OpenDoist Browser Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Implementation agents run as Opus; integration/review agents as Fable. Task A is SEQUENTIAL and freezes the contracts; Tasks B–E are parallel with disjoint file sets; Task F is the integration gate.

**Goal:** A clean, cross-browser (Chrome/Edge/Brave/Arc + Firefox) MV3 extension that is a Quick Add client for a user's self-hosted OpenDoist instance — toolbar popup with live `@opendoist/core` token highlighting, "save current page as task", a keyboard command, and an options page to pair an instance URL + `od_` token.

**Architecture:** A new workspace package `apps/extension` built with **WXT** (file-based MV3 entrypoints, cross-browser manifest generation, HMR) + React 19. Three surfaces only — **popup + background service worker + options** (no content script). It talks to the instance's existing REST API (`POST /api/v1/tasks/quick`, `GET /api/v1/info`) with an `Authorization: Bearer od_…` header; MV3 host permissions make those cross-origin calls CORS-free. It reuses `@opendoist/core` (the pure NL Quick Add parser) for token highlighting. No server changes — the extension is a pure client.

**Tech stack:** WXT `~0.20.x` + `@wxt-dev/module-react`, React 19.2, TypeScript, Vite 7 (via WXT), `@opendoist/core` (`workspace:*`), Biome (repo config), Vitest.

## Global Constraints

- The extension talks ONLY to the user's configured instance over **HTTPS** (reject `http://` URLs). Token is an `od_`-prefixed personal API token minted in the instance's Settings → Integrations.
- Auth header only: `Authorization: Bearer <token>` — never put the token in a URL, query string, or log line.
- Token + instance URL live in `chrome.storage.local` (never `sync`).
- Host permission for the instance origin is requested at RUNTIME from a user gesture (`optional_host_permissions: ["https://*/*"]` in the manifest, `browser.permissions.request({origins})` on the options page) — request the exact origin, not the wildcard.
- All network calls happen in the popup or the background service worker, never a content script (MV3 content scripts no longer bypass CORS).
- `@opendoist/core` is consumed as an ESM, DOM/Node-free workspace source dep so Vite/WXT inlines it into both the popup and the SW bundle.
- Use WXT's auto-imported `browser` global (not `chrome.*`) everywhere for cross-browser parity.
- TypeScript strict, no `any` (Biome `noExplicitAny: error`); Biome formatting (2-space, single quotes, semicolons as-needed); tests colocated `*.test.ts`.
- Parallel-execution rules: builders touch ONLY their listed files; never run `pnpm install` (Task A installs once); never `git commit`.
- Server API facts (as-built, verify at Task A): `POST /api/v1/tasks/quick` accepts `{ "text": "<quick add string>" }` and returns the created task DTO (snake_case); `GET /api/v1/info` is unauthenticated-readable and returns `{ version, … }`; `GET /api/v1/user` (or `/api/v1/user/settings`) returns 200 with a valid token, 401 without. Bearer `od_` tokens are accepted on all `/api/v1/*` routes.

---

### Task A: Scaffold + frozen contracts (SEQUENTIAL — everything depends on this)

**Files:**
- Create: `apps/extension/package.json`, `apps/extension/wxt.config.ts`, `apps/extension/tsconfig.json`, `apps/extension/.gitignore`
- Create: `apps/extension/lib/config.ts`, `apps/extension/lib/api.ts`, `apps/extension/lib/permissions.ts`, `apps/extension/lib/types.ts`
- Create: `apps/extension/public/icon/` (16/32/48/128 PNGs generated from `assets/brand/icon-green.svg`)
- Create: `apps/extension/entrypoints/` stubs: `background.ts`, `popup/index.html`, `popup/main.tsx`, `popup/App.tsx` (stub), `options/index.html`, `options/main.tsx`, `options/App.tsx` (stub)
- Modify: `pnpm-workspace.yaml` (already globs `apps/*` — verify), root catalog (add `wxt`, `@wxt-dev/module-react`)
- Test: `apps/extension/lib/api.test.ts`

**Interfaces (produces — FROZEN for Tasks B–E):**

- [ ] **Step 1: AS-BUILT CHECK.** Boot the committed server on a temp data dir + random port, register a user, mint an `od_` token in Settings → Integrations (or via the API), and confirm with curl: `POST /api/v1/tasks/quick` with `{"text":"buy milk tom p1"}` + bearer token returns 201 and a task with `due` set and `priority: 1`; `GET /api/v1/info` returns a `version`; a bad token returns 401. Record the exact request/response shapes; if `tasks/quick` uses a different body key than `text`, update `lib/api.ts` accordingly and note it.

- [ ] **Step 2: Scaffold WXT.** In `apps/extension`, create `package.json`:
```json
{
  "name": "@opendoist/extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wxt",
    "dev:firefox": "wxt -b firefox",
    "build": "wxt build",
    "build:firefox": "wxt build -b firefox",
    "zip": "wxt zip",
    "zip:firefox": "wxt zip -b firefox",
    "typecheck": "wxt prepare && tsc --noEmit",
    "test": "vitest run",
    "postinstall": "wxt prepare"
  },
  "dependencies": { "@opendoist/core": "workspace:*", "react": "catalog:", "react-dom": "catalog:" },
  "devDependencies": {
    "wxt": "catalog:", "@wxt-dev/module-react": "catalog:",
    "@types/react": "catalog:", "@types/react-dom": "catalog:",
    "typescript": "catalog:", "vitest": "catalog:"
  }
}
```
`wxt.config.ts` (the manifest — this is frozen):
```ts
import { defineConfig } from 'wxt'

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'OpenDoist Quick Add',
    description: 'Add tasks to your self-hosted OpenDoist instance from anywhere.',
    permissions: ['storage', 'contextMenus', 'notifications', 'activeTab'],
    optional_host_permissions: ['https://*/*'],
    commands: {
      _execute_action: {
        suggested_key: { default: 'Ctrl+Shift+A', mac: 'Command+Shift+A' },
        description: 'Open OpenDoist Quick Add',
      },
    },
    icons: { 16: '/icon/16.png', 32: '/icon/32.png', 48: '/icon/48.png', 128: '/icon/128.png' },
    browser_specific_settings: { gecko: { id: 'opendoist@opendoist.app', strict_min_version: '121.0' } },
  },
})
```
`tsconfig.json`: `{ "extends": "./.wxt/tsconfig.json" }` (WXT generates the base on `wxt prepare`).

- [ ] **Step 3: `lib/types.ts` — shared DTOs (frozen).**
```ts
export interface TaskDto {
  id: string
  content: string
  priority: 1 | 2 | 3 | 4
  due: { date: string; time: string | null; string: string } | null
  project_id: string
  // (partial — only fields the extension renders on success)
}
export interface InfoDto { version: string }
export interface Config { instanceUrl: string; token: string }
```

- [ ] **Step 4: `lib/config.ts` — typed storage (frozen).**
```ts
import { storage } from '#imports'

export const instanceUrl = storage.defineItem<string>('local:instanceUrl', { fallback: '' })
export const apiToken = storage.defineItem<string>('local:apiToken', { fallback: '' })

export async function getConfig(): Promise<{ instanceUrl: string; token: string } | null> {
  const [url, token] = await Promise.all([instanceUrl.getValue(), apiToken.getValue()])
  return url && token ? { instanceUrl: url.replace(/\/+$/, ''), token } : null
}
```

- [ ] **Step 5: `lib/api.ts` — the API client (frozen).**
```ts
import type { InfoDto, TaskDto } from './types'

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = 'ApiError' }
}

async function req<T>(base: string, path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...rest } = init
  const res = await fetch(`${base}${path}`, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  })
  if (!res.ok) throw new ApiError(`${init.method ?? 'GET'} ${path} → ${res.status}`, res.status)
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

/** Validate a base URL + token by hitting /info then /user. Returns the server version. */
export async function testConnection(base: string, token: string): Promise<string> {
  const info = await req<InfoDto>(base, '/api/v1/info')
  await req<unknown>(base, '/api/v1/user', { token }) // 401s on a bad token
  return info.version
}

export async function quickAdd(base: string, token: string, text: string): Promise<TaskDto> {
  return req<TaskDto>(base, '/api/v1/tasks/quick', { method: 'POST', token, body: JSON.stringify({ text }) })
}
```

- [ ] **Step 6: `lib/permissions.ts` — runtime host grant (frozen).**
```ts
import { browser } from '#imports'

export function originPattern(instanceUrl: string): string {
  return `${new URL(instanceUrl).origin}/*`
}
/** MUST be called from a user gesture. */
export async function grantOrigin(instanceUrl: string): Promise<boolean> {
  return browser.permissions.request({ origins: [originPattern(instanceUrl)] })
}
export async function hasOrigin(instanceUrl: string): Promise<boolean> {
  return browser.permissions.contains({ origins: [originPattern(instanceUrl)] })
}
export async function revokeOrigin(instanceUrl: string): Promise<boolean> {
  return browser.permissions.remove({ origins: [originPattern(instanceUrl)] })
}
```

- [ ] **Step 7: Icons.** Generate `public/icon/{16,32,48,128}.png` from `assets/brand/icon-green.svg` (reuse the phase-10 `scripts/generate-icons.mjs` sharp pattern, or a local one-off). Add stub `background.ts` (`export default defineBackground(() => {})`) and stub popup/options React entries that render a placeholder, so `wxt build` succeeds.

- [ ] **Step 8: Install & gate.** Add catalog entries, `pnpm install` (serialize if another workflow is installing). Run: `pnpm --filter @opendoist/extension typecheck` (clean), `pnpm --filter @opendoist/extension build` (emits `.output/chrome-mv3/`), `pnpm --filter @opendoist/extension test` (api.test.ts: mocked-fetch `quickAdd` sends the right body + bearer header; `testConnection` throws `ApiError(401)` on a bad token). Do NOT commit.

---

### Task B: Options page — pairing, test connection, disconnect

**Files:**
- Create/replace: `apps/extension/entrypoints/options/App.tsx`
- Create: `apps/extension/entrypoints/options/options.css`, `apps/extension/components/Field.tsx`
- Test: `apps/extension/entrypoints/options/options.test.tsx` (optional — logic extracted to a testable pure fn)

**Interfaces:** Consumes `lib/config`, `lib/api.testConnection`, `lib/permissions`. Produces the onboarding surface.

- [ ] **Step 1:** Build the options form: instance URL input (validate `https://`), `od_` token input (password field), and a single **"Grant access & test"** button whose click handler (a user gesture) runs `grantOrigin(url)` then `testConnection(url, token)`; on success, persist via `instanceUrl.setValue`/`apiToken.setValue` and show the server version; on failure show a scoped error (bad URL / permission denied / 401 / network). Add a **"Disconnect"** button that clears both storage items and calls `revokeOrigin`.
- [ ] **Step 2:** A short "How to get a token" note linking to `${instanceUrl}/settings/integrations`. Match the design tokens (reuse the repo's radii/color language loosely; the extension has its own minimal CSS, not the full token system).
- [ ] **Step 3:** Verify: `pnpm --filter @opendoist/extension typecheck` + build clean; manual `wxt dev` load, open options, pair against a live temp instance, confirm the version prints and the popup unlocks.

---

### Task C: Popup — Quick Add with live token highlighting

**Files:**
- Create/replace: `apps/extension/entrypoints/popup/App.tsx`
- Create: `apps/extension/components/QuickAddBox.tsx`, `apps/extension/components/TokenHighlighter.tsx`, `apps/extension/entrypoints/popup/popup.css`
- Test: `apps/extension/components/highlight.test.ts`

**Interfaces:** Consumes `@opendoist/core` (`parseQuickAdd`, token spans), `lib/config`, `lib/api.quickAdd`, `activeTab`.

- [ ] **Step 1:** On mount, `getConfig()`; if null, render a "Connect your instance" prompt with a button calling `browser.runtime.openOptionsPage()`. Otherwise render `QuickAddBox`.
- [ ] **Step 2:** `QuickAddBox` = a text input with an overlay that highlights parsed tokens (dates, `p1–p4`, `@label`, `#project`, `{deadline}`, `!reminder`) using `@opendoist/core`'s parser match offsets — the same overlay approach as the web app's Quick Add (reuse the rich-textarea pattern or a lightweight input+overlay). Build a `ParseContext` from the browser's timezone + `Intl` locale; default `smartDate: true`.
- [ ] **Step 3:** A "prefill from page" affordance: a small "＋ page" button that, via `activeTab`, appends the current tab's title and URL to the text (so the popup doubles as save-page). Submit on Enter → `quickAdd(instanceUrl, token, text)`; on success show a brief confirmation and clear (keep popup open for rapid entry); on `ApiError(401)` prompt to re-pair; on network error show a retry.
- [ ] **Step 4:** Do the fetch in the popup but guard the closing-popup abort: if the request is in flight when the popup would close, it's a single fast POST so acceptable, but surface failures rather than silently dropping. Verify: `highlight.test.ts` asserts the token spans for a representative string match `@opendoist/core` output; build + `wxt dev` manual submit creates a task on a live instance.

---

### Task D: Background service worker — context menus + notifications

**Files:**
- Create/replace: `apps/extension/entrypoints/background.ts`
- Create: `apps/extension/lib/save-page.ts`
- Test: `apps/extension/lib/save-page.test.ts`

**Interfaces:** Consumes `lib/config`, `lib/api.quickAdd`. Registers context menus + notifications.

- [ ] **Step 1:** In `defineBackground`, on `browser.runtime.onInstalled` register context menus with `contexts: ['page', 'link', 'selection']` (e.g. "Add page to OpenDoist", "Add link to OpenDoist", "Add selection to OpenDoist").
- [ ] **Step 2:** `save-page.ts` exports a pure `buildTaskText(info, tab): string` that composes the quick-add text from `tab.title`/`tab.url`, `info.linkUrl`, `info.selectionText` (e.g. `"<title> <url>"`, selection → `"<selection>"`). Unit-test it.
- [ ] **Step 3:** `contextMenus.onClicked` handler: `getConfig()` → if unpaired, `notifications.create` telling the user to connect + `openOptionsPage()`; else `quickAdd(...)` (fetch **in the SW**, not a popup) → success/failure `notifications.create`. Use `browser.alarms` for anything periodic (none needed here). Verify: `save-page.test.ts` green; `wxt dev`, right-click a page → task created + a success notification fires.

---

### Task E: Cross-browser build, packaging, README, keyboard command

**Files:**
- Create: `apps/extension/README.md`
- Modify: `apps/extension/wxt.config.ts` (only if Firefox build surfaces a manifest gap)
- Create: `apps/extension/entrypoints/popup/index.html` title + meta polish (if needed)

- [ ] **Step 1:** Verify the keyboard command: `_execute_action` opens the popup on `Cmd/Ctrl+Shift+A` in a `wxt dev` session (no JS needed). Document that users can rebind it at `chrome://extensions/shortcuts`.
- [ ] **Step 2:** `wxt build` + `wxt zip` (Chrome) and `wxt build -b firefox` + `wxt zip -b firefox` both succeed. Confirm the Firefox build emits a non-persistent event-page background and includes `gecko.id`.
- [ ] **Step 3:** `README.md`: what it is, how to load unpacked (`chrome://extensions` → Developer mode → Load unpacked → `.output/chrome-mv3/`), how to pair (options → URL + `od_` token → Grant access & test), the features (popup quick add, right-click save page, `Cmd+Shift+A`), the cross-browser note (Chrome/Edge/Brave/Arc load the Chrome zip; Firefox needs the signed unlisted XPI via `wxt zip -b firefox` + AMO signing), and the honest caveat that off-store installs don't auto-update (re-load a new zip to upgrade).

---

### Task F: Integration gate (SEQUENTIAL — after B–E)

- [ ] **Step 1:** `pnpm --filter @opendoist/extension typecheck` + `pnpm --filter @opendoist/extension test` + `pnpm --filter @opendoist/extension build` + `pnpm --filter @opendoist/extension build -b firefox` all exit 0; `pnpm lint` clean on `apps/extension`.
- [ ] **Step 2:** End-to-end on a live temp instance: load `.output/chrome-mv3/` unpacked, pair, add a task via popup (verify via API), right-click a page → task created, `Cmd+Shift+A` opens the popup. Record results.
- [ ] **Step 3:** Confirm no content script exists, the token is only in `storage.local`, and no token appears in any built artifact or log. Do not commit — report ready-for-checkpoint.

## Self-Review (done)

- Coverage: popup quick-add (C), save-page (C+D), keyboard command (E), options pairing (B), cross-browser + packaging (E), token/host-permission security (A/B), core reuse (A/C). No server changes needed.
- Risks: WXT is 0.x (pin the version); `@opendoist/core` must stay ESM + DOM/Node-free to bundle into the SW (Task A verifies); Chrome desktop off-store extensions don't auto-update (documented in README); Firefox self-distribution needs Mozilla signing (documented).
