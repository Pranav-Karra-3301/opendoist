# Board View Pass — Implementation Plan

> **For agentic workers:** Task A (Fable) recons + freezes contracts; builders B–D run SEQUENTIALLY as Opus; integrate/review/gate = Fable. Builders: never `pnpm install`/git; OS-temp artifacts; unique random ports + temp `OPENDOIST_DATA_DIR`; the e2e config is pinned to 127.0.0.1 (fixed ports 7968/5173, workers:1) so builders run only scoped checks (typecheck/lint/unit; D may run ONLY its new board spec files one-at-a-time on unique random ports, killing everything it starts). The full suite is Integrate/Gate's job.

**Goal:** Owner ask (2026-07-22): enable the **Board layout** — currently shown disabled + "Soon" in the Display menu — as a clean, Todoist-parity kanban renderer for every task view. Two reference screenshots were supplied (transcribed exhaustively in §Reference below — agents cannot see the images; this section is the visual law for the pass).

**Architecture (the one big idea):** Board is a **second renderer over the exact same grouped output the list already computes** — not a parallel data path. Sections, grouping, filtering, sorting, contextual date suppression, completed handling, and every mutation the board needs **already exist** (built in earlier phases):

- Server: `sections` table (`section_order`), `tasks.section_id`, full CRUD + `/sections/reorder` routes (`apps/server/src/api/routes/sections.ts`). **No server changes expected in this pass.**
- Web: `useSections` (`api/hooks/sections.ts`), `AddSection` (`views/project/add-section.tsx`), `SectionBlock` + `AddTaskRow` (`views/project/section-block.tsx`), cross-section list drag (`views/project/use-project-dnd.ts`), `InlineAdd` (`components/quick-add/inline-add.tsx`), grouping pipeline (`features/display/pipeline.ts` → `pipelineGroups`/`RenderGroup`, `pipelineSortFilter`), `GroupedTaskList` + `DisplayMenu` (`features/display/DisplayMenu.tsx`), per-view prefs (`useViewPrefs` + core `viewKey`), SSE `section` → `qk.sections` mapping, contextual `hideDueChipWhen` suppression (Views & Chrome pass), click-empty-to-deselect seam, `CompletedSection`.
- Core: `ViewPrefsSchema` (`packages/core/src/settings.ts`) — **gains a `layout` field** (the only contract change).

New code is essentially `apps/web/src/features/board/` (BoardView / BoardColumn / BoardCard / board dnd hook) + the `layout` pref + view-shell wiring.

## Global Constraints

- Priorities 1=highest; radii **5/10px only** (cards/tiles/popovers 10px, small controls 5px); focus ring `#1f60c2`; accent via `--od-accent` (Kale default) — **never hardcode Todoist red**; Lucide icons; Biome format; TS strict no-`any`; tests colocated.
- Calendar layout stays **disabled + "Soon"**. List behavior stays byte-identical when `layout: 'list'` (the default) — zero regressions; all existing suites green.
- The `layout` pref is a **back-compatible contract change**: `ViewLayoutSchema = z.enum(['list','board'])`, `ViewPrefs.layout` default `'list'` (zod default ⇒ old stored `viewPrefs` rows parse unchanged; no migration needed). `prefsAreDefault` must treat `layout !== 'list'` as non-default (Display badge counts it); `pipelineDeviates` semantics — Task A decides whether layout participates (recommendation: layout is a renderer choice, NOT a pipeline deviation; it must not trigger grouping-reset affordances).
- Board must work in **every view that mounts DisplayMenu**: inbox, today, upcoming, project, label, filter. Column derivation per view is frozen by Task A (§Column model).
- Reuse before rebuild: card meta = the same chip primitives as `task-meta.tsx` (extract if needed — do not fork chip rendering); section rename/delete = the same mutations/menu actions as `SectionBlock`; add-section = `AddSection`; per-column add-task = `InlineAdd` with per-column defaults; drop semantics = the same mutations the list drags use.

## Reference (transcribed from the two supplied screenshots — this is the visual law)

**Screenshot 1 — Today, board layout:**
- Existing page header unchanged: H1 "Today", "N tasks" count line beneath.
- Two columns, left-aligned, top-aligned, fixed width (~280px), ~16–24px gap: **"Overdue"** (bold) + grey count "7" + a right-aligned **"Reschedule"** text button (destructive/red text style) in the column header; **"Jul 22 · Today"** + grey count "0".
- Overdue column: stack of task cards. Today column (empty): a **"+ Add task"** tile (plus icon + grey label, quiet/ghost style) sits where the first card would be.
- Card anatomy: surface bg, 1px `--od-border`, **10px radius**, ~12px padding, subtle shadow on hover; checkbox top-left (priority-colored ring: p1 red circle visible in reference); title (14px) beside it, wrapping to 2 lines; meta row below: date chip (red + calendar icon when overdue — "Jul 6", "Jul 12", "Jul 15 9 PM" with time; recurring glyph "↻" for recurring — "Yesterday ↻"), comment-count chip ("💬 1"), then project chip ("Inbox" with icon) or label chip ("#🎉 Birthdays"). A **⋯ more button appears top-right of the card on hover** (opens the existing task row menu).
- No add-task tile on the Overdue column (you cannot create an overdue task).

**Screenshot 2 — Project "Work", board layout:**
- Existing project header unchanged (title, actions). (The reference's breadcrumb/description are Todoist chrome — out of scope, keep our header.)
- One column **per section** — "Copilot 1", "API 1", "OS 1": section name bold + grey count + a **⋯ button** (hover) opening the section menu (Rename, Delete — same actions/mutations as the list's `SectionBlock` menu; Delete confirms first).
- Cards as above; here with green (non-overdue) date chips — "Today", "Today 9 PM" + reminder-bell glyph + a label chip "tag".
- **"+ Add task"** at the bottom of every section column (plus + grey label, accent on hover) → opens the inline composer scoped to that section.
- At the right end of the columns row: an **"Add section" tile** — a quiet rounded (10px) `--od-hover`-bg rect with icon + "Add section" — opening the existing `AddSection` inline input as a new rightmost column stub.
- Tasks with no section: a leading **"(No section)"** column, shown **only when it contains tasks** (reference shows none).

**Layout mechanics (both screenshots):** the board body escapes the centered `--content-max` column — full-bleed with the page's horizontal padding; the board region fills the remaining viewport height; **columns scroll vertically inside themselves; the board scrolls horizontally** (page body never scrolls horizontally elsewhere). Cards are dragged by the whole card (no 6-dot handle on boards; pointer-sensor activation distance keeps click-to-open working); keyboard drag via the existing dnd keyboard-sensor pattern. Clicking empty board space deselects (same seam as list). Completed cards (when Show completed is on) appear greyed/struck at the bottom of their column, consistent with the list's completed treatment.

## Column model (Task A freezes the exact table)

| View | Default columns | Cross-column drop mutates |
|---|---|---|
| Project (groupBy none) | "(No section)" (only if non-empty) + one per section by `section_order` | `section_id` + order (same mutation as list cross-section drag) |
| Today | Overdue (+ Reschedule) · "‹Mon D› · Today" | drop Overdue→Today sets due to today (keep time); no drop INTO Overdue |
| Upcoming | one column per day section (existing day slicing) | due date → column's day (keep time), existing day-reorder mutation |
| Inbox | mirrors Inbox list structure (sections if inbox lists them; else single column) | as project |
| Label / Filter / any view with explicit groupBy | one column per `pipelineGroups` RenderGroup | groupBy date → due date; priority → priority; label → swap grouped label; project or 'none' → cross-column drag disabled (within-column reorder only) |

Within-column reorder persists through the same order mutation the list uses for that view (child_order / day_order). Contextual date suppression: a card whose due date equals its column's implied date hides the redundant date chip (time still shows) — same `hideDueChipWhen` seam, now fed per-column.

---

### Task A: Recon + frozen contracts (SEQUENTIAL — Fable)

- [ ] Read the as-built seams: `pipeline.ts` (`RenderGroup` shape, `pipelineGroups`, `pipelineSortFilter`, `prefsAreDefault`, `pipelineDeviates`), `DisplayMenu.tsx` (Layout segmented control as shipped — currently Board/Calendar disabled+"Soon" — and the Display-badge count), `useViewPrefs`, core `ViewPrefsSchema`/`viewKey`, project view slicing (`views/project/index.tsx` root+`SectionBlock` ordering, `use-project-dnd` move semantics + sensors), Today/Upcoming/Inbox shells + where label/filter task views live, `InlineAdd` defaults API, `AddSection`, `task-meta.tsx` chip primitives + `hideDueChipWhen`, click-empty-deselect seam, `CompletedSection`, whether Today's list already has an overdue Reschedule affordance (reuse its action if so).
- [ ] **Freeze:** (1) `ViewLayoutSchema`/`ViewPrefs.layout` + Display-badge/`prefsAreDefault`/`pipelineDeviates` semantics; (2) the per-view column-derivation table above with exact source functions; (3) drop-semantics table (mutation per grouping, incl. "drag disabled" cells) + order-persist mutation per view; (4) the `features/board/` component/file map + prop contracts (BoardView receives the same inputs GroupedTaskList gets — groups/tasks/viewKey/prefs — plus per-column context: implied date, section id, add-task defaults, header actions); (5) card meta = which task-meta primitives are reused/extracted; (6) a11y contract (column = labelled region/list, cards focusable, Enter opens detail, keyboard drag).
- [ ] Boot a live stack once (unique random ports, temp `OPENDOIST_DATA_DIR`) to confirm section CRUD/reorder routes + list drag behavior as-built. Record EVERYTHING in notes (≤3800 chars) for builders. Delete throwaway artifacts; typecheck + lint clean; no feature code.

### Task B: Layout pref + board rendering (Opus)

**Files:** `packages/core/src/settings.ts` (+ test), `features/display/DisplayMenu.tsx` (+ pipeline.ts if `prefsAreDefault` moves there), `features/board/{BoardView,BoardColumn,BoardCard}.tsx` (new) + colocated unit tests, the six view shells (minimal `layout === 'board' ? <BoardView…> : <existing>` switch), `useViewPrefs` if it needs the field surfaced.
- Add `layout` to `ViewPrefs` (default `'list'`, back-compat proven by unit test on an old-shaped stored value). Enable **Board** in the Display menu segmented control (persisted per view; Calendar stays disabled+"Soon"); badge counts non-list layout as a customization.
- Render the board per §Reference: full-bleed horizontally-scrolling column row; per-column vertical scroll; column headers (name/count, Overdue's Reschedule slot, section ⋯ slot, Add-section tile slot — actions may be inert stubs wired in C ONLY if the underlying mutation isn't trivially reusable; prefer wiring live immediately); cards with checkbox (existing complete mutation + optimistic subtree behavior), title, reused meta chips with per-column date suppression, hover ⋯ menu (existing task menu), click→detail; empty-column "+ Add task" tile placement; completed-at-bottom when showCompleted. NO dnd in this task.
- Verify (scoped): core settings tests, new board component tests, web typecheck, biome on touched files.

### Task C: Board interactions (Opus)

**Files:** `features/board/` (from B) + `features/board/use-board-dnd.ts` (new) + tests; may touch `views/project/use-project-dnd.ts` ONLY to export/reuse move helpers.
- Whole-card drag: within-column reorder + cross-column drop per the frozen semantics table (section move, Today/Upcoming reschedule keeping time, priority set, label swap; disabled cells render no droppable affordance). Pointer sensor with activation distance (click still opens detail) + keyboard sensor parity. Optimistic updates via the existing mutations; PATCH shapes identical to list drags.
- Wire all header/tile actions live: per-column `InlineAdd` with column defaults (section_id / due date / grouped priority/label), Add-section tile → `AddSection` (new column appears), section ⋯ Rename/Delete-with-confirm (list parity), Overdue **Reschedule** → the frozen reuse (or: one action rescheduling all overdue to today, matching the list's affordance if one exists). Click-empty-space deselect on the board container.
- Verify (scoped): unit tests for the drop→mutation mapping table (every grouping × drop case, incl. disabled ones) + typecheck + biome.

### Task D: Board e2e + polish (Opus)

**Files:** `apps/web/e2e/board-layout.spec.ts` (+ a second spec file if cleaner), polish-only diffs inside `features/board/`.
- e2e (deterministic-first: assert via API/`expect.poll`; for drags prefer the keyboard sensor or PATCH-wait sync like `task-row-interactions.spec.ts` — the existing mouse-drag tests are load-flaky, do not copy that pattern blindly): (1) Display menu switches Today to Board; choice persists across reload and is per-view (Inbox stays list). (2) Project board: section columns in `section_order` with counts; "(No section)" only when non-empty; add task via a section column's tile → API shows correct `section_id`. (3) Cross-column card drag persists (API assert after reload). (4) Today board: Overdue + "‹Mon D› · Today" headers; card in Today column hides redundant date chip; Reschedule empties Overdue into Today. (5) Add-section tile creates a live column; section rename + delete-with-confirm reflect. (6) axe: zero serious/critical on an open board (columns as labelled regions, cards focusable).
- Polish vs §Reference: spacing/radius/ring audit, horizontal scroll behavior (no page-level horizontal scroll leakage), empty states, dark mode (board surfaces use tokens — spot-check `data-mode="dark"`).
- Verify (scoped): run ONLY the new board spec file(s), one at a time, on unique random ports with a temp data dir; kill everything started; plus typecheck + biome.

### Task E: Integration gate (SEQUENTIAL — Fable)

- Wire any deferred seams; `pnpm verify` exit 0; **full** Playwright green (kill strays + free 7968/5173 first). Live walk: (1) Layout control List/Board active + Calendar "Soon"; per-view persistence across reload. (2) Project board mirrors list slicing exactly (same tasks, same order) with live counts. (3) Add task into a section column → correct `section_id` via API. (4) Drag Copilot→API persists after reload; within-column reorder persists. (5) Add-section tile → new column; rename + delete-with-confirm propagate (list view agrees). (6) Today board: Overdue/Today columns, suppression, Reschedule clears Overdue. (7) Upcoming board: day columns; cross-day drag reschedules keeping time. (8) groupBy priority board: cross-column drop changes priority. (9) `layout:'list'` views byte-identical (no regressions; suites prove it). (10) Old stored viewPrefs (no `layout` key) load fine. Never weaken a test.

## Review shards (Fable, sequential)
- **r1 board parity/visual/a11y (Playwright/axe):** §Reference fidelity — column chrome (name+count+⋯/Reschedule placement), card anatomy + hover ⋯ + meta chips + suppression, add-task/add-section tiles, full-bleed horizontal scroll with internal column scroll, radii 10/5 + focus ring + accent (no hardcoded reds), dark mode, completed treatment, empty states; axe zero serious/critical; keyboard: focus card → Enter opens detail, keyboard drag moves a card.
- **r2 data/dnd/regression (API-level):** every cross-column drop writes exactly the frozen mutation (section_id/due/priority/label) and order fields match the list's after equivalent drags; disabled-drop cells truly inert; reschedule action's PATCHes; `layout` pref persists per-view and old settings rows parse; list views regression-free (targeted existing specs pass); SSE section events reflected on the board live.

Then fixer (if findings) → final gate (`pnpm verify` + full Playwright + hygiene).

## Self-Review (done)
- Scope honest: server + sections + grouping + mutations all pre-exist; this pass is renderer + pref + dnd wiring — three sequential builders is right-sized, disjoint-by-order (C extends B's files, D polishes).
- Parity decisions recorded: accent not Todoist-red; our header not Todoist breadcrumbs; "(No section)" hidden when empty; no add-tile on Overdue; whole-card drag on boards (6-dot stays list-only); Calendar remains gated.
- Risk ledger: (a) dnd e2e flakiness — D mandates deterministic patterns, not the flaky mouse-drag copy; (b) `prefsAreDefault`/badge semantics — frozen by A before builders; (c) label/filter view shells' exact location unknown to the planner — A locates them; if a view can't cleanly host BoardView, A may descope it to a follow-up WITH a written reason in notes (default remains: all six views).
