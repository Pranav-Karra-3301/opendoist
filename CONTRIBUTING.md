# Contributing to OpenTask

Thanks for helping build OpenTask. This is a solo-maintained project with a written spec; small focused PRs that follow the conventions below merge fastest.

## Development setup

Requires **Node ≥ 22** (`nvm use` picks it up from `.nvmrc`) and **pnpm 10** (`corepack enable`).

```sh
pnpm install
pnpm verify   # lint + typecheck + test + build — the exact gate CI runs
```

Individual steps and per-package commands:

```sh
pnpm lint          # Biome check (pnpm lint:fix to auto-fix)
pnpm typecheck     # tsc --noEmit across all packages
pnpm test          # Vitest across all packages
pnpm --filter @opentask/core test   # core only: golden tables + property tests
pnpm --filter @opentask/web dev     # token showcase on Vite dev server
```

House rules that CI enforces:

- TypeScript `strict`, no `any` (Biome `noExplicitAny` is an error), `verbatimModuleSyntax`.
- Formatting is Biome: 2-space indent, single quotes, semicolons as-needed, 100-col lines. Run `pnpm lint:fix` before pushing.
- `packages/core` stays **pure and zero-IO** — no framework imports, no `Date` in public APIs (ISO `YYYY-MM-DD` / `HH:mm` / UTC-instant strings only), priorities stored `1 = highest … 4 = default`, ISO weekdays `1 = Mon … 7 = Sun`.
- Tests are colocated (`src/**/*.test.ts`); every public function has tests. Grammar work extends the golden tables — every syntax row in the research dossier is a fixture.

## Commits & pull requests

- **Conventional commits**, enforced on PR titles in CI (`amannn/action-semantic-pull-request`). Allowed types mirror `cliff.toml`: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `chore`, `ci`, `build`. Scope is encouraged: `feat(core): …`.
- **Squash merge only.** The PR title becomes the single commit on `main`, and [git-cliff](https://git-cliff.org) turns those commits into `CHANGELOG.md` (Keep-a-Changelog headings) — so write PR titles as changelog entries.
- Keep `pnpm verify` green; PRs that fail CI don't get reviewed.

## Tokens are law

All UI is built from the design tokens in `apps/web/src/styles/tokens.css`. No hard-coded colors, radii, shadows, or timing functions in components — if a value isn't a token, it doesn't ship. Radii are **5px and 10px only**; the focus ring is **always blue** (`#1f60c2`), in every theme.

The component rules below are copied verbatim from the research dossier (§2.9, `docs/superpowers/research/2026-07-15-opentask-research.md`) and are the binding contract for component PRs. **Any deviation must edit this table in the same PR** — silent divergence from the cheatsheet is a bug, not a judgment call.

| Component | Rules |
|---|---|
| **Button** | h 32 (sm 28 / lg 36); px 12 (8/16); `text-copy` 13px, weight 600; `radius-sm` 5px; primary = `bg-accent text-on-accent hover:bg-accent-hover disabled:bg-accent-disabled`; secondary = `#f5f5f5`→`#e5e5e5` (dark `#292929`→`#3d3d3d`); transition colors 300ms `ease-standard` |
| **Input** | h 32; radius 5px; 1px `input-border`, focus → `input-border-focus` (no accent border); error border `danger`; placeholder `text-tertiary` |
| **Task row** | min-h 42px; pad `8px 38px 8px 5px`; radius 5px; checkbox col 24px, gap 6px; name 14px `text-primary` (completed: line-through `text-tertiary`), description 13px `text-secondary` 1-line clamp, meta 12px `text-tertiary`; 1px `border-subtle` divider; hover reveals actions only; focus: bg `#fafafa` + inset 1px ring `--ot-row-focus-ring` |
| **Checkbox** | 18px circle in 24px hit area; P1–P3: 2px border in `--color-pN` + same color fill at 10% (20% hover) + hover check glyph preview in priority color; P4: 1px `p4` border, no fill; checked: solid `pN` fill, white 24-grid check; animate 250ms linear scale+fade |
| **Priority flag** | filled flag icon in `--color-pN`; P4 = outline flag, `text-tertiary` |
| **Sidebar** | w 280 (210–420 resizable); bg `surface`; item h ~32 (p 5px, radius 5px, text 14/17); hover `sidebar-hover`; active `selected` + `selected-text` + icon in accent; counts 12px `text-tertiary`; slide 300ms `ease-standard` |
| **Dropdown/menu** | bg `surface-raised`; radius 10px; `shadow-menu` + 1px border (`rgba(0,0,0,.1)` light / `border` dark); item h 32, radius 5px, hover `hover` |
| **Dialog / quick-add** | radius 10px; `shadow-dialog`; dark adds 1px `#383838` border; quick-add width ≤ 560px, top-aligned |
| **Tooltip/toast** | bg `surface-overlay`, white text, radius 5px (toast 10px), `shadow-toast`, z 1000/400 |
| **Focus ring** | `outline: 2px solid var(--color-focus-ring); outline-offset: 2px` (+ optional outer glow `focus-ring-outer`); always blue, all themes; `:focus-visible` only |
| **Icons** | Lucide: 24×24 grid, `stroke: currentColor`, default `stroke-width: 2`, round caps/joins ([defaults](https://github.com/lucide-icons/lucide/blob/main/packages/lucide-react/src/defaultAttributes.ts)). Sizes: 16 inline/meta, 18 row actions, 20 toolbar, 24 sidebar/nav — where "sidebar/nav" means icon-only nav rails; the sidebar's 32px *text* rows use 20 (recorded deviation, phase-4 plan Task D). Use `strokeWidth={1.75}` at 20–24 to match Todoist's lighter line, 2 at 16–18 (or `absoluteStrokeWidth`). Icon color `text-secondary`, hover `text-primary`; never accent except active nav |
| **Labels/projects** | color dot 12px circle in `--color-palette-*`; label chip text 12px in palette color; palette tokens auto-brighten in dark |
| **Dates** | today/tomorrow/weekend/next-week/overdue tokens; 12px + 16px icon |
| **Motion** | hover fades 150ms ease-in; state/color 250–300ms `ease-standard`; checkbox 250ms; respect `prefers-reduced-motion` |

Recorded deviations from Todoist parity (per the rule above — annotated here in the same PR that introduced them):

- `--ot-text-tertiary` is **`#707070`** in light themes, not Todoist's `#999999`: `#999` is 2.7–2.8:1 on white and fails both WCAG AA (≥4.5:1) and the spec's axe gate; `#707070` is the nearest passing gray (see the comment in `tokens.css`). `--ot-p4` stays `#999999`, preserving checkbox/priority-flag parity.
- Sidebar nav icons (Inbox/Today/Upcoming) render at **20px** (stroke 1.75) inside the 32px text rows; the Icons row's "24 sidebar/nav" size applies to icon-only nav rails, which the app does not have yet.

## License

OpenTask is [AGPL-3.0](LICENSE). By contributing you agree to license your work under the same terms.
