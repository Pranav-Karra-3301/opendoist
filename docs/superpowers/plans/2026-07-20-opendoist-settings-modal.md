# Settings Modal Polish — Implementation Plan

> **For agentic workers:** Runs AFTER the Views & Chrome pass commits (shares e2e ports, so never concurrent). Task A (Fable) recons + freezes; builders B–C sequential Opus; integrate/review/gate Fable. Builders: never `pnpm install`/git; OS-temp artifacts; the e2e config is 127.0.0.1-pinned (fixed ports 7968/5173) — run scoped checks only, not the full suite.

**Goal:** Make Settings a polished two-pane modal matching the Todoist reference screenshots — a wide centered overlay with a grey backdrop, an **icon nav rail** (Settings title + search + icon-labelled pages + active highlight) beside a scrollable content pane with an × close — instead of the current minimal nav. All pages render cleanly in it; the Theme page shows **all 8 themes with no Pro/Upgrade gating**.

**As-built:** `apps/web/src/features/settings/SettingsLayout.tsx` is ALREADY a Base UI Dialog (route `/settings/$page`, ~200px nav + lazy pane, Esc/backdrop close, mobile back-slide) with a `SETTINGS_PAGES` registry + `SettingsSearch`. This pass restyles the shell/nav to the reference and verifies every page fits — it is NOT a rebuild. Task A confirms the exact current-vs-target gaps (icons present? width? active styling?).

**Reference:** 5 screenshots supplied — the two-pane modal with grey backdrop, left rail (Settings + search + icon nav + "active" highlight), right pane with page content + × close; Theme page (Sync theme / Auto Dark toggles + theme cards, NO Pro section); Quick Add (drag-reorder chip actions + preview); Productivity (karma/goals/days-off/vacation); Reminders (auto-reminder + channel toggles + test); Integrations (tabs + iCal URL). Spec `docs/superpowers/specs/2026-07-15-opendoist-design.md` §2.5; dossier §2.9 (visual law), §2.5 (Todoist settings dissection).

## Global Constraints

- Radii 5/10px; focus ring `#1f60c2`; Kale accent; Lucide icons; Biome format; TS strict no-`any`.
- **No Pro gating anywhere** — the Theme page lists all 8 themes as selectable (no locked/Upgrade section, unlike the Todoist screenshot). No "Subscription" page, no "Add team", no "Calendars" page (single-user; the iCal feed lives under Integrations).
- OpenDoist's actual pages only: Account, General, Theme, Sidebar, Quick Add, Productivity, Reminders, Notifications, Backups, Integrations, About.
- No regressions — deep-linking (`/settings/$page`), search, close-to-home, and every page's existing behavior stay intact; existing settings unit/e2e tests green.

---

### Task A: Recon + frozen target (SEQUENTIAL — Fable)

- [ ] Read `SettingsLayout.tsx` + `registry.ts` + `SettingsSearch.tsx` and the page components. Record: does the registry carry an `icon` per page (add if missing)? current modal width/height + nav width; current nav item styling (active/hover); how the × close + backdrop render; whether the Theme page still shows any Pro/Upgrade remnant.
- [ ] Boot a live stack (unique ports, temp data dir), open `/settings/theme`, screenshot-compare mentally against the reference; list the concrete deltas (icons, width, active highlight, spacing, section dividers).
- [ ] **Freeze the target:** the ordered nav list with a Lucide icon each — Account (CircleUser), General (SlidersHorizontal), Theme (Palette), Sidebar (PanelLeft), Quick Add (SquarePen), Productivity (TrendingUp), Reminders (AlarmClock), Notifications (Bell), Backups (Archive), Integrations (Blocks), About (Info); modal ~1100px × ~720px (max 90vw/85vh), 10px radius, shadow-dialog, grey backdrop; nav rail ~230px `surface` bg + right border; active item = `accent-soft` bg + `selected-text` + accent icon; right pane = page title (20px) + × top-right + scroll.
- [ ] Gate: typecheck + lint clean; delete any repro artifacts.

### Task B: Modal shell + icon nav rail (Opus)

**Files:** `apps/web/src/features/settings/SettingsLayout.tsx`, `apps/web/src/features/settings/registry.ts` (add `icon` field), `apps/web/src/features/settings/SettingsSearch.tsx` (nav item render).
- Restyle the Dialog shell to the frozen dimensions/backdrop/radius/shadow. Rebuild the nav rail: "Settings" heading, the search box, then icon+label rows per the registry with active/hover states matching the reference; right pane header = page title + × close. Keep routing, search filtering, close-to-home, mobile back-slide, and unknown-page canonicalisation exactly as-is. Add the `icon` to each `SETTINGS_PAGES` entry. Verify: `pnpm --filter @opendoist/web typecheck` + lint + `SettingsSearch.test.ts` green; scoped visual check via one targeted spec if useful.

### Task C: Page-content fit + Theme page (Opus)

**Files:** `apps/web/src/features/settings/pages/*` as needed (padding/width to fit the wider pane; the Theme page especially).
- Ensure each page's content sits correctly in the wider pane (consistent max-width, padding, section dividers per the reference). **Theme page:** all 8 themes as a selectable card grid (Todoist, Dark, Moonstone, Tangerine, Kale, Blueberry, Lavender, Raspberry) with Sync-theme + Auto-Dark toggles — NO "Pro themes"/locked/Upgrade section. Touch only page files (not the shell — Task B owns it). Verify scoped typecheck + lint + affected page unit tests green.

### Task D: Integration gate (SEQUENTIAL — Fable)

- Wire seams; `pnpm verify` exit 0; full Playwright green (kill strays + free 7968/5173 first). Live walk: open Settings → it's a wide centered two-pane modal with a grey backdrop + icon nav; every page (Account…About) opens from the nav and renders cleanly; the Theme page shows all 8 themes with no Upgrade; search filters the nav; deep-link `/settings/reminders` works; Esc/backdrop/× close returns to the view.

## Review shard (Fable)
- **r1 settings-modal fidelity (Playwright/axe):** modal dimensions + grey backdrop + 10px/shadow-dialog; nav rail has icon+label per page with a correct active highlight + working search; × / Esc / backdrop all close to home; every registry page renders without overflow; Theme page = 8 selectable themes, zero Pro/Upgrade remnants; deep-linking + unknown-page canonicalise; zero serious/critical axe on the open modal + focus-trap correct. Report only verified deviations.

Then fixer (if findings) → final gate.

## Self-Review (done)
- Restyle not rebuild (dialog already exists); target frozen to the reference minus Pro/Subscription/Calendars/Add-team (OpenDoist is single-user, no Pro). B owns the shell/nav+registry; C owns the pages — disjoint. Runs after the chrome pass to avoid e2e port collision.
