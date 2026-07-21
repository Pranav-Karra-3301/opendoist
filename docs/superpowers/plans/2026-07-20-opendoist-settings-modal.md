# Settings & Theme Pass — Implementation Plan

> **For agentic workers:** Runs AFTER the Views & Chrome pass commits (shares e2e ports, never concurrent). Task A (Fable) recons + freezes contracts; builders B–D sequential Opus; integrate/review/gate Fable. Builders: never `pnpm install`/git; OS-temp artifacts; the e2e config is 127.0.0.1-pinned (fixed ports 7968/5173) — run scoped checks only, not the full suite.

**Goal:** Three owner asks (2026-07-20):
1. **Settings modal polish** — make it match the Todoist reference: wide centered two-pane modal, grey backdrop, an **icon nav rail** (Settings + search + icon-labelled pages + active highlight), scrollable content pane + × close.
2. **Settings entry in the user menu** — settings is currently only reachable via the `/settings` URL; add a "Settings" item to the profile/user menu (in the new sidebar) that opens it.
3. **Appearance × accent theme model** — replace today's "Dark-is-one-of-8-themes" with two independent controls: an **Appearance** toggle (Light / Dark / System) and an **Accent** color (the palette), where the accent applies in BOTH light and dark (each accent gains a dark variant). No Pro gating.

**As-built:** `apps/web/src/features/settings/SettingsLayout.tsx` is ALREADY a Base UI Dialog (route `/settings/$page`, nav + lazy pane, Esc/backdrop close, mobile back-slide) with a `SETTINGS_PAGES` registry + `SettingsSearch`. Theme tokens live in `apps/web/src/styles/tokens.css` (dossier §2.8: `:root` light Kale, `[data-theme="dark"]`, `[data-theme=<accent>]` light overrides, `.system-dark` head-script). The user menu currently lives in the top bar (the Views & Chrome pass moves it into the sidebar — this pass adds the Settings item there).

**Reference:** the 5 supplied screenshots (two-pane modal + nav; Theme/Quick Add/Productivity/Reminders/Integrations pages). Spec `docs/superpowers/specs/2026-07-15-opendoist-design.md` §2.5 + §4; dossier §2.8 (token spec), §2.9 (visual law).

## Global Constraints

- Radii 5/10px; focus ring `#1f60c2`; Lucide icons; Biome format; TS strict no-`any`; tests colocated.
- **No Pro gating** — Theme shows all accents + Dark, no locked/Upgrade. No Subscription/Calendars/Add-team pages. OpenDoist pages only: Account, General, Theme, Sidebar, Quick Add, Productivity, Reminders, Notifications, Backups, Integrations, About.
- The settings schema change is a CONTRACT change across `packages/core` (settings zod) + server + web; it must be **back-compatible** — existing stored `theme` values migrate to `{appearance, accent}` on read/upgrade with no data loss.
- No regressions — routing, search, close-to-home, and every page's behavior stay intact; existing suites green.

---

### Task A: Recon + frozen contracts (SEQUENTIAL — Fable)

- [ ] **Settings modal recon:** read `SettingsLayout.tsx` + `registry.ts` + `SettingsSearch.tsx`; note current modal/nav dimensions, whether the registry has an `icon`, active styling, and any Theme-page Pro remnant. Freeze the modal target (nav list + Lucide icon each — Account CircleUser, General SlidersHorizontal, Theme Palette, Sidebar PanelLeft, Quick Add SquarePen, Productivity TrendingUp, Reminders AlarmClock, Notifications Bell, Backups Archive, Integrations Blocks, About Info; modal ~1100×720 max 90vw/85vh, 10px radius, shadow-dialog, grey backdrop; nav rail ~230px surface bg; active = accent-soft bg + selected-text + accent icon; pane = title + × + scroll).
- [ ] **User-menu recon:** find the user/profile menu component (as relocated to the sidebar by the Views & Chrome pass — read it as-built at HEAD) and where to add a "Settings" item that navigates to `/settings`.
- [ ] **Theme-model recon + design (the big one):** read `tokens.css`, the theme lib (`applyTheme`/`getTheme`/`THEME_CHOICES` + the head script), and the settings `theme`/`autoDark`/`syncTheme` fields (in `packages/core` settings zod + web `useSettings`). **Freeze the new model:**
  - **Settings shape:** replace `theme: <one-of-8>` (+ `autoDark`) with `appearance: 'light' | 'dark' | 'system'` and `accent: <accentName>` (accents: `kale`(default) `todoist` `moonstone` `tangerine` `blueberry` `lavender` `raspberry`). Keep `syncTheme` if present. **Migration:** `dark`→`{appearance:'dark', accent:'kale'}`; each light accent name→`{appearance:'light', accent:<name>}`; `autoDark:true`→`appearance:'system'`. Runs on settings read (web) + a core schema default/transform so old rows never break.
  - **Token architecture:** two axes. **Accent** via `[data-accent="<name>"]` blocks that define the accent's LIGHT and DARK values as `--accent-light`/`--accent-dark` (+ hover/soft). **Mode** via `[data-mode="dark"]` (and `.system-dark` head-script when `appearance:'system'`) that swaps neutral tokens (bg/surface/text/border) to dark AND selects `--od-accent: var(--accent-dark)`. `:root` = light neutrals + `--od-accent: var(--accent-light)`. Each accent needs a dark accent value (dossier §2.5 lists dark accent overrides, e.g. Kale→#7ca86f — use those; derive the rest by brightening for ≥4.5:1 on #1e1e1e).
  - **Apply fns:** split `applyTheme` into `applyAppearance(mode)` (sets `data-mode` or `.system-dark` per OS) + `applyAccent(name)` (sets `data-accent`); head script sets both from stored settings and follows `prefers-color-scheme` only when `appearance:'system'`.
- [ ] Record ALL of the above (exact names, the migration map, the token block shape) in notes for builders. Gate: typecheck + lint clean; delete repro artifacts.

### Task B: Settings modal shell + nav + user-menu entry (Opus)

**Files:** `features/settings/{SettingsLayout,registry,SettingsSearch}.tsx/.ts` + the sidebar user-menu component (add the Settings item only).
- Restyle the Dialog to the frozen dims/backdrop/radius/shadow; rebuild the nav rail (Settings heading + search + icon+label rows + active/hover); pane header = title + × close; keep routing/search/close-to-home/mobile/canonicalisation. Add `icon` to each registry entry. **Add a "Settings" item to the user menu** that navigates to `/settings/account`. Verify: typecheck + lint + `SettingsSearch.test.ts` green.

### Task C: Theme token + schema refactor (Opus)

**Files:** `apps/web/src/styles/tokens.css`, the theme lib file(s) (`applyTheme`→`applyAppearance`/`applyAccent`, head script), `apps/web/index.html` (head script), `packages/core/src/settings.ts` (schema + migration), web `useSettings`/theme wiring + their tests.
- Implement the mode×accent token architecture per Task A: `[data-accent=<name>]` with `--accent-light`/`--accent-dark`, `[data-mode="dark"]`/`.system-dark` swapping neutrals + selecting the dark accent, `:root` light default (kale). Every accent gets a WCAG-checked dark variant. Split the apply fns; head script sets `data-mode` + `data-accent` from settings and honors OS only in `system`. Migrate the settings schema (`theme`+`autoDark` → `appearance`+`accent`) back-compatibly with unit tests for the migration map. Verify: core settings tests + web theme tests + typecheck + lint green; a targeted spec that switching appearance flips `data-mode` and switching accent flips `data-accent` and both persist.

### Task D: Theme settings page + page-fit (Opus)

**Files:** `features/settings/pages/ThemePage.tsx` (+ other `pages/*` only for pane-width/padding fit).
- Rebuild the Theme page: an **Appearance** control (Light / Dark / System segmented) + an **Accent** picker (the 7 accents as selectable swatches/cards, live preview), plus Sync-theme if kept. NO Pro/Upgrade/locked section. Wire to the new `appearance`/`accent` settings via the Task C apply fns. Ensure every other page fits the wider pane (consistent max-width/padding). Verify: scoped typecheck + lint + affected page tests green.

### Task E: Integration gate (SEQUENTIAL — Fable)

- Wire seams; `pnpm verify` exit 0; full Playwright green (kill strays + free 7968/5173 first). Live walk: the user menu has a **Settings** item that opens the modal; the modal is a wide two-pane with grey backdrop + icon nav; every page opens/renders; the **Theme page** has an Appearance toggle (Light/Dark/System) + accent picker — switching appearance to Dark flips the whole app to dark with the chosen accent's dark variant, switching accent recolors in both modes, and both persist across reload; System follows OS; no Upgrade anywhere; deep-link + search + Esc/backdrop/× all work; an OLD stored theme value still loads correctly (migration). Never weaken a test.

## Review shards (Fable, sequential)
- **r1 modal + user-menu (Playwright/axe):** modal dims/backdrop/radius/shadow; icon nav + active highlight + search; user-menu Settings item opens it; ×/Esc/backdrop close-to-home; every page renders without overflow; zero serious axe + focus-trap correct.
- **r2 theme model:** Appearance Light/Dark/System each apply correctly (data-mode/`.system-dark`); each accent applies in BOTH light and dark with legible contrast (spot-check computed `--od-accent` + text contrast on a dark surface ≥ 4.5:1); accent × appearance persist across reload; System honors `prefers-color-scheme`; the settings migration maps every old value (`dark`, each accent, `autoDark`) to the right `{appearance,accent}` (unit + a live old-row load). No Pro remnants.

Then fixer (if findings) → final gate.

## Self-Review (done)
- All three asks covered: modal polish (B), user-menu Settings entry (B), appearance×accent model (A design + C tokens/schema + D page). Theme change is back-compatible (migration) and disjoint from the Views & Chrome pass (that touches layout/sidebar/display/task-row; this touches settings/tokens/theme-lib). Sequenced after chrome to avoid e2e port collision. No Pro/Subscription/Calendars — single-user, no gating.
