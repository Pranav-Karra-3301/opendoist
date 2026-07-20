# Views & Chrome Pass — Implementation Plan

> **For agentic workers:** Task A (Fable) does recon + bug diagnosis + freezes contracts. Builders B–F run SEQUENTIALLY as Opus (disjoint file sets + flap-resilience). Integrate/review/gate = Fable. Builders: never `pnpm install`/git; OS-temp artifacts; unique random ports + temp `OPENDOIST_DATA_DIR`; the e2e config is pinned to 127.0.0.1 (fixed ports 7968/5173) so run only scoped/targeted checks, not the full suite.

**Goal:** Owner-feedback pass (2026-07-20): remove the Quick Add syntax hint; fix the **reminders-duplicating-tasks** bug; fix **subtasks**; in contextual views (e.g. Today) default new tasks to that date but **hide the redundant date chip**; **click empty space deselects** the focused task; add a **6-dot drag handle** to reorder tasks; add a **top-right Display menu** (per the reference); and **remove the global top bar, moving its controls into the sidebar** (per the reference).

**Architecture:** Text stays source of truth in Quick Add; drag reorder reuses the existing dnd-kit sortable if present. The Display menu reuses the phase-5 `features/display/DisplayMenu.tsx` logic, restyled + repositioned. The chrome move is a layout restructure in `app/layout.tsx` + the sidebar.

**Reference:** two screenshots supplied — (1) Display popover: Layout [List·Board·Calendar], Completed-tasks toggle, Sort [Grouping·Sorting], Filter [Assignee·Priority·Label]; (2) sidebar header: user menu, notifications bell, sidebar toggle, red "Add task" with the Ramble mic on its right, Search, Inbox. Spec `docs/superpowers/specs/2026-07-15-opendoist-design.md`; dossier §2.9 (visual law), §1.8 (Display options).

## Global Constraints

- Priorities 1=highest; radii 5/10px; focus ring `#1f60c2`; Kale accent; Biome format; TS strict no-`any`; tests colocated.
- Board & Calendar layouts are v1 non-goals — show them in the Display menu but **disabled with a "Soon" affordance** (List is the only active layout). Assignee filter is meaningless single-user — omit it (or a static "Me").
- No regressions: existing Playwright specs + unit suites stay green; the web build stays byte-behavior-identical except the deliberate changes.
- Bug fixes must ship with a reproducing regression test that fails before / passes after.

---

### Task A: Recon + bug diagnosis + frozen contracts (SEQUENTIAL — Fable)

**Deliverable:** a notes block (for all builders) covering diagnosis + exact file/owner map + frozen seams. Create no feature code; may add throwaway repro tests (deleted after).

- [ ] **Diagnose "reminders duplicates tasks":** boot a live stack (unique ports, temp data dir), create a task, add a reminder via the chip picker AND via quick-add `!30 min before`. Observe whether a duplicate task row appears; determine if it's (a) a web cache/optimistic bug (dup vanishes on reload → wrong query-cache update on reminder create, or an SSE `reminders` event mis-handled as a `task` insert), or (b) a real server dup (persists after reload → the reminder route/materializer inserting a task). Pin the exact file + line. Candidates: `apps/web/src/api/hooks/*` reminder mutation, `apps/web/src/api/sse` entity mapping, `apps/server/src/reminders/{routes,materialize}.ts`, `apps/server/src/reminders/task-write hooks`.
- [ ] **Diagnose "subtasks don't work as expected":** create a subtask (via more-menu "Add subtask", quick-add under a parent, and the detail `subtask-list.tsx`); verify `parent_id` persists, the row nests/indents in the list, collapse/expand works, and completing the parent behaves correctly. Record exactly what's broken vs expected. Files: `components/task/{task-row,task-list}.tsx`, `components/task-detail/subtask-list.tsx`, `apps/server/src/api/routes/tasks.ts`.
- [ ] **Survey the chrome:** in `app/layout.tsx` record the top-bar element and every control in it (Add task, Search, user menu, notifications, sidebar-collapse, Ramble mic); find the sidebar component + its header; find where `DisplayMenu` currently mounts and its props; find the Quick Add syntax-hint element (added in the last pass) and its file; find `task-meta.tsx` date-chip rendering + the `task-row.tsx` selection/focus model + list container.
- [ ] **Freeze seams (record exact names):** (1) a `viewContext` signal for contextual-date suppression — e.g. rows receive `hideDueChipWhen?: string /* ISO date */` or the view passes its implied date so `task-meta` can suppress a matching due chip; (2) the sidebar-header contract (which controls move in, in what order per screenshot 2); (3) the per-view top-right **Display button slot** the layout exposes after the top bar is removed; (4) the drag-handle + reorder hook names (reuse existing sortable). 
- [ ] Gate: `pnpm --filter @opendoist/web typecheck` + `pnpm lint` clean; delete any repro test files.

### Task B: Remove the Quick Add syntax hint (Opus)

**Files:** the quick-add input/hint file the recon named (likely `components/quick-add/quick-add-dialog.tsx` or the input component) + its test if any.
- Remove the one-line syntax-hint caption under the input entirely (owner doesn't want it). Keep the chip row + pickers. Verify no orphaned styles; typecheck + lint + the quick-add unit tests green.

### Task C: Fix reminders duplicating tasks (Opus)

**Files:** exactly the file(s) the recon root-caused (web cache/SSE mapping OR server reminder route/materializer) + a regression test.
- Fix per diagnosis so adding a reminder never produces a duplicate task (in the UI and in the DB). Regression test: reproduce the dup (fails pre-fix), assert single task post-fix. If the bug is web-side, add a hook/SSE unit test; if server-side, a route integration test. Scoped suites green.

### Task D: Fix subtasks (Opus)

**Files:** `components/task/{task-row,task-list}.tsx` and/or `components/task-detail/subtask-list.tsx` and/or `apps/server/src/api/routes/tasks.ts` per diagnosis + tests.
- Fix per Task A's expected-vs-actual: subtask creation sets `parent_id`, the row nests/indents under its parent, collapse/expand works, and parent completion behaves per spec (§2.1 subtask semantics). Regression test covering the specific breakage. Scoped suites green.

### Task E: Task-row refinements — date suppression, click-deselect, drag handle (Opus)

**Files:** `components/task/{task-row,task-meta,task-list}.tsx` (+ the list/view container for click-deselect) + a targeted e2e spec `apps/web/e2e/task-row-interactions.spec.ts`.
- **Contextual date suppression:** using Task A's `viewContext`/`hideDueChipWhen` seam, when a task's due date equals the view's implied date (Today view → today; a specific Upcoming day → that day), hide the due-date chip (still show a *time* if present, and still show overdue/other-day dates). New tasks created in Today still default to today (unchanged) — just no redundant "Today" chip.
- **Click-empty-to-deselect:** clicking empty space in the list/content area clears the focused/selected task (blur), matching Todoist. Must NOT fire when clicking a row, a control, or a popover.
- **6-dot drag handle:** a `⠿` grip appears on row hover (left of the checkbox, per Todoist), keyboard-accessible, and drives manual reorder via the existing dnd-kit sortable (persist new `child_order` through the existing move/reorder mutation). Manual sort only (no-op/hidden when a non-manual sort is active).
- e2e: chip hidden in Today for a today-due task but shown for other-day; click empty space clears selection; drag handle reorders two rows and the order persists.

### Task F: Chrome restructure — Display menu top-right + top bar → sidebar (Opus)

**Files:** `app/layout.tsx`, the sidebar component, `features/display/DisplayMenu.tsx`, the per-view page shells that host the Display button + `apps/web/e2e/chrome-layout.spec.ts`.
- **Remove the global top bar.** Move its controls into the **sidebar header**, ordered per screenshot 2: user menu (name + ▾), notifications bell, sidebar-collapse toggle on the top row; then the red **"Add task"** button with the **Ramble mic** on its right; then **Search**; then Inbox/nav (existing). Preserve every control's behavior + keyboard shortcuts (q, ⌘K, etc.).
- **Top-right Display menu** per screenshot 1: a "Display" button at the top-right of each list view opens a popover — **Layout** (List active; Board/Calendar shown **disabled + "Soon"**), **Completed tasks** toggle, **Sort** (Grouping, Sorting), **Filter** (Priority, Label; no Assignee). Reuse `DisplayMenu` logic + per-view persistence; restyle to match (10px radius, shadow-menu, segmented layout control). Mount in Inbox/Today/Upcoming/Project/Label/Filter view headers.
- e2e: no top bar in the DOM; sidebar header contains Add task + mic + Search + notifications + user menu; Display button top-right opens the popover; toggling Completed / changing Grouping reflects in the list; Board/Calendar are disabled.

### Task G: Integration gate (SEQUENTIAL — Fable)

- Wire deferred seams; `pnpm verify` exit 0; full Playwright suite green (kill strays + free 7968/5173 first). Live walk of all 8 items: no hint; add-reminder makes no dup (verify via API — one task); subtask nests + parent completion correct; Today task shows no "Today" chip; click empty space deselects; drag handle reorders + persists; Display menu top-right works; top bar gone, controls in sidebar. Never weaken tests.

## Review shards (Fable, sequential)
- **r1 bug-correctness:** reproduce the ORIGINAL reminders-dup and subtasks bugs against the fixed build to confirm they're gone (API-level: adding a reminder leaves exactly one task; subtask has correct parent_id + nesting + parent-complete behavior); regression tests actually fail on revert.
- **r2 chrome+interactions (Playwright/axe):** top bar absent + all its controls present and functional in the sidebar; Display popover matches the reference (disabled Board/Calendar, sections, 10px/shadow-menu, blue focus ring); drag-handle reorder persists; click-deselect safe cases (clicking a row/control/popover does NOT deselect); contextual date-chip suppression correct across Today + an Upcoming day; a11y on the new Display popover + sidebar header (zero serious axe).

Then fixer (if findings) → final gate (`pnpm verify` + full Playwright + hygiene).

## Self-Review (done)
- All 8 items mapped: hint (B), reminders dup (C), subtasks (D), contextual date + click-deselect + drag handle (E), Display menu + top-bar→sidebar (F). Bugs (C, D) diagnosed in A before fixing, each with a regression test.
- File ownership disjoint: B=quick-add input; C=reminder root-cause file; D=subtask files; E=task-row/meta/list; F=layout/sidebar/display. Sequential order avoids working-tree overlap. Board/Calendar shown-disabled per non-goals; Assignee omitted (single-user).
