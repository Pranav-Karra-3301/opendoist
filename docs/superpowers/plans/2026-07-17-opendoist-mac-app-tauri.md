# OpenDoist macOS App (Tauri 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Implementation agents run as Opus; integration/review agents as Fable. Task A is SEQUENTIAL and freezes the contracts (including the apps/web adaptation every other task depends on); Tasks B–E are parallel with disjoint file sets; Task F is the integration gate.

**Goal:** A fast, light native macOS app that reuses the existing React SPA as its main window **and** ships a menu-bar (tray) Quick Add popover summoned from anywhere by a global hotkey, with native reminder notifications and launch-at-login — distributed self-hosted with no Apple Developer account.

**Architecture:** A new workspace package `apps/desktop` with a Tauri 2 Rust shell (`src-tauri/`). The **main window** loads `apps/web` (bundled in prod, dev-served in dev). A second lean **`quickadd` window** (frameless, transparent, always-on-top) hosts a Quick-Add-only React entry. The Rust core owns the tray icon, a global shortcut (`Cmd+Shift+Space`), a background reminders watcher that polls the instance and fires native notifications, autostart, single-instance, and the minisign updater. Crucially, **the SPA's API client gains a pluggable transport + auth + base-URL layer** so the same code runs as web (same-origin, cookie auth, browser `fetch`) or desktop (configured instance URL, `od_` bearer token, `tauri-plugin-http` `fetch` which bypasses CORS). No server changes.

**Tech stack (versions verified July 2026 — pin, keep Rust crate ⇄ JS binding minors in sync):** `tauri` 2.11.x core (feature `tray-icon`) · `@tauri-apps/cli` 2.11.4 · `@tauri-apps/api` 2.11.1 · plugins: `http` 2.5.9, `global-shortcut` 2.3.2, `positioner` 2.3.3, `notification` 2.3.3, `store` 2.4.3, `autostart` 2.5.1, `single-instance` 2.4.3, `updater` 2.10.1, `process`. Reuses `apps/web` (React 19 SPA) + `@opendoist/core`.

## Global Constraints

- Identifier `com.opendoist.desktop`; productName `OpenDoist`. Bundle targets `app` + `dmg`.
- **Transport:** the desktop build makes ALL API calls through `@tauri-apps/plugin-http`'s `fetch` (Rust `reqwest`, no browser CORS), NOT `window.fetch`. The web build keeps `window.fetch`. One adapter, selected by `isTauri()` at runtime.
- **Auth:** desktop authenticates with an `od_` bearer token (minted in the instance's Settings → Integrations), stored via `tauri-plugin-store`. Never log the token; never put it in a URL. Web keeps cookie auth. Reject non-`https://` instance URLs.
- **CORS/capabilities:** the http scope is static but the instance URL is user-supplied, so `capabilities/default.json` allows `http://**` + `https://**`. `Authorization` does NOT require the `unsafe-headers` feature.
- **Distribution (no Apple account):** ad-hoc sign (`bundle.macOS.signingIdentity: "-"`) so Apple Silicon runs it; NOT notarized. Document the macOS Sequoia "Open Anyway" flow (Settings → Privacy & Security) and the `xattr -dr com.apple.quarantine` fallback. Updater uses Tauri minisign (separate from Apple signing).
- **Activation policy:** keep the default `Regular` (Dock app) in v1 — the popover feels native via `decorations:false` + `alwaysOnTop` + tray anchoring + hide-on-blur. `LSUIElement`/`Accessory` is app-wide and would strip the main window's Dock icon; a runtime toggle is an optional later enhancement, noted, not built.
- The apps/web adaptation MUST be additive — the standalone web build and its Playwright suite keep passing unchanged.
- TypeScript strict/no-`any`; Biome formatting; Rust `cargo fmt` + `cargo clippy` clean. Tests colocated.
- Parallel-execution rules: builders touch ONLY their listed files; never `pnpm install`/`cargo add` outside Task A; never `git commit`.
- Server API facts (as-built, verify at Task A): `POST /api/v1/tasks/quick` `{ "text": … }` → task DTO; `GET /api/v1/info` → `{ version, … }`; `GET /api/v1/user` 401s without a valid token; `GET /api/v1/reminders?...`/upcoming feed for the watcher (confirm the exact route for "reminders due soon" — else poll `/api/v1/tasks` filtered by due + read the reminder rows). Bearer `od_` tokens accepted on `/api/v1/*`.

---

### Task A: Scaffold + frozen contracts (SEQUENTIAL — everything depends on this)

**Files:**
- Create: `apps/desktop/package.json`, `apps/desktop/src-tauri/{Cargo.toml,tauri.conf.json,build.rs,src/main.rs,src/lib.rs}`, `apps/desktop/src-tauri/capabilities/default.json`, `apps/desktop/src-tauri/icons/` (from `assets/brand/icon-green.svg`)
- Create (apps/web adaptation — the foundation): `apps/web/src/api/transport.ts`, `apps/web/src/api/desktop-session.ts` (contract only)
- Modify: `apps/web/src/api/client.ts` (inject transport + base URL + auth — additive), `apps/web/vite.config.ts` (second rollup input), `apps/web/quickadd.html` (new), `apps/web/src/quickadd.tsx` (new lean entry, stub)
- Modify: `pnpm-workspace.yaml` (globs `apps/*` — verify), root catalog (add `@tauri-apps/*` JS bindings)
- Test: `apps/web/src/api/transport.test.ts`

**Interfaces (produces — FROZEN for Tasks B–E):**

- [ ] **Step 1: AS-BUILT CHECK.** Read `apps/web/src/api/client.ts` as committed: how does it build request URLs (same-origin `/api/...`?), how does it attach auth (cookies via `credentials`?), and what's the single choke point where a transport/baseURL/auth adapter can be injected without touching every call site? Boot the server + mint an `od_` token and confirm `POST /api/v1/tasks/quick` + bearer works cross-origin. Record findings; they shape Steps 4–5.

- [ ] **Step 2: Tauri scaffold.** `apps/desktop/package.json`:
```json
{
  "name": "@opendoist/desktop",
  "version": "0.1.0",
  "private": true,
  "scripts": { "tauri": "tauri", "dev": "tauri dev", "build": "tauri build" },
  "devDependencies": { "@tauri-apps/cli": "catalog:" },
  "dependencies": {
    "@tauri-apps/api": "catalog:",
    "@tauri-apps/plugin-http": "catalog:",
    "@tauri-apps/plugin-global-shortcut": "catalog:",
    "@tauri-apps/plugin-positioner": "catalog:",
    "@tauri-apps/plugin-notification": "catalog:",
    "@tauri-apps/plugin-store": "catalog:",
    "@tauri-apps/plugin-autostart": "catalog:",
    "@tauri-apps/plugin-updater": "catalog:",
    "@tauri-apps/plugin-process": "catalog:"
  }
}
```
`pnpm --filter @opendoist/desktop exec tauri init` (answers: frontend dist `../../web/dist`, dev url `http://localhost:5173`, before-dev `pnpm --filter @opendoist/web dev`, before-build `pnpm --filter @opendoist/web build`). Then edit `tauri.conf.json`:
```jsonc
{
  "productName": "OpenDoist",
  "identifier": "com.opendoist.desktop",
  "build": {
    "beforeDevCommand": "pnpm --filter @opendoist/web dev",
    "devUrl": "http://localhost:5173",
    "beforeBuildCommand": "pnpm --filter @opendoist/web build",
    "frontendDist": "../../web/dist"
  },
  "app": {
    "macOSPrivateApi": true,
    "windows": [
      { "label": "main", "title": "OpenDoist", "width": 1040, "height": 720, "minWidth": 720, "minHeight": 480, "visible": true },
      { "label": "quickadd", "url": "quickadd.html", "width": 400, "height": 460, "resizable": false,
        "decorations": false, "transparent": true, "alwaysOnTop": true, "visible": false, "skipTaskbar": true }
    ]
  },
  "bundle": {
    "active": true, "targets": ["app", "dmg"], "icon": ["icons/128x128.png", "icons/icon.icns"],
    "macOS": { "signingIdentity": "-" },
    "createUpdaterArtifacts": true
  },
  "plugins": {}
}
```

- [ ] **Step 3: Rust shell (`src-tauri/`).** `Cargo.toml` deps: `tauri = { version = "2", features = ["tray-icon", "macos-private-api", "image-png"] }` + the plugin crates at the pinned versions. `src/lib.rs` builder (registration order matters — single-instance FIRST):
```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); }
        }))
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![toggle_quickadd])
        .setup(|app| {
            build_tray(app.handle())?;                 // Task A: working toggle
            register_summon_shortcut(app.handle())?;   // Task A: Cmd+Shift+Space → toggle_quickadd
            reminders::spawn(app.handle().clone());    // Task D implements; A declares the module + stub
            Ok(())
        })
        .on_window_event(|w, e| {
            if let tauri::WindowEvent::Focused(false) = e {
                if w.label() == "quickadd" { let _ = w.hide(); }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```
Implement `build_tray` (TrayIconBuilder: `icon_as_template(true)`, `show_menu_on_left_click(false)`, `on_tray_icon_event` → `tauri_plugin_positioner::on_tray_event(...)` then on left-click-up `toggle_quickadd`), the `#[tauri::command] toggle_quickadd` (positioner `Position::TrayCenter` → show/focus, or hide if visible), `register_summon_shortcut`, and a stub `mod reminders { pub fn spawn(_: tauri::AppHandle) {} }`.

- [ ] **Step 4: Capabilities.** `capabilities/default.json`:
```jsonc
{ "identifier": "default", "windows": ["main", "quickadd"],
  "permissions": [
    "core:default", "core:window:allow-show", "core:window:allow-hide", "core:window:allow-set-focus",
    "positioner:default",
    "global-shortcut:allow-register", "global-shortcut:allow-unregister",
    "notification:default", "store:default", "autostart:default",
    "process:allow-relaunch", "updater:default",
    { "identifier": "http:default", "allow": [{ "url": "http://**" }, { "url": "https://**" }] }
  ] }
```

- [ ] **Step 5: apps/web API adapter (the foundation — additive).** `apps/web/src/api/transport.ts`:
```ts
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
  return (input, init) => window.fetch(input, init)
}

export interface ApiSession {
  baseUrl: string // '' for web same-origin; 'https://instance' for desktop
  authHeaders(): Record<string, string> // {} for cookie web; { authorization: 'Bearer od_…' } desktop
  credentials: RequestCredentials // 'include' web; 'omit' desktop
}
```
`desktop-session.ts` (contract only — Task B implements the store-backed instance): export `getDesktopSession(): Promise<ApiSession | null>` and `saveDesktopSession(url, token)`, backed by `tauri-plugin-store`. Modify `client.ts` minimally so every request goes through `(await resolveTransport())(session.baseUrl + path, { ...init, credentials: session.credentials, headers: { ...session.authHeaders(), ...init.headers } })`, where `session` is the web same-origin session by default and the desktop session when `isTauri()`. Keep the web path byte-identical in behavior.

- [ ] **Step 6: Second Vite entry.** `apps/web/quickadd.html` (mounts `/src/quickadd.tsx`); `apps/web/src/quickadd.tsx` stub rendering a placeholder; `vite.config.ts` `build.rollupOptions.input = { main: 'index.html', quickadd: 'quickadd.html' }`. Confirm both emit to `dist/`.

- [ ] **Step 7: Install & gate.** Catalog entries, `pnpm install` (serialize). Run: `pnpm --filter @opendoist/web build` (both entries emit) + web Playwright suite still green (web behavior unchanged) + `pnpm --filter @opendoist/web test`; `cd apps/desktop/src-tauri && cargo check && cargo clippy` clean; `pnpm --filter @opendoist/desktop tauri dev` boots, main window shows the SPA, tray icon appears, `Cmd+Shift+Space` toggles the (placeholder) quickadd window under the tray. Do NOT commit.

---

### Task B: Desktop pairing + session (store-backed auth)

**Files:**
- Create: `apps/web/src/desktop/PairingScreen.tsx`, `apps/web/src/desktop/session-store.ts`, `apps/web/src/desktop/useDesktopGate.tsx`
- Replace stub: `apps/web/src/api/desktop-session.ts` (implement over `tauri-plugin-store`)
- Test: `apps/web/src/desktop/session-store.test.ts`

**Interfaces:** Consumes `tauri-plugin-store`, `transport.isTauri`, `/api/v1/info` + `/api/v1/user`. Produces `getDesktopSession`/`saveDesktopSession` (fulfilling A's frozen contract) + a gate component.

- [ ] **Step 1:** `session-store.ts` — load/save `{ instanceUrl, token }` via `Store.load('settings.json')`; strip trailing slashes; reject non-https URLs. Implement `getDesktopSession()` returning an `ApiSession` (`baseUrl`, `authHeaders` → Bearer, `credentials: 'omit'`) or null when unpaired.
- [ ] **Step 2:** `PairingScreen.tsx` — desktop-only onboarding: instance URL + `od_` token fields, a "Connect" button that validates via a `tauri-plugin-http` call to `/api/v1/info` then `/api/v1/user` (401 → bad token), persists on success, and a link explaining where to mint the token. `useDesktopGate` renders `PairingScreen` when `isTauri()` && unpaired, else the normal app; wire it at the app root guarded by `isTauri()` so the web build is untouched.
- [ ] **Step 3:** Verify: `session-store.test.ts` (mocked store: save/round-trip, https rejection); `tauri dev` → pair against a live temp instance → main window shows the real task list loading via the desktop transport (bearer token, no CORS error).

---

### Task C: Quick Add popover UI

**Files:**
- Replace stub: `apps/web/src/quickadd.tsx`
- Create: `apps/web/src/quickadd/App.tsx`, `apps/web/src/quickadd/quickadd.css`
- Test: `apps/web/src/quickadd/quickadd.test.tsx`

**Interfaces:** Reuses the web app's `QuickAddBox` component + `@opendoist/core` parser + the desktop `ApiSession`. Submits to `/api/v1/tasks/quick` via the tauri transport.

- [ ] **Step 1:** `quickadd/App.tsx` — a lean, single-purpose Quick Add: the existing `QuickAddBox` (live `@opendoist/core` token highlighting) styled for the frameless transparent popover (rounded, vibrancy-friendly background, autofocus). Build the `ParseContext` from `Intl` timezone.
- [ ] **Step 2:** On Enter → `quickAdd(text)` through `getDesktopSession()`'s transport; on success flash a confirmation and `getCurrentWindow().hide()` (import from `@tauri-apps/api/window`); on `Esc` hide without saving; on error show inline + keep the text. If unpaired, show a "Connect in the main window" message and a button that shows/focuses `main`.
- [ ] **Step 3:** Verify: `quickadd.test.tsx` (renders, highlights a sample string via core, submit calls the client); `tauri dev` → `Cmd+Shift+Space` → type `pay rent tom p1 #Home` → Enter → task created (verify via API) → popover hides.

---

### Task D: Reminders watcher + notifications + autostart + updater wiring

**Files:**
- Create: `apps/desktop/src-tauri/src/reminders.rs` (replaces A's stub module)
- Create: `apps/web/src/desktop/AutostartToggle.tsx` (a settings affordance)
- Modify: `apps/desktop/src-tauri/src/lib.rs` (only the `mod reminders;` declaration line if not present — coordinate: A leaves the stub, D fills the file)
- Test: Rust unit test in `reminders.rs` for the dedup/seen-set logic

**Interfaces:** Rust background task polling the instance API via `reqwest` (the http plugin's client or a direct `reqwest`), firing `app.notification()`.

- [ ] **Step 1:** `reminders.rs` — `pub fn spawn(app: AppHandle)` launches a `tauri::async_runtime::spawn` loop: every 60s, if a desktop session is configured (read the same `settings.json` store), GET the instance's upcoming-reminders/due feed with the bearer token, and for each reminder whose fire time has passed and whose id isn't in an in-memory `seen` set, `app.notification().builder().title("OpenDoist").body(<task content>).show()` and mark it seen. Persist nothing; the server is the source of truth and remains idempotent. Guard against unpaired/offline (log + skip).
- [ ] **Step 2:** Request notification permission on first paired launch (`isPermissionGranted`/`requestPermission` from the JS side at pairing completion, since permission UX is nicer from the window). `AutostartToggle.tsx` — a desktop-only settings switch calling `@tauri-apps/plugin-autostart` `enable()/disable()/isEnabled()`.
- [ ] **Step 3:** Verify (notifications need a bundled app — do a `tauri build --debug` and run the `.app`): seed a reminder due now on a live instance, confirm a native notification fires once (not repeatedly). Rust unit test the seen-set dedup. Note in the plan: notifications misbehave under `tauri dev` (raw binary) — test against the built app.

---

### Task E: Distribution, minisign updater, CI, README

**Files:**
- Create: `.github/workflows/desktop-release.yml`
- Create: `apps/desktop/README.md`
- Modify: `apps/desktop/src-tauri/tauri.conf.json` (`plugins.updater` endpoints + pubkey)

- [ ] **Step 1:** Generate a minisign keypair (`tauri signer generate`), document that `TAURI_SIGNING_PRIVATE_KEY`(+password) live as GitHub Actions secrets (NOT committed); put the public key in `tauri.conf.json` `plugins.updater.pubkey` and set `endpoints: ["https://github.com/Pranav-Karra-3301/opendoist/releases/latest/download/latest.json"]`.
- [ ] **Step 2:** `desktop-release.yml` — on a `desktop-v*` tag (or workflow_dispatch), run `tauri-apps/tauri-action` on a macOS runner (arm64 + x86_64) with the signing env, `signingIdentity: "-"` ad-hoc, producing the `.dmg` + `.app.tar.gz` + updater `latest.json`, attached to a GitHub Release. Does NOT need Apple secrets. Keep it separate from the server's `docker.yml`/`prepare-release.yml`.
- [ ] **Step 3:** `README.md` — what it is; **install**: download the `.dmg`, drag to Applications, then on first launch macOS blocks it → **System Settings → Privacy & Security → "Open Anyway" → authenticate** (Sequoia removed the old right-click→Open), with the `xattr -dr com.apple.quarantine /Applications/OpenDoist.app` fallback; **pair**: enter instance URL + `od_` token; **features**: menu-bar Quick Add (click the tray icon or `Cmd+Shift+Space` anywhere), native reminders, launch at login; **updates**: auto via the in-app updater; the honest note that it's ad-hoc-signed / not notarized (safe, just unverified by Apple). Footprint note: ~5–10 MB vs Electron's ~150 MB.

---

### Task F: Integration gate (SEQUENTIAL — after B–E)

- [ ] **Step 1:** `pnpm --filter @opendoist/web build` (both entries) + web `test` + Playwright suite green (web unaffected); `cargo fmt --check` + `cargo clippy -- -D warnings` + `cargo test` in `src-tauri`; `pnpm lint` clean on the TS.
- [ ] **Step 2:** `pnpm --filter @opendoist/desktop tauri build --debug` produces a runnable `.app`. Launch it against a live temp instance and walk: pair → main window loads real data (desktop transport, no CORS) → tray click AND `Cmd+Shift+Space` both summon the popover under the tray → quick-add creates a task → popover hides on blur → a due reminder fires one native notification → autostart toggle works. Record results.
- [ ] **Step 3:** Confirm the web build behavior is byte-identical (no cookie→bearer regression in the browser), the token never appears in logs/artifacts, and the http capability is the only broad scope. Do not commit — report ready-for-checkpoint.

## Self-Review (done)

- Coverage: menu-bar Quick Add popover (A tray + C UI + global shortcut in A), main app reuse (A), notifications (D), pairing/token auth (B), the CORS-free transport + configurable base URL (A — the load-bearing adaptation), autostart (D), no-Apple-account distribution + updater (E). Fast & light is inherent to Tauri (WebKit + Rust, ~5–10 MB, ~30–50 MB RAM).
- Risks: the apps/web api-client refactor must stay additive (Task A gate re-runs the web Playwright suite to prove it); `LSUIElement` is app-wide (v1 stays `Regular` Dock app — documented); notifications need the bundled app (Task D/F test against `tauri build`, not `dev`); http scope can't pin the runtime instance host (broad `https://**` scope is intentional and necessary); Sequoia Gatekeeper flow documented; keep Tauri crate ⇄ JS binding minors in lockstep.
- Shared foundation: the `transport.ts`/`ApiSession` abstraction is what makes the SPA reusable in both browser and native — the same seam a future iOS/Swift client or the browser extension's auth model would build against.
