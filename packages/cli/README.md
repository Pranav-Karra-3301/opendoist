# opentask

Command-line client for [OpenTask](https://github.com/pranav-karra-3301/opentask) — the self-hosted, keyboard-first task manager. It speaks the same Quick Add grammar and filter language as the web app and evaluates them with the same bundled parser, so what you type in the terminal behaves exactly like what you type in the browser.

```
opentask add "Submit report tom 4pm p1 #Work @email"
✓ added  tsk_7Hq2  Submit report
  parsed: p1 · due Jul 16 4:00pm · #Work · @email
```

## Install

```sh
npm install -g opentask
```

Requires **Node ≥ 22**. The published package is a single self-contained bundle — no runtime dependencies to install.

> **Not on npm yet as of 0.1.0.** Until the first npm release lands, use the copy bundled in
> the Docker image (see [Docker](#docker) below) or build from the monorepo with
> `pnpm --filter opentask build` and run `node packages/cli/dist/index.js`.

Most people alias it to `od`:

```sh
alias od=opentask   # add to ~/.bashrc, ~/.zshrc, etc.
```

## Quickstart

Point the CLI at your server and save a token (both are stored locally, `chmod 600`):

```sh
opentask login
# Server URL (e.g. https://todo.example.com): todo.example.com
# API token (Settings → Integrations, starts with ot_): ot_xxxxxxxxxxxx
✓ logged in to https://todo.example.com as you@example.com — OpenTask v0.1.0
config: ~/.config/opentask/config.json (0600)
```

Create the token in the web app under **Settings → Integrations** (it starts with `ot_`). Then start adding tasks:

```sh
opentask add "Submit report tom 4pm p1 #Work @email"
opentask today
opentask done "submit report"
```

`opentask login` accepts `--url` and `--token` flags if you would rather not be prompted (handy for scripts and provisioning).

## Commands

Every command accepts the global `--json` flag (see [Scripting](#scripting)), plus `-V, --version` and `-h, --help`.

| Command | What it does | Example |
|---|---|---|
| `login [--url <url>] [--token <token>]` | Save server URL + API token | `opentask login` |
| `logout` | Remove the saved credentials | `opentask logout` |
| `whoami` | Show the current user, server, and credential source | `opentask whoami` |
| `add <text...>` | Add a task using the full Quick Add grammar | `opentask add "Pay rent {aug 1} p2"` |
| `list [query]` | List tasks — grouped by project, or filtered by a query | `opentask list "p1 & #Work"` |
| `today` | Tasks due today, with overdue tasks first | `opentask today` |
| `upcoming [--days <n>]` | Upcoming tasks grouped by day (n = 1–30, default 7) | `opentask upcoming --days 14` |
| `done <task> [-y, --yes]` | Complete a task by id or fuzzy content match | `opentask done "submit report"` |
| `reopen <task> [-y, --yes]` | Reopen a completed task | `opentask reopen tsk_7Hq2` |
| `rm <task> [-y, --yes]` | Delete a task (always confirms unless `--yes`) | `opentask rm tsk_7Hq2 --yes` |
| `projects` | List projects (tree order, Inbox first) | `opentask projects` |
| `projects add <name> [--color <c>] [--parent <ref>]` | Create a project | `opentask projects add Work --color green` |
| `sections [--project <ref>]` | List sections, optionally within one project | `opentask sections --project Work` |
| `sections add <name> --project <ref>` | Create a section (project required) | `opentask sections add Admin --project Work` |
| `labels` | List labels | `opentask labels` |
| `labels add <name> [--color <c>]` | Create a label | `opentask labels add errands --color yellow` |
| `filters` | List saved filters (`★` marks favorites) | `opentask filters` |
| `filters add <name> <query> [--color <c>]` | Create a saved filter (query is validated first) | `opentask filters add Urgent "(p1 \| p2) & 14 days"` |
| `search <query...> [-n, --limit <n>]` | Full-text search across tasks (default limit 30) | `opentask search meeting notes` |
| `open [target]` | Open the web app, a view, or a task in your browser | `opentask open today` |

`done`, `reopen`, and `rm` accept either a task id (`tsk_…`) or a case-insensitive substring of the task's content. A fuzzy match asks for confirmation before mutating; an ambiguous match lists the candidates so you can pass the id. `open [target]` understands `inbox`, `today`, `upcoming`, a task id, or a fuzzy task reference — with no target it opens the app root.

## Filters

`list [query]` and `filters add` use OpenTask's filter language — identical to the web app's. A few examples:

| Query | Matches |
|---|---|
| `today` | Everything due today |
| `overdue \| today` | Overdue **or** due today |
| `(p1 \| p2) & 14 days` | Priority 1 or 2, due within the next 14 days |
| `#Work & no date` | Tasks in the Work project with no due date |
| `@home*` | Any task whose label starts with `home` |

Comma-separated multi-pane filters (e.g. `today, overdue`) are **not** supported by `list` — run each pane as its own command. Saved filters created with `filters add` may contain multiple panes, since the web app renders them as separate columns.

## Configuration

Credentials live in a single JSON file, written with `0600` permissions (owner read/write only):

| OS | Path |
|---|---|
| Linux | `~/.config/opentask/config.json` |
| macOS | `~/Library/Preferences/opentask/config.json` |
| Windows | `%APPDATA%\opentask\Config\config.json` |

Environment variables override the file (useful in CI, containers, and shared machines):

| Variable | Effect |
|---|---|
| `OPENTASK_URL` | Server URL — **beats** the saved config |
| `OPENTASK_TOKEN` | API token — **beats** the saved config |
| `OPENTASK_CONFIG_PATH` | Use a config file at a custom path |
| `NO_COLOR` | Disable ANSI colors |
| `FORCE_COLOR` | Force colors even when stdout is not a TTY |

`whoami` reports which source is in effect (`env`, `config`, or `mixed`). When `OPENTASK_URL` and `OPENTASK_TOKEN` are both set you don't need to `login` at all.

## Scripting

Pass `--json` to any command for stable, machine-readable output on stdout. Human tables never appear in JSON mode, and prompts/errors go to stderr, so the stdout stream is always clean to pipe.

```sh
opentask today --json | jq '.[].content'
```

Success shapes:

| Command | Success JSON |
|---|---|
| `login` | `{ ok, url, version, user, config_path }` |
| `logout` | `{ ok, removed }` |
| `whoami` | `{ url, version, token_source, user }` |
| `add` | the created task object |
| `list` / `today` / `upcoming` | array of task objects (flat, sorted) |
| `done` / `reopen` / `rm` | `{ ok, id, action }` (`done` adds `next_due` for recurring tasks) |
| `projects` / `sections` / `labels` / `filters` | array of the respective objects |
| `projects add` / `sections add` / `labels add` / `filters add` | the created object |
| `search` | array of task objects (sliced to `--limit`) |
| `open` | `{ url }` (and it does **not** launch a browser in `--json` mode) |

On failure, `--json` prints an error envelope to stdout and still sets the exit code:

```json
{ "ok": false, "error": { "code": "api", "message": "…", "status": 404 } }
```

Exit codes are stable:

| Code | Meaning |
|---|---|
| `0` | success |
| `1` | any error — usage, network, API, or an aborted confirmation |
| `2` | authentication — no credentials, `401`, or `403` |

## Docker

The CLI is baked into the OpenTask server image (as both `opentask` and `od`), so you can drive your instance without installing anything on the host:

```sh
docker exec -e OPENTASK_TOKEN=ot_xxxxxxxxxxxx <container> opentask today
```

Inside the container `OPENTASK_URL` already defaults to the local server (`http://127.0.0.1:7968`), so you only need to supply a token.

## Priorities

OpenTask stores priorities as **`p1` = highest … `p4` = default (no priority)**. Todoist's REST API inverts this (its `priority: 4` is the urgent one) — OpenTask does **not**. What you see is what you type: `p1` is the most urgent, everywhere.

## License

[AGPL-3.0-only](https://github.com/pranav-karra-3301/opentask/blob/main/LICENSE). Source, issues, and docs: <https://github.com/pranav-karra-3301/opentask>.
