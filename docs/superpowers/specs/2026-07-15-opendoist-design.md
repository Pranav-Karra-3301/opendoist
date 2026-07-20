# OpenDoist — Design Spec

**Date:** 2026-07-15 · **Status:** approved by Pranav (interview + section-by-section review)
**Companion:** [Research dossier](../research/2026-07-15-opendoist-research.md) — verified Todoist grammar/shortcut/filter/token tables and library versions referenced throughout as "dossier §N".

## 1. What this is

A self-hosted, open-source, single-user Todoist alternative with full keyboard-first web parity (minus collaboration), a voice "Ramble" capture pipeline, proper reminders on browser/desktop, an iCal subscription feed, and a first-class API + CLI — shipped as one Docker container writing to one `/data` volume.

**Explicitly not in v1 (non-goals):** sharing/assignees/teams · board & calendar layouts (first post-1.0 items) · CalDAV (later, experimental) · Google Calendar two-way sync (pipeline) · location reminders · email reminder channel (the channel interface ships; SMTP later) · native mobile apps (the PWA is the mobile story) · localization (UI + parser are English at launch).

**Locked decisions (kickoff interview):** single-user · TypeScript monorepo, SQLite, one container · online-first (REST + optimistic UI + SSE; no sync engine) · Ramble = pluggable STT + optional LLM structuring · reminders = Web Push + ntfy/Gotify/webhook · auth = password + API tokens + generic OIDC in v1.

## 2. Product spec

### 2.1 Entities

| Entity | Key fields (beyond id/user_id/timestamps) |
|---|---|
| Project | name, description, color (palette name), parent_id, child_order, is_favorite, is_archived, is_collapsed, view prefs. Inbox = undeletable default project |
| Section | project_id, name, section_order, is_archived, is_collapsed |
| Task | project_id, section_id, parent_id, child_order, content (md), description (md), priority **1–4, 1 = highest**, due (see 2.2), deadline_date, duration_min (≤1440), day_order, labels (m2m), is_collapsed, uncompletable (derived from `* ` prefix), completed_at, deleted_at (soft) |
| Label | name (unique), color, item_order, is_favorite |
| Filter | name, query, color, item_order, is_favorite |
| Comment | task_id, content (md), attachment (file meta → `/data/attachments`) |
| Reminder | task_id, type relative/absolute, minute_offset or due, recurring flag, fire_at_utc, fired_at |
| PushSubscription / NotificationChannel | endpoint+keys / ntfy·gotify·webhook config |
| Ramble | audio path, status uploaded→transcribed→extracted, transcript, extracted JSON |
| ActivityEvent | type (task_added/completed/uncompleted/updated/deleted, project_*, comment_*…), payload, at |
| DayStats | date, completed_count, goal_met — feeds karma/streaks/reporting |

Priority note: Todoist's API stores 4=p1; we store **1=p1** and the importer maps. Documented in API docs.

### 2.2 Due vs Deadline vs Reminder (Todoist semantics, dossier §1.4)

- **Due** — when you plan to work on it. Shapes: date-only; date+time (stored as wall-clock + user tz); optional duration. Recurring: original `due_string` is stored and re-parsed to compute occurrences (Todoist's own model). `every` advances from schedule; `every!` from completion. Full grammar per dossier §1.2–1.3 (intervals, positional `every 3rd friday`, `every workday`, multiple days, `starting/until/for` bounds, holiday words). Not supported (as Todoist): per-day different times, exclusion rules.
- **Deadline** — hard cutoff. **Date + optional time**, no recurrence — a deliberate divergence from Todoist's date-only deadlines (owner decision, 2026-07-18). Quick Add `{march 30}` or `{next friday 5pm}` → `deadline: { date, time | null }`. A deadline time never creates reminders and never affects Today/Upcoming placement (deadlines never do); filter `deadline:` operators stay date-granular. Red chip in UI (shows the time when present).
- **Reminder** — notification only. Automatic (user default offset, default 30 min before, only for timed dues; "0" = at time; disable-able), relative `!30 min before`, absolute `!tomorrow 9am`, recurring `!every day 5pm`. Fires through enabled channels.

Recurrence engine (core): NL grammar → internal RecurrenceSpec → next-occurrence math on Temporal (rrule-temporal where RFC-5545-mappable; `every!`/workday/positional handled natively). Completing a recurring task advances due + logs completion; Shift+click completes the series. Property-tested across DST.

### 2.3 Quick Add grammar

Live token highlighting (chrono-node match offsets + rich-textarea overlay); click a token to detokenize; chip row mirrors tokens (customizable per Settings → Quick Add); smart-date recognition can be disabled globally.

| Token | Syntax | Notes |
|---|---|---|
| Due | natural language, no prefix | `tom 4pm`, `every other tue starting mar 3`, bare `6pm` → today-or-tomorrow |
| Duration | `for 45min` after a time | max 24h |
| Deadline | `{natural date, optionally with time}` | `{march 30}`, `{next friday 5pm}`; time optional (Todoist divergence, owner 2026-07-18) |
| Reminder | `!time` / `!30 min before` | repeatable |
| Project / Section | `#Project` `/Section` | autocomplete, create-new inline |
| Label | `@label` | repeatable, create-new inline |
| Priority | `p1`–`p4` | p4 = default |
| Description | `// text` | **OpenDoist extension** (Todoist has no inline token) |
| Uncompletable | leading `* ` | renders without checkbox |

Save keys: Enter saves + reopens; Ctrl+Enter saves-above; Esc cancels (confirm if dirty). Same parser powers `POST /tasks/quick` and `opendoist add`.

### 2.4 Views & display

Inbox · Today (Overdue block + Reschedule action) · Upcoming (month picker + week strip + infinite day list + drag-between-days + per-day add) · Project (sections, subtask collapse) · Label · Filter (comma splits into multiple panes). Per-view Display menu: group by (none/project/priority/label/date), sort (manual/date/added/priority/alphabetical), filter by (priority/label/due), show-completed toggle; persisted per view. List layout only in v1.

**Filter query language** (core engine, dossier §1.7 minus people/workspace operators): `& | ! () , \ *` + `today/tomorrow/yesterday`, `N days`, `next week`, `date:/date before:/date after:`, `no date`, `no time`, `overdue`/`od`, `recurring`, `deadline:*`, `no deadline`, `created:*`, `p1..p4`, `no priority`, `@label`(+wildcard), `no labels`, `#Project`, `##Project` (with descendants), `/Section`, `!/*`, `search:`, `subtask`, `uncompletable`, `view all`.

**Search:** SQLite FTS5 (content+description+comments), surfaced in the ⌘K palette and `search:` filters.

**Keyboard:** full Todoist web map adopted verbatim (dossier §1.6) minus collaboration keys (`Shift+R`, `Shift+S`); `?` overlay lists everything; ⌘K command palette (navigate, run commands, search, recents). Sequences (`g then t`) via react-hotkeys-hook `'g>t'`.

**Undo:** complete/delete/reschedule/move show a 10 s toast with inverse-operation undo (soft-delete + activity log make this cheap).

### 2.5 Productivity, reporting, settings

- **Productivity:** daily goal (default 5) / weekly goal (default 25), streaks, days-off weekdays, vacation mode (pauses streaks), karma toggle. Karma formula (documented, simple): +5 per completion, +3 bonus if completed on/before due day, +10 daily-goal hit, +25 weekly-goal hit, −10 per task ≥4 days overdue (applied on completion or deletion); levels use Todoist's thresholds (Beginner 0 → Enlightened 50k).
- **Reporting:** activity feed (all event types, filter by project/type/date, day-grouped like the screenshot) + completed-tasks view + goal charts. Unlimited history.
- **Settings pages:** Account (name, email, password, TOTP 2FA, connected OIDC, danger zone) · General (home view, timezone, date/time format, week start, next-week day, weekend day, smart-date toggle) · Theme (8 themes, auto-dark, default **Kale**) · Sidebar (show/hide views, task counts) · Quick Add (chip visibility/order, labels vs icons) · Productivity · Reminders (auto-reminder offset, test buttons) · Notifications (per-channel toggles: push devices list, ntfy/gotify/webhook config) · Backups (list/download/restore/back-up-now, retention, include-attachments) · Integrations (API tokens `od_…` with scopes, **Developer**: OpenAPI/Scalar links; STT + LLM provider/keys; calendar-feed URL + rotate) · About/What's New (version, changelog, update banner).
- **No Pro gating.** No plan/limit machinery; only operational caps via env (upload size default 25 MB).

### 2.6 Import / export / backups

- **Todoist importer** (table stakes, dossier §4.11): (a) upload Todoist backup ZIP (per-project CSVs), (b) live import via user's Todoist API token (projects/sections/tasks/labels/comments/reminders where representable). Maps priority inversion, drops collaborators, reports skips. Exposed in `GET /api/v1/info.available_importers`.
- **Export:** full JSON (canonical, restorable) + per-project CSV (Todoist-compatible shape).
- **Backups:** nightly `VACUUM INTO` snapshot → zip (+ attachments unless disabled) into `/data/backups`, default retention 14, Settings UI: list/download/"Back up now"/restore (upload → verify → swap with pre-restore safety snapshot). Litestream S3 replication documented as optional sidecar.

## 3. Architecture

### 3.1 Monorepo (pnpm workspaces + catalogs, Node 22 LTS)

```
apps/server    Hono API · serves built SPA · SSE · jobs · .ics · push · uploads
apps/web       Vite 8 + React 19 SPA (installable PWA)
packages/core  PURE zero-IO: zod schemas/DTOs · Quick Add parser · recurrence
               engine · filter-query engine · date helpers · karma rules
packages/cli   commander 15 binary `opendoist` (docs suggest alias od=opendoist)
docs/          markdown now; Docusaurus later
```

`core` is the boundary that keeps everything honest: web imports it for instant client-side parsing/highlighting, server for authoritative parsing, CLI for offline-identical behavior. No IO, no framework imports; golden-table + property tests live here.

### 3.2 Server

- **Hono 4 + @hono/zod-openapi (Zod 4)**: every route zod-typed → OpenAPI at `/api/v1/openapi.json`, **Scalar UI at `/api/v1/docs`**. REST `/api/v1/*`: tasks (+`/tasks/quick` accepting raw Quick Add text), projects, sections, labels, filters, comments, reminders, rambles, search, user/settings, push-subscriptions, channels, backups, import, ical-token, info, health. Cursor pagination `{results, next_cursor}`; opaque nanoid ids; RFC 9457 problem-JSON errors.
- **SSE** `/api/v1/events` (hono/streaming): mutations publish `{type, entity, ids}`; clients invalidate TanStack Query keys. In-process event bus; `Last-Event-ID` replay from a small ring buffer.
- **Data:** Drizzle + better-sqlite3. Boot order: open DB → PRAGMAs (`WAL`, `synchronous=NORMAL`, `busy_timeout=5000`, `foreign_keys=ON`) → `migrate()` → listen. FTS5 external-content table + triggers via custom migration. Soft-delete everywhere user-visible (powers undo/activity); hard-purge job after 30 days.
- **Auth:** better-auth + Drizzle adapter. Email/password (argon2id via `@node-rs/argon2`, m=64MiB t=3 p=4) · generic OIDC via better-auth's `genericOAuth` plugin (as-built in phase 3; originally spec'd as `@better-auth/sso` — same env-driven issuer/client/secret behavior, no DB seeding; buttons appear from `/info`) · `@better-auth/api-key` personal tokens, prefix `od_`, scopes `read`/`read_write`, sessions-from-API-keys so one middleware covers cookie + `Authorization: Bearer od_…` · optional TOTP plugin. **Registration auto-locks after first user**; reopen with `OPENDOIST_ALLOW_REGISTRATION=true`.
- **Scheduler:** one croner tick /30 s scans `reminders WHERE fire_at_utc <= now AND fired_at IS NULL LIMIT 100`, dispatches to all enabled channels, sets `fired_at` (idempotent; catch-up on restart; suppress+log if >12 h stale). Occurrence materialization: on task write/complete, compute next reminder instants (UTC) from user tz. Nightly jobs (croner): backup, karma/day-stats rollup, activity purge, update check (GitHub releases, 24 h, `OPENDOIST_DISABLE_UPDATE_CHECK`), push-subscription pruning (410/404).
- **Notification channels** (one interface: `send(reminder, task) → delivered|gone|error`): **webpush** (`web-push`, VAPID keys auto-generated to `/data/secrets.json`; payload title/body/deep-link/tag; SW `notificationclick` focuses-or-opens) · **ntfy** (topic+server+token, priority/click/actions mapped) · **gotify** (app token) · **webhook** (JSON `{event:"reminder.due", task{…}, firedAt}`, `X-Signature: sha256=` HMAC, 2 retries, auto-disable after 10 consecutive failures). Email later behind the same interface.
- **iCal feed:** `GET /ical/:token/tasks.ics` — per-user 128-bit capability token (rotate in Settings; `webcal://` copy button). **VEVENT only**; timed dues = timed events (duration or 30 min), date-only dues = all-day; recurrences **expanded server-side** (1 month back / 6 months forward, capped ~500); stable UIDs `task-{id}[-{occurrence}]@opendoist`; ETag + 304 + `Cache-Control: private, max-age=300`; 404 on bad token; UI documents Google's 8–24 h refresh lag.
- **Ramble:** `POST /api/v1/rambles` multipart (webm/opus or m4a) → row status `uploaded → transcribed → extracted` (each stage retryable; audio kept until confirm). **STT adapters:** `openai-compatible` (one impl covers OpenAI `gpt-4o-mini-transcribe`, Speaches sidecar, whisper.cpp server — base URL + model + optional key) + thin `deepgram` + `elevenlabs`. **Extractor:** `none` → single task, transcript in description; `openai-compatible` LLM → strict JSON schema `{tasks:[{title, notes, due, priority, labels}]}` where `due` stays the *spoken phrase*, parsed by our chrono layer (LLM never invents dates); zod-validate, one retry. Web UI: hold-to-record button in Quick Add → review/edit extracted tasks → confirm-save. Keys stored encrypted at rest (AES-GCM, key in `/data/secrets.json`).

### 3.3 Web app

Vite 8 + React 19 + TanStack Query 5 (optimistic mutations with rollback) + Zustand (UI state) + shadcn/ui on **Base UI** + Tailwind 4 `@theme` tokens + dnd-kit (sortable lists; pragmatic-dnd is the named fallback) + cmdk + react-hotkeys-hook 5 + TanStack Virtual (lists >1k). PWA: manifest (brand icons, maskable), service worker = Workbox app-shell cache (offline read of last data; writes need connectivity) + push handlers. Two-step notification permission pre-prompt at first-reminder moment; iOS install instructions screen.

### 3.4 CLI

`opendoist` — commands: `login` (URL+token, or `OPENDOIST_URL`/`OPENDOIST_TOKEN`), `add "<quick add text>"` (core parser, offline-identical), `list/today/upcoming [filter-query]`, `done <id>`, `rm <id>`, `projects/labels/filters`, `search <q>`, `open` (browser), `whoami`. `--json` on every read command for piping; human output via `cli-table3` + `util.styleText`; config `~/.config/opendoist/config.json` chmod 600 (env-paths). Built with tsdown (core inlined); published to npm via changesets; also baked into the Docker image for `docker exec`.

### 3.5 Deployment, config, ops

- **One container**, port **7968**, one `/data` volume: `opendoist.db`, `attachments/`, `backups/`, `secrets.json` (session secret, VAPID keys, encryption key — auto-generated on first boot, never required as env). Canonical: `docker run -d -p 7968:7968 -v ./data:/data ghcr.io/pranav-karra-3301/opendoist` + 5-line compose in README. Multi-stage `node:22-alpine`, version build-arg, `HEALTHCHECK` wget-spider on `/api/health`.
- **Env (`OPENDOIST_*`, all optional):** `PUBLIC_URL` (recommended; enables correct push/ics/OIDC URLs), `PORT`, `DATA_DIR`, `ALLOW_REGISTRATION`, `DISABLE_UPDATE_CHECK`, `LOG_LEVEL`, `TRUST_PROXY`, `UPLOAD_MAX_MB`, `BACKUP_RETENTION`, `BACKUP_INCLUDE_ATTACHMENTS`, `BACKUP_CRON`, `OIDC_ISSUER/CLIENT_ID/CLIENT_SECRET/NAME`, `STT_PROVIDER/BASE_URL/MODEL/API_KEY`, `LLM_PROVIDER/BASE_URL/MODEL/API_KEY` (env = instance defaults; Settings overrides). One docs page lists every var.
- **Ops endpoints:** `GET /api/health` → `{status:"ok"}`; `GET /api/v1/info` (unauthenticated): version, auth providers, feature flags (stt/llm/push configured), `available_importers`. Frontend renders footer version + update banner from it.
- **Logging:** pino JSON to stdout, request ids; `LOG_LEVEL`.

### 3.6 Timezones

User timezone is a setting (defaulted from browser at first login). Date-only dues = calendar dates (no tz). Timed dues = wall-clock + user tz (Todoist "floating" behavior); reminder instants materialized to UTC via `@date-fns/tz`; recurrence math on Temporal (polyfill). DST rules: skipped-hour occurrences shift forward; repeated-hour fires once.

## 4. Design system

Tokens land as `apps/web/src/styles/tokens.css` **before any component**, adopting the dossier §2.8 Tailwind-4 `@theme` spec verbatim (it encodes Doist's real reactist values + captured theme CSS):

- Type 12/13/14/16/20/24/32, weights 400/**600**/700; system font stack.
- 4px spacing grid; radii **5px and 10px only**; sidebar 280px (210–420); content max 800px; task row ~42px; 18px circle checkbox with priority ring + 10%→20% fill and 250 ms complete animation.
- Semantic color tokens with **Kale default** (accent `#4c7a45`, hover `#3e6737`); all 8 themes as `[data-theme]` blocks; auto-dark = OS unless explicit choice (explicit wins both ways); priority `#d1453b/#eb8909/#246fe0/#999999` (+dark variants); 20-color project palette with dark overrides; date colors (today/tomorrow/weekend/next-week/overdue); **focus ring always blue `#1f60c2`**.
- Icons: Lucide only; 16 inline / 18 row-actions / 20 toolbar / 24 nav; strokeWidth 1.75 at 20–24; icon color `text-secondary` → `text-primary` on hover; accent only for active nav.
- Motion 150–300 ms `cubic-bezier(0.4,0,0.2,1)`; `prefers-reduced-motion` respected.
- Component rules cheatsheet (dossier §2.9) copied into `CONTRIBUTING.md`; deviations require editing the cheatsheet in the same PR.
- **Brand:** Glyphy list glyph (CC BY 3.0, credited in README + `assets/brand/ATTRIBUTION.md`); `currentColor` in-app; standalone/brand green `#3e6737`; favicon + PWA icons generated from it.

## 5. Release engineering & quality

- **License AGPL-3.0.** SemVer 0.x. Default branch `main`.
- **Conventional-commit PR titles** enforced in CI; squash merge; **git-cliff** → `CHANGELOG.md` (Keep-a-Changelog headings). `workflow_dispatch` release: bump → tag `vX.Y.Z` → GitHub Release with generated notes + curated highlights + attached compose/.env → triggers docker publish.
- **GHCR** `ghcr.io/pranav-karra-3301/opendoist`: `latest`, `X.Y`, `X.Y.Z`, `nightly` (main); amd64+arm64 on native runners, per-arch tags + manifest merge, registry build cache (Karakeep's workflow as template).
- **In-app:** account-menu footer `vX.Y.Z · Changelog`; What's-New dialog after version change (parses bundled CHANGELOG); update-available banner.
- **CI (`ci.yml`):** Biome → tsc → Vitest (all packages) → build → Playwright → **react-doctor** (`ci install`, new-issues-only) + **knip**; fallow trialed once the codebase is real, gated only if signal is good. `docker.yml`: nightly on main + versioned on release.
- **Tests:** core = golden grammar tables (every dossier syntax row is a fixture) + recurrence property tests across DST; server = integration on temp SQLite (auth, CRUD, filters, reminders, ics, importer); web = Playwright (quick-add→today→complete→undo, keyboard nav, theme switch, palette, settings); a11y smoke via axe on key views.
- **npm (CLI only):** changesets.

## 6. Build phases (each ends working + committed)

1. **Foundation** — pnpm workspaces, Biome, tsconfig, catalogs, tokens.css, CI skeleton, Dockerfile, git-cliff, LICENSE/README/CONTRIBUTING, brand assets wired
2. **Core** — schemas, Quick Add parser, recurrence engine, filter engine (fully tested)
3. **Server** — DB schema/migrations, auth (password+OIDC+tokens), CRUD API, OpenAPI/Scalar, SSE, FTS
4. **Web shell** — layout/sidebar/theming, task list CRUD, Quick Add live tokens, Inbox/Today/Upcoming, keyboard map, ⌘K palette
5. **Filters & Labels, search, settings pages, reporting, undo**
6. **Reminders** — scheduler, Web Push PWA, ntfy/gotify/webhook, iCal feed
7. **Ramble** — STT adapters, optional LLM extraction, review-confirm UI
8. **CLI**
9. **Backups/restore, Todoist importer, productivity/karma, What's New + update check**
10. **Polish → 0.1.0** — PWA install, a11y pass, docs/README/screenshots, release flow dry run

## 7. Risks & mitigations

- **Quick Add parser scope** (biggest): mitigate with golden tables from dossier §1.2–1.3 as the acceptance suite; chrono-node handles dates, our layer handles recurrence/tokens; ship behind the smart-date toggle.
- **Recurrence correctness:** Temporal-based engine + property tests; store original `due_string` so recomputation is always possible.
- **iOS push** requires PWA install: dedicated install-instructions screen; ntfy channel as reliable fallback.
- **dnd-kit frozen:** isolate behind a small internal wrapper; pragmatic-dnd named as replacement.
- **Drizzle v1 RC:** stay on 0.45.x; migrate when stable.
- **better-auth OIDC edge cases:** password login always remains; OIDC is additive.
- **Name/trademark proximity** ("OpenDoist" vs Doist): acceptable for a personal OSS project; renaming is one find-replace before any public launch.
