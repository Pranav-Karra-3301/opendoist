<p align="center">
  <img src="assets/brand/icon-green.svg" alt="OpenDoist" width="96" height="96">
</p>

<h1 align="center">OpenDoist</h1>

<p align="center"><strong>Self-hosted, single-user, keyboard-first task manager — a Todoist-compatible open alternative.</strong></p>

---

> [!WARNING]
> **Pre-alpha.** OpenDoist is mid-build (phases 1–2 of 10: monorepo foundation + core engines). There is no server, no UI, and no published release yet — nothing here is usable as a task manager. Watch the repo if you're curious.

## Features

Checked items exist (tested, in `main`); unchecked items are planned and specified in the [design spec](docs/superpowers/specs/2026-07-15-opendoist-design.md).

- [x] **Monorepo foundation** — pnpm workspaces + catalog, TypeScript strict, Biome, Vitest, CI
- [x] **Design tokens** — Todoist-derived theme system: 8 themes (Kale default) + auto-dark, 5px/10px radii, priority colors, 20-color project palette, always-blue focus ring
- [x] **Quick Add parser** (`@opendoist/core`) — full Todoist grammar: natural-language dates (`tom 4pm`, `mid january`, bare `6pm` → today-or-tomorrow), `#project` `/section` `@label` `p1`–`p4`, `{deadline}`, `!reminders`, `for 45min` duration, plus extensions: `// description`, leading `* ` uncompletable
- [x] **Recurrence engine** — `every` / `every!` (advance from schedule vs completion), workdays, ordinals (`every 3rd friday`, `every last day`), day/date lists, `starting` / `until` / `for` bounds; DST-safe and property-tested
- [x] **Filter-query engine** — Todoist filter language: `& | ! () ,` panes, date/deadline/created operators, `p1`–`p4`, `@label*` wildcards, `#Project` / `##Project` (with descendants) / `/Section`, `search:`, `subtask`, `view all`
- [ ] **Tasks, projects, sections, labels** — subtasks, priorities (1 = highest), durations, deadlines, markdown content, comments with attachments, soft delete
- [ ] **REST API + CLI** — Hono, every route zod-typed → OpenAPI + Scalar docs, cursor pagination, SSE live updates, API tokens; `opendoist add "…"` CLI with the identical parser
- [ ] **Views** — Inbox · Today (overdue + reschedule) · Upcoming (week strip, drag between days) · Project / Label / Filter (comma = multiple panes), per-view group/sort/filter
- [ ] **Keyboard-first** — full Todoist web shortcut map, `?` overlay, ⌘K command palette, 10 s undo toasts
- [ ] **Search** — SQLite FTS5 across content, descriptions, comments
- [ ] **Reminders** — Web Push (PWA, desktop + mobile), ntfy / Gotify / webhook channels, automatic offsets, recurring reminders
- [ ] **iCal feed** — read-only tasks calendar for Google/Apple Calendar via tokenized `webcal://` URL
- [ ] **Ramble** — voice capture → pluggable STT (OpenAI-compatible / Deepgram / ElevenLabs / self-hosted Whisper) → optional LLM task extraction → review & confirm
- [ ] **Auth** — password + TOTP 2FA, generic OIDC SSO, scoped API tokens; registration auto-locks after first user
- [ ] **Data ownership** — Todoist importer (backup ZIP or live API), full JSON + per-project CSV export, nightly backups with retention + one-click restore
- [ ] **Productivity** — daily/weekly goals, streaks, vacation mode, karma, activity feed, unlimited history

**Non-goals (v1):** collaboration/sharing, board & calendar layouts, CalDAV, native mobile apps (the PWA is the mobile story), localization.

## Quick start (planned)

Once the first release ships, OpenDoist will be one container writing to one volume:

```sh
docker run -d -p 7968:7968 -v ./data:/data ghcr.io/pranav-karra-3301/opendoist
```

Then open `http://localhost:7968` and create your account. Not published yet — see the status banner above.

## Development

Requires Node ≥ 22 and pnpm 10.

```sh
git clone https://github.com/pranav-karra-3301/opendoist.git
cd opendoist
pnpm install
pnpm verify   # lint + typecheck + test + build, everything CI runs
```

Handy during development:

```sh
pnpm --filter @opendoist/core test   # core engine test suites (golden tables + property tests)
pnpm --filter @opendoist/web dev     # design-token showcase (Vite)
pnpm lint:fix                        # Biome, auto-fix
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for commit conventions and the design-token rules.

## Stack

| Layer | Choices |
|---|---|
| Runtime | Node.js ≥ 22 · single Docker container · SQLite on one `/data` volume |
| Monorepo | pnpm workspaces + catalog · TypeScript (strict) · Biome 2 · Vitest 4 + fast-check |
| Core (`packages/core`) | zod 4 · chrono-node · date-fns 4 + `@date-fns/tz` · temporal-polyfill + rrule-temporal — pure, zero-IO, shared by web/server/CLI |
| Server (phase 3) | Hono 4 + `@hono/zod-openapi` · Drizzle + better-sqlite3 · better-auth · croner · web-push |
| Web (phase 4) | Vite 8 · React 19 · Tailwind 4 · TanStack Query 5 · shadcn/ui on Base UI · dnd-kit · cmdk |
| CLI (phase 8) | commander · tsdown · published to npm |
| Releases | Conventional commits · git-cliff changelog · GHCR images (amd64 + arm64) |

## License

[AGPL-3.0](LICENSE) © Pranav Karra.

Brand icon derived from ["List" by Glyphy](https://thenounproject.com/browse/icons/term/list/) (Noun Project), licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) — details in [assets/brand/ATTRIBUTION.md](assets/brand/ATTRIBUTION.md).
