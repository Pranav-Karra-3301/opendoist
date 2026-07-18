# Quick Add UX Pass — Implementation Plan

> **For agentic workers:** Task A is SEQUENTIAL and freezes contracts; Tasks B–F are parallel with disjoint file sets; Task G is the integration gate. Implementation agents run as Opus; integration/review as Fable. Builders: never `pnpm install`, never git commands, OS-temp artifacts only, unique ports + temp `OPENDOIST_DATA_DIR` for live checks.

**Goal:** Owner-feedback UX pass on Quick Add: (1) dialog always opens top-center; (2) sigil autocomplete anchors at the caret, never a screen corner; (3) scheduler gains a real month calendar alongside Today/Tomorrow/Next week; (4) **deadlines support natural-language date + optional TIME inside `{…}`** end-to-end (deliberate divergence from Todoist's date-only, owner decision 2026-07-18); (5) the Deadline/Reminders/Duration chips become real pickers that teach the syntax instead of dumping `{}`/`!` into the input.

**Architecture:** Text stays the single source of truth — pickers compose/replace token spans in the input (chips already render from `parseQuickAdd` output). New shared pieces: a caret/anchor-aware popover positioning util and a `MonthCalendar` component (reused by scheduler + deadline picker). Core parser + server schema extend deadline with `time`.

**Reference:** spec `docs/superpowers/specs/2026-07-15-opendoist-design.md` (§2.2–2.3), dossier §2.9 component law. Task A records exact as-built shapes before freezing.

## Global Constraints

- Priorities 1=highest; radii 5/10px; focus ring `#1f60c2`; Biome formatting; TS strict no-`any`; tests colocated.
- Deadline-with-time semantics: `{next friday 5pm}` → `deadline: { date, time }`; `{march 30}` → `{ date, time: null }`. A brace phrase containing a time is NO LONGER an error. Deadline time does NOT create reminders and does NOT affect Today/Upcoming placement (deadline never does). Filters (`deadline:` operators) stay date-granular. Old inputs/goldens with date-only braces keep passing unchanged.
- Backward compat: server DTO extends the existing deadline shape additively (Task A pins the exact as-built field names; importer/CLI/ics untouched except where they render deadlines — display gains optional time).
- The Quick Add dialog position and all popovers must satisfy dossier §2.9 (10px dialog radius, shadow-dialog; menus 10px + shadow-menu) and remain within the viewport (flip/clamp).

---

### Task A: Contracts + schema/migration + stubs (SEQUENTIAL — Fable)

**Files:** Create `apps/web/src/components/ui/anchored.ts` (positioning util, full impl), `apps/web/src/components/ui/month-calendar.tsx` (contract stub), `apps/server/drizzle/0006_deadline_time.sql` (via drizzle-kit generate); Modify `packages/core/src/types.ts` (deadline shape), `apps/server/src/db/schema.ts`, `apps/server/src/api/schemas.ts` (+ the task DTO mappers), spec §2.2/§2.3 (record the divergence).

- [ ] **Step 1 — as-built recon (record in notes for all builders):** exact current deadline field names in core `ParsedQuickAddSchema`, server `tasks` table, task DTO, web chip renderers, CLI table renderer; the quick-add dialog's current positioning classes; how `caretCoords` is computed in `autocomplete.tsx` and where the menu is rendered (portal target + coordinate space — the corner bug's root cause); SchedulerPanel's preset structure.
- [ ] **Step 2 — core contract:** `ParsedQuickAddSchema.deadline` becomes `z.object({ date: IsoDateSchema, time: HmTimeSchema.nullable() }).nullable()`. Keep parser stub behavior compiling (Task B implements). Update the schema test.
- [ ] **Step 3 — server schema:** add `deadlineTime` (`deadline_time` TEXT null) to `tasks`; generate migration 0006; extend DTO deadline object with `time` (additive, snake_case); mappers pass it through; existing server tests stay green (time null everywhere until B/C land).
- [ ] **Step 4 — `anchored.ts` (full impl, frozen):** `export function anchorRect(el: HTMLElement, caret?: {top,left,height}): DOMRect`-style helper + `export function placePopover(anchor: DOMRect, popover: {width,height}, opts?): {top,left}` — viewport-space, flips above when within 240px of the bottom, clamps horizontally with 8px gutters. Unit tests with synthetic rects.
- [ ] **Step 5 — `month-calendar.tsx` stub (frozen props):** `export function MonthCalendar({ value, onPick, weekStart, min }: { value: string | null; onPick: (date: string) => void; weekStart: Weekday; min?: string })` rendering a placeholder grid (Task E replaces wholesale).
- [ ] **Step 6 — spec edit:** §2.2 deadline: date + optional time, owner decision + date; §2.3 grammar row `{natural date, optionally with time}`. Gates: `pnpm typecheck` + `pnpm --filter @opendoist/server test` + core schema tests green.

### Task B: Core parser — deadline time (Opus)

**Files:** `packages/core/src/quick-add/parse.ts` (+tokens.ts if needed), `packages/core/src/quick-add/golden.test.ts` (extend).
- Braces resolve via `resolveNaturalDate` keeping time: `{next friday 5pm}`, `{aug 1 09:00}`, `{tomorrow}`. A brace phrase that fails to resolve stays literal text + masked (unchanged). Update the "time inside braces is an error" behavior + its tests to the new contract. ≥8 new golden rows (date-only, timed, 12h/24h, unresolvable). All existing goldens unchanged and green. Gates: core suite + typecheck + lint scoped.

### Task C: Server + clients render deadline time (Opus)

**Files:** `apps/server/src/api/routes/tasks*.ts` quick/create/patch accept+persist deadline time (from parser output and structured body), `apps/server/src/api/routes/*.test.ts` (extend), `apps/web/src/components/task/task-meta.tsx` + chip value renderers (display `Aug 1, 5:00 PM` when time present), `packages/cli` deadline column render.
- E2E-style test: POST /tasks/quick `{"text":"ship it {friday 5pm}"}` → stored+returned `deadline.date` + `deadline.time`; PATCH round-trip; date-only unchanged. Gates: server suite, affected web/cli unit tests.

### Task D: Dialog position + caret-anchored autocomplete (Opus)

**Files:** `apps/web/src/components/quick-add/quick-add-dialog.tsx`, `apps/web/src/components/quick-add/autocomplete.tsx` (menu rendering half only — the hook API is frozen), `apps/web/e2e/quickadd-position.spec.ts` (new).
- Dialog: fixed, horizontally centered, top at ~18vh (clamp min 48px), width ≤560px, same geometry from every entry point (global Q, view-scoped a/A, palette command). Uses existing dialog primitives; no layout jumping when chips wrap.
- Autocomplete: root-cause the corner bug per Task A's recon; position the menu with `anchored.ts` from the caret rect in viewport space; flips above near the bottom; follows caret while typing; stays correct when the dialog scrolls. e2e: bounding-box distance between caret span and menu < 48px; menu fully in viewport at extreme input lengths.

### Task E: MonthCalendar + scheduler upgrade (Opus)

**Files:** `apps/web/src/components/ui/month-calendar.tssx` — replace stub wholesale (`month-calendar.tsx`), `apps/web/src/components/task/scheduler-popover.tsx`, `apps/web/e2e/scheduler-calendar.spec.ts` (new).
- MonthCalendar per frozen props: month header + prev/next/today controls, weekday header honoring `weekStart`, 6-row grid, today ring, selected fill (accent), `min` disabling, full keyboard support (arrows/PgUp/PgDn/Enter), roving tabindex, aria-grid semantics. Uses core `dates.ts` helpers only (no new date deps).
- SchedulerPanel: keep presets (Today/Tomorrow/Next week/Next weekend/No date) + free-text; embed MonthCalendar below; picking a day preserves an existing time from the current due; free-text preview unchanged. e2e: open scheduler, page to next month, pick a date, chip reflects it; keyboard-only pick works.

### Task F: Chip pickers — Deadline, Reminders, Duration (Opus)

**Files:** `apps/web/src/components/quick-add/chip-row.tsx` (chip action wiring only), new `apps/web/src/components/quick-add/pickers/{deadline-picker,reminder-picker,duration-menu}.tsx`, `apps/web/e2e/quickadd-pickers.spec.ts` (new).
- Shared behavior: pickers open anchored to their chip (`anchored.ts`), compose/replace the corresponding token span in the input text (text stays source of truth; reuse the existing detokenize/span machinery from Task A recon), close on pick/Esc, never steal the input's undo history.
- **DeadlinePicker:** MonthCalendar + optional time field + NL row ("or type a phrase — `{next friday 5pm}` in the task works too") → writes `{…}`. Shows current deadline with clear-button.
- **ReminderPicker:** current reminders list with remove; presets At due time / 10 / 30 / 60 min before (disabled with hint "needs a due time" when untimed); absolute date (MonthCalendar) + time; footer teaches `!30 min before` / `!tomorrow 9am`. Writes `!…` tokens.
- **DurationMenu:** 15m/30m/45m/1h/2h/custom minutes → inserts/replaces `for X` after the timed due; disabled with hint when no timed due. Footer teaches `for 45min`.
- One-line syntax hint (text-tertiary caption) under the input while focused: `# project · @ label · p1–p4 · {deadline} · !reminder · for 45min`. e2e: each picker opens anchored to its chip, a pick round-trips into parsed state, disabled states render hints.

### Task G: Integration gate (SEQUENTIAL — Fable)

- `pnpm verify` + full Playwright (incl. the 3 new specs) green; live walk: quick-add from 3 entry points lands top-center; `#`/`@` menus hug the caret; calendar pick + `{friday 5pm}` deadline + `!30 min before` + duration menu → task created with all fields verified via API; old-style `{aug 1}` unchanged. Fix seams minimally; never weaken tests.

## Review shards (Fable, sequential)
- **r1 UX-geometry (Playwright):** dialog rect top-centered from every entry point at 1280×800 and 900×600; autocomplete-to-caret distance; popovers clamped in-viewport near edges; calendar keyboard operation; a11y roles on the new grid/pickers (axe on the open dialog).
- **r2 deadline-time correctness:** parse→store→DTO→render round-trip for timed + date-only + unresolvable braces; PATCH/quick parity; filters `deadline:` still date-granular; importer/CLI/ics untouched paths still green; migration applies on a seeded pre-0006 DB.

Then fixer (if findings) → final gate (`pnpm verify` + e2e + hygiene).

## Self-Review (done)
- All six feedback items map: dialog position (D), caret popups (D), calendar+presets (E), deadline understandable + date-and-time (A/B/C/F), reminder discoverability (F), duration intuitiveness (F, kept text-first per owner's "typing makes sense").
- Text-as-source-of-truth preserved; MonthCalendar stub in A resolves the E↔F parallel dependency; deadline change is additive on the wire; spec updated in-plan.
