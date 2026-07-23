# OpenTask Mobile (Expo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: `subagent-driven-development` (phase execution) and `executing-plans`. Steps are `- [ ]` checkboxes. Implementation agents = **Opus**; contract-freezing, integration gates, and review = **Fable**. Phase 1 is fully specified below; Phases 2–5 are scoped task lists that get expanded into full house-style task specs at each phase kickoff (same practice as the web stage plans).

**Goal:** A native iOS + iPadOS + Android app (`apps/mobile`, Expo) for OpenTask that pairs with any self-hosted instance, works offline (persisted cache + queued writes), and delivers real push notifications. Phone UX: bottom tab bar, thumb-reach FAB, Quick Add docked directly above the keyboard. iPad UX: persistent sidebar like the web app. v1 scope = core (views, task detail, Quick Add NLP, swipes, undo, search, settings/theme, push) **plus** Filters & Labels, Board view, and Reporting/karma. Ramble voice capture and QR pairing are v1.x backlog.

**Locked decisions (interview 2026-07-23):**
1. **Offline model:** TanStack Query cache persisted to disk (MMKV) + built-in paused-mutation replay on reconnect. Last-write-wins; no server sync protocol.
2. **Distribution:** TestFlight (paid Apple Developer) + Android APK on GitHub Releases. Tag scheme `mobile-vX.Y.Z`, mirroring `desktop-vX.Y.Z`. Public stores deferred.
3. **Notifications:** New **`expo` sink** in the server's existing notification-channel fan-out (`reminders/channels/`); the app registers its Expo push token as a channel on pairing. Deep-links to the task on tap.
4. **v1 power features:** Filters & Labels, Board view, Reporting/karma. Not Ramble.

**Architecture:** React Native shares React (components, hooks, TanStack Query, zustand) but **not the DOM** — no Tailwind CSS cascade, no Base UI, no dnd-kit, no `contenteditable`. So the split is: **logic ports verbatim, pixels are rebuilt on native primitives.** `@opentask/core` (Quick Add parser, recurrence, filters, karma, settings, view pipeline) is already pure TS with zero Node/DOM APIs and runs under Hermes as-is. The web API data layer (`client/transport/schemas/keys/cache-updates`) extracts into a shared `@opentask/api-client` package consumed by web + mobile; mobile supplies a third `ApiSession` (bearer `ot_…` from Keychain/Keystore, absolute base URL — exactly the seam the Tauri desktop already uses, and no CORS applies to native fetch). Palette values move from `tokens.css` into a TS source of truth in `@opentask/core` with a web parity test so both renderers share one theme. Live sync = SSE with `Authorization` header (`react-native-sse`) while foregrounded + refetch-on-foreground, same invalidation map as web.

**Tech stack (versions verified 2026-07-23 — pin these):**
- `expo` **SDK 57** (`57.0.8`) + `expo-router` `57.0.8` (SDK-versioned now), React Native `0.86.0`. React version is whatever SDK 57 pins — always add native/SDK deps via `npx expo install`, and **never** apply `catalog:react` to `apps/mobile` (duplicate-React is the classic pnpm+RN failure).
- `nativewind` `4.2.6` (Tailwind-style classes + runtime `vars()` theming), `react-native-reanimated` `4.5.3`, `react-native-gesture-handler` `3.1.0` (⚠ new major vs docs you may remember — AS-BUILT CHECK APIs), `@shopify/flash-list` `2.3.2`, `@gorhom/bottom-sheet` `5.2.14`, `react-native-keyboard-controller` `1.22.2` (KeyboardStickyView for the composer), `react-native-mmkv` `4.3.2`, `react-native-sse` `1.2.1`, `@react-native-community/netinfo` `12.0.1`.
- `@tanstack/react-query` from `catalog:` (5.101.x) + `@tanstack/react-query-persist-client` + `@tanstack/query-sync-storage-persister` `5.101.4`.
- `expo-secure-store`, `expo-notifications`, `expo-haptics`, `expo-crypto`, `expo-dev-client`, `jest-expo`, `@testing-library/react-native` `14.0.1` — SDK-pinned via `expo install`.
- Tooling: `eas-cli` `21.1.0` (CI builds), Biome + `tsc --noEmit` from the repo root as everywhere else.

## Global Constraints

- **Monorepo:** `apps/mobile` = `@opentask/mobile`, auto-included by `pnpm-workspace.yaml` (`apps/*`). pnpm stays on the default isolated linker; Metro gets `watchFolders: [repoRoot]` + `nodeModulesPaths` (standard Expo monorepo config). If native autolinking chokes on symlinks, the approved fallback is an `apps/mobile/.npmrc` with `node-linker=hoisted` — scoped to the app, never the repo root.
- **`@opentask/core` is consumed as raw TS source** (`exports: ./src/index.ts`) — Metro/babel-preset-expo transpiles it; do not add a build step to core.
- **Identifiers:** bundle id / package `dev.opentask.app`, URL scheme `opentask://`, display name **OpenTask**. Green brand (kale) icons/splash.
- **Auth/transport rules:** bearer tokens only ever in the `Authorization` header — never logged, never in URLs, never in query params. Token stored in `expo-secure-store` (Keychain/Keystore), instance URL may live in MMKV. `https://` required for stored instance URLs (mirror desktop's `normalizeInstanceUrl`); accept `ot_` and legacy `od_` token prefixes (mirror `normalizeToken`).
- **Additive to web:** every phase must leave `pnpm -r typecheck`, root Biome, all vitest suites, **and the web Playwright suite green**. Phase 1 moves web files into a shared package — the web gates are the proof of no regression.
- **Server DTOs are snake_case**; do not "fix" casing. Errors are RFC 9457 `application/problem+json`. Pagination is opaque `cursor`/`next_cursor` keyset (limit ≤ 200). 503 during backup-restore = retry shortly.
- TS strict, no `any`, colocated tests. `apps/mobile` unit tests run on **jest-expo** (`pnpm --filter @opentask/mobile test`); packages stay on vitest.
- **Parallel-execution rules:** builder tasks touch only their listed files, never run `pnpm install` or `git commit` (sequential Task A and integration gates, run by the lead, are the exceptions for install). AS-BUILT CHECK steps: inspect the real repo and adapt names/paths, but frozen `Interfaces` blocks MUST NOT change.
- **Human prerequisites (Pranav, before Phase 5):** Apple Developer Program enrollment ($99/yr); an Expo account + `EXPO_TOKEN` repo secret; one-time interactive `eas credentials` (generates the APNs key) and FCM V1 service-account upload for Android push. Phases 1–4 need none of this — local simulator/device dev builds only.

---

## Phase 1 — Foundation (workspace, theme source-of-truth, shared api-client, pairing, offline plumbing)

Deliverable: `apps/mobile` boots to a pairing screen, pairs against a real instance, and renders a proof-of-life authenticated screen (user name + task count) with the full offline/query stack wired. Web is provably unregressed.

### Task A: Scaffold `apps/mobile` + monorepo plumbing (SEQUENTIAL — everything depends on this; lead-run, `pnpm install` allowed)

**Files:** Create `apps/mobile/{package.json,app.json,tsconfig.json,babel.config.js,metro.config.js,tailwind.config.ts,global.css,jest.config.js,.gitignore}`, `apps/mobile/app/_layout.tsx`, `apps/mobile/app/index.tsx` (placeholder). Modify: root `biome.json` (include app), `pnpm-workspace.yaml` (only if new `allowBuilds` entries are demanded by install output).

- [ ] Step 1: `AUTHOR SCAFFOLD` — hand-write the Expo app (no `create-expo-app`; deterministic): expo-router entry, `app.json` with `scheme: "opentask"`, `newArchEnabled: true`, bundle ids `dev.opentask.app`, plugins (`expo-router`, `expo-secure-store`, `expo-notifications`, `react-native-keyboard-controller` if it ships a plugin — AS-BUILT CHECK), NativeWind babel preset + metro config per NativeWind v4 docs, Metro `watchFolders`/`nodeModulesPaths` for the workspace.
- [ ] Step 2: `INSTALL + DOCTOR` — `pnpm install`, then `npx expo install` for every SDK-pinned dep listed in the tech stack; run `npx expo-doctor` clean. AS-BUILT CHECK: nativewind 4.2.x vs SDK 57 — if incompatible, record it and fall back to the typed `ThemeTokens` context + `StyleSheet` (the theme object from Task B is the source of truth either way; NativeWind is sugar, not architecture).
- [ ] Step 3: `LOCAL DEV BUILD` — `npx expo run:ios` (simulator) and `npx expo run:android` boot the placeholder. Expo Go is NOT supported (MMKV needs a dev build); document `pnpm --filter @opentask/mobile dev` scripts.
- [ ] Step 4: Verify — `pnpm -r typecheck`, Biome, jest-expo runs an empty suite green. Do NOT commit.

**Interfaces (produces — FROZEN for Tasks B–E):** package name `@opentask/mobile`; scripts `dev`, `ios`, `android`, `test`, `typecheck`, `lint`; path alias `@/*` → `apps/mobile/src/*`; expo-router `app/` directory at `apps/mobile/app/`.

### Task B: Theme palette → TS source of truth (Opus)

**Files:** Create `packages/core/src/theme-palette.ts`, `packages/core/src/theme-palette.test.ts`, `apps/web/src/styles/tokens-parity.test.ts`. Modify `packages/core/src/index.ts` (export).

- [ ] Step 1: Transcribe `apps/web/src/styles/tokens.css` into typed data: `ACCENT_PALETTES` (7 accents × `{light,dark}` × the 8-var accent family), `NEUTRAL_TOKENS` (`{light,dark}` × ~50 semantic tokens incl. priorities, dates, status, focus ring), `PROJECT_PALETTE` (19 colors + dark overrides). Plain hex only — the CSS is already plain sRGB hex. Reuse the existing `AccentSchema`/`ACCENT_NAMES` from `settings.ts` for keys.
- [ ] Step 2: `tokens-parity.test.ts` (web, vitest): regex-parse `tokens.css` blocks (`:root`, `[data-mode="dark"]`, each `[data-accent="X"]`) and assert exact equality with the TS objects — this test IS the transcription verifier and the permanent drift guard. Web runtime is untouched.
- [ ] Step 3: Verify — core vitest + web vitest green (parity passing proves the transcription). Do NOT commit.

**Interfaces (produces — FROZEN):**
```ts
export type ThemeMode = 'light' | 'dark'
export interface AccentFamily { base: string; hover: string; disabled: string; soft: string; selected: string; selectedText: string; surface?: string; sidebarHover?: string }
export const ACCENT_PALETTES: Record<Accent, Record<ThemeMode, AccentFamily>>
export const NEUTRAL_TOKENS: Record<ThemeMode, Record<string, string>> // keys = --ot-* names sans prefix, camelCased
export const PROJECT_PALETTE: Record<string, { light: string; dark: string }>
```

### Task C: Extract `@opentask/api-client` (Opus — the one web-touching task)

**Files:** Create `packages/api-client/{package.json,src/index.ts}` + `src/{transport.ts,client.ts,schemas.ts,keys.ts,cache-updates.ts}` (moved from `apps/web/src/api/`), colocated tests moved too. Replace originals in `apps/web/src/api/` with one-line re-export shims (`export * from '@opentask/api-client'` style, path-per-path) so zero web imports churn. Modify `apps/web/package.json`, `pnpm-workspace.yaml` catalog if needed.

- [ ] Step 1: AS-BUILT CHECK — read the real `transport.ts`: the package must end up with **no** `@tauri-apps/*` import (Metro resolves even dynamic-import specifiers at bundle time). Refactor: `ApiSession` gains an optional `fetch?: FetchLike`; the shared client uses `session.fetch ?? globalThis.fetch`. Web keeps a thin `apps/web/src/api/transport.web.ts` (or keeps `transport.ts` local) that builds `WEB_SESSION`/desktop session incl. the Tauri dynamic import, and registers it via `setApiSession()`. Move, don't redesign — every exported name (`api`, `apiVoid`, `apiAllPages`, `ApiError`, `endpoints`, `qk`, schemas, `applyCreate`…`applyMove`, `Snapshot`, `serializeBody`) keeps its exact current signature.
- [ ] Step 2: Wire web boot to `setApiSession(...)` where the session is first resolved today (AS-BUILT: find the current resolution point in `transport.ts`/`useDesktopGate`).
- [ ] Step 3: Verify — full web gates: vitest, `pnpm -r typecheck`, Biome, **Playwright suite**, plus a desktop-shell smoke (pairing still compiles: `pnpm --filter @opentask/web build`). Do NOT commit.

**Interfaces (produces — FROZEN for Task D/E):**
```ts
export interface ApiSession { baseUrl: string; authHeaders(): Record<string, string> | Promise<Record<string, string>>; credentials: RequestCredentials; fetch?: FetchLike }
export function setApiSession(s: ApiSession): void
export function getApiSession(): ApiSession
```

### Task D: Mobile session + pairing UI (Opus)

**Files:** Create `apps/mobile/src/session/{store.ts,store.test.ts}`, `apps/mobile/src/session/PairingScreen.tsx`, `apps/mobile/src/session/gate.tsx`.

- [ ] Step 1: `store.ts` — `loadPairing()`/`savePairing(url, token)`/`clearPairing()`: token in `expo-secure-store`, URL in MMKV; re-validate `https://` on read; build and register the mobile `ApiSession` (`credentials: 'omit'`, `Authorization: Bearer …`). Port `normalizeInstanceUrl`/`normalizeToken` semantics from `apps/web/src/desktop/PairingScreen.tsx` (AS-BUILT: copy the validation rules, incl. legacy `od_`).
- [ ] Step 2: `PairingScreen.tsx` — two fields (Instance URL, API token) + Connect, replicating desktop's probe order: `GET /api/v1/info` (reachable OpenTask?), then `GET /api/v1/user` with bearer (401 ⇒ bad token). Keyboard-safe layout; paste-friendly; errors inline.
- [ ] Step 3: `gate.tsx` — `MobileGate` wraps the router root: unpaired → PairingScreen; paired → children. Disconnect action clears both stores.
- [ ] Step 4: Verify — jest-expo unit tests for store validation paths; manual pair against the prod instance. Do NOT commit.

### Task E: Offline/query/data plumbing (Opus)

**Files:** Create `apps/mobile/src/data/{query-client.ts,persist.ts,online.ts,sse.ts,adapters.ts}` + tests.

- [ ] Step 1: `query-client.ts` — QueryClient factory with web-matching defaults (AS-BUILT: read web's query client config); `adapters.ts` — the injected seam the ported hooks will use in Phase 3: `{ toastError(msg), haptic(kind), uuid() }` (uuid via `expo-crypto`; haptics via `expo-haptics` — mobile's answer to web's `playCue`).
- [ ] Step 2: `persist.ts` — MMKV + `query-sync-storage-persister` + `PersistQueryClientProvider` config (maxAge 7d, buster = app version); register `setMutationDefaults` for the task-mutation keys so paused mutations survive restart, `resumePausedMutations()` after restore.
- [ ] Step 3: `online.ts` — `onlineManager` ← netinfo; `focusManager` ← AppState; refetch-on-foreground.
- [ ] Step 4: `sse.ts` — `react-native-sse` EventSource with `Authorization` header against `GET /api/v1/events` (header auth is REQUIRED — the server takes no token query param); subscribe on foreground / close on background; map `event: sync` → the same entity→queryKey invalidation web uses (AS-BUILT: mirror `apps/web/src/api/sse.ts` mapping); on reconnect with a replay gap, invalidate everything.
- [ ] Step 5: Proof-of-life screen: after pairing, show `user.name` + open-task count via `useQuery(qk.tasks, …)` through the shared client. Verify — jest green, manual offline test (airplane mode: cached render + a queued mutation replays on reconnect). Do NOT commit.

### Task F: Phase-1 integration gate (SEQUENTIAL — Fable)

- [ ] Full matrix: `pnpm -r typecheck` + Biome + all vitest + web Playwright + jest-expo + `npx expo-doctor` + iOS simulator & Android emulator boot-and-pair walkthrough. Fix-forward anything red; then commit (conventional commits, e.g. `feat(mobile): scaffold Expo app with pairing + offline data layer`).

---

## Phase 2 — Shell & read views (expand at kickoff)

Adaptive navigation + all read surfaces. Tasks will follow the A/B/C pattern with `app/(app)/` routes as the disjoint-file seams.

- **Adaptive shell:** expo-router Tabs — phone: bottom bar **Today / Upcoming / Search / Browse**; iPad (`useWindowDimensions().width ≥ 768`): tab bar hidden, persistent 300pt sidebar (projects/labels/filters tree + counts, mirroring `apps/web/src/app/sidebar.tsx`) beside the content `Slot`. One navigator, two chromes — state survives rotation/Stage Manager resizes.
- **Browse tab** = account header, Inbox, favorites, projects tree, labels, filters (Todoist pattern); project/label/filter screens at `browse/project/[id]` etc.
- **Task rows** on FlashList: checkbox with priority ring, due/deadline/labels/recurrence chips — port `task-row.tsx` visuals to RN primitives; pull-to-refresh everywhere.
- **Today** (with overdue block + reschedule header), **Inbox**, **Upcoming** (week strip + day sections + infinite days — FlashList sticky headers), **Project** (sections).
- **Search screen:** server FTS (`GET /search`) with debounce, recents (port `palette/recents.ts` idea), `include_completed` toggle.
- **Settings:** appearance × accent (the theme provider: NativeWind `vars()` fed from `ACCENT_PALETTES`/`NEUTRAL_TOKENS`, `useColorScheme()` for `system`), General subset (home view, week start, smart date, sound cues surfaced as **Haptics** toggle), About (server version from `/info`, app version), Disconnect.
- **SSE + foreground refetch** wired into the shell; connection status pill when offline (cache-served).
- Gate: simulator + device walkthrough on iPhone-size and iPad-size; all repo gates green.

## Phase 3 — Write UX (expand at kickoff)

The reason this app exists. Quick Add is the crown jewel — treat `packages/core` `parseQuickAdd` as the engine and rebuild web's composer UX for touch:

- **FAB** bottom-right above the tab bar (thumb reach), also "add" affordances inside each view; iPad: sidebar button + hardware-keyboard shortcut.
- **QuickAddSheet:** modal docked **directly above the keyboard** via `react-native-keyboard-controller` (KeyboardStickyView/KeyboardAvoidingView) — input row + live NLP highlight + chip row + submit, backdrop-dismiss, autofocus-on-present (mirror the desktop popover's focus-retry lesson). NLP highlight technique: mirrored `<Text>` spans behind a transparent-text `TextInput` (the same overlay trick web's rich-textarea uses — reliable on both platforms, unlike nested-Text-in-TextInput on Android). Chips open **bottom sheets** (@gorhom): scheduler (calendar + presets), priority, labels multi-select, reminder (presets + absolute), deadline, duration; sigil autocomplete (`#/@/p/!`) as a suggestion strip between input and chips. Defaults honor `settings.quickAdd` chip prefs.
- **Task detail:** pushed full-screen route `task/[id]` (iPad: formSheet) — check/title/description, subtask list (add/complete/indent via detail), comments (plain text), meta editors reusing the same bottom sheets.
- **Mutations:** port `hooks/tasks.ts` shape onto the shared cache-updates transforms with the Phase-1 `adapters` seam (toast, haptics, uuid); optimistic everywhere; **single-slot undo** snackbar (port `features/undo/store.ts` semantics: complete/delete/reschedule/move).
- **Gestures:** swipe right = complete (haptic + undo), swipe left = scheduler sheet (gesture-handler 3.x Swipeable — AS-BUILT CHECK the v3 API); long-press drag reorder within a list (day_order/child_order semantics identical to web's DnD handlers).
- Gate: full add→edit→complete→undo→offline-replay walkthrough on both platforms.

## Phase 4 — Power features (expand at kickoff)

- **Filters & Labels:** label view, saved-filter view (core `parseFilter`/`filterTasks` evaluate client-side exactly like web's FilterPane), Filters & Labels manager screens (create/edit/reorder/delete + color picker); query editor = simple text field + validation errors from `FilterSyntaxError` (web's fancy editor is not a v1 goal).
- **Board view:** per-view layout prefs via `settings.viewPrefs` (shared `useViewPrefs` semantics); phone = horizontally snap-paged columns (~85% width), iPad = multi-column scroll. **Baseline interaction (committed):** intra-column long-press reorder + "Move to section/column" via card menu. **Stretch (behind a flag until it survives review):** free cross-column drag with edge auto-paging — this is the riskiest UI item in the plan; do not let it block the phase.
- **Display menu** (grouping/sort/filter/show-completed per view) as a bottom sheet, driving the same `pipeline.ts` logic from core/web.
- **Reporting/karma:** productivity screen — goal ring, karma level + trend, daily/weekly streaks, completed feed (`GET /tasks/completed`, `GET /productivity`); charts with a lightweight RN chart lib or hand-drawn reanimated bars (decide at kickoff; "tested libraries over bespoke").
- Gate: repo-wide green + walkthrough.

## Phase 5 — Push & release (expand at kickoff)

- **Server `expo` sink:** extend `ChannelTypeSchema` (`reminders/contracts.ts`) with `type:'expo'`, `config:{token: ExponentPushToken}`; sink `reminders/channels/expo.ts` POSTs to `https://exp.host/--/api/v2/push/send` (`{to,title,body,sound:'default',data:{url}}`) reusing the existing payload (lead-aware body already formatted by `formatReminderBody`); `DeviceNotRegistered` receipts → auto-disable using the webhook failure-streak pattern. Free bonus: devices show up (and are testable) in web Settings → notification channels.
- **App registration:** on pairing/boot with permission — `expo-notifications` token → upsert `POST /channels` (name = device name), store channel id, PATCH on rotation; permission pre-prompt mirroring web's `PermissionPreprompt`; Android notification channel (importance high); tap → `opentask://task/<id>` → router deep link.
- **Release pipeline:** icons/splash (kale green), `eas.json` (development / preview-APK / production), `.github/workflows/mobile-release.yml` on `mobile-vX.Y.Z` tags → `eas build --non-interactive` both platforms → `eas submit` to TestFlight + APK attached to the GitHub release (never "Latest", like desktop); `expo-updates`/EAS Update channel for OTA JS fixes; version + changelog via git-cliff, mobile-scoped.
- **Backlog after this phase (v1.x):** Ramble voice capture (server already does STT/LLM — mobile is record+upload+review sheet), QR pairing (web Integrations page renders a QR the app scans), home-screen widgets, share-sheet capture, Live Activities, multi-select toolbar, audio cues via expo-audio.

## Self-Review (done)

**Coverage:** All four interview decisions are load-bearing in the plan (offline → Task E; TestFlight/APK → Phase 5; expo sink → Phase 5 server task; scope → Phases 2–4). The user's three explicit UX demands are pinned: iPad persistent sidebar (Phase 2 shell), bottom bar + FAB at thumb reach (Phases 2–3), input docked above the keyboard (Phase 3 QuickAddSheet).

**Risks (ledger):**
1. **pnpm isolated linker × RN autolinking** — mitigated: standard Metro monorepo config first, app-scoped `node-linker=hoisted` fallback pre-approved (Task A).
2. **Duplicate React** — mitigated: `expo install` only, no `catalog:react` in mobile (Global Constraints).
3. **api-client extraction destabilizes web** — mitigated: shims keep every import path; Playwright + vitest + desktop build are the Task C gate; it's a move-not-redesign.
4. **SDK 57 ecosystem drift** (nativewind compat, gesture-handler v3 API) — mitigated: AS-BUILT CHECKs + a pre-approved StyleSheet fallback that keeps the theme architecture intact.
5. **Cross-column board drag** — highest UI risk, explicitly demoted to stretch with a committed baseline.
6. **Paused-mutation replay after restart** — needs `setMutationDefaults` before hydration; called out in Task E; airplane-mode walkthrough is the gate.
7. **SSE auth** — RN EventSource must send the bearer header (server accepts no query token); `react-native-sse` supports headers; background = closed socket by design (push covers you when backgrounded).

**Shared foundation:** After Phase 1, three renderers (web/desktop-webview/native) sit on one core (`@opentask/core`), one data layer (`@opentask/api-client`), and one palette (`theme-palette.ts` + parity test) — the seam the Tauri plan predicted ("the same seam a future iOS client would build against").

## Review shards

- `r1` — Phase 1 Task C diff (web shims + transport seam): import-path completeness, no behavior drift, no Tauri specifier reachable from the shared package.
- `r2` — offline semantics: persister config, mutation-defaults registration order vs hydration, replay idempotency (server create is not idempotent — replayed creates must not double-fire; verify TanStack dedupe behavior and document).
- `r3` — theme parity test strictness (every token accounted for, both directions: CSS⊆TS and TS⊆CSS).
