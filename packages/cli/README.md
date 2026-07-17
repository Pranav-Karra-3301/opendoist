# opendoist

Command-line client for [OpenDoist](https://github.com/pranav-karra-3301/opendoist) — the self-hosted, keyboard-first task manager. It speaks the same Quick Add grammar and filter language as the web app and evaluates them with the same bundled parser, so what you type in the terminal behaves exactly like what you type in the browser.

```
opendoist add "Submit report tom 4pm p1 #Work @email"
✓ added  tsk_7Hq2  Submit report
  parsed: p1 · due Jul 16 4:00pm · #Work · @email
```

## Install

```sh
npm install -g opendoist
```

Requires **Node ≥ 22**. The published package is a single self-contained bundle — no runtime dependencies to install.

Most people alias it to `od`:

```sh
alias od=opendoist   # add to ~/.bashrc, ~/.zshrc, etc.
```

## Quickstart

Point the CLI at your server and save a token (both are stored locally, `chmod 600`):

```sh
opendoist login
# Server URL (e.g. https://todo.example.com): todo.example.com
# API token (Settings → Integrations, starts with od_): od_xxxxxxxxxxxx
✓ logged in to https://todo.example.com as you@example.com — OpenDoist v0.1.0
config: ~/.config/opendoist/config.json (0600)
```

Create the token in the web app under **Settings → Integrations** (it starts with `od_`). Then start adding tasks:

```sh
opendoist add "Submit report tom 4pm p1 #Work @email"
opendoist today
opendoist done "submit report"
```

`opendoist login` accepts `--url` and `--token` flags if you would rather not be prompted (handy for scripts and provisioning).

## Commands

Every command accepts the global `--json` flag (see [Scripting](#scripting)), plus `-V, --version` and `-h, --help`.

| Command | What it does | Example |
|---|---|---|
| `login [--url <url>] [--token <token>]` | Save server URL + API token | `opendoist login` |
| `logout` | Remove the saved credentials | `opendoist logout` |
| `whoami` | Show the current user, server, and credential source | `opendoist whoami` |
| `add <text...>` | Add a task using the full Quick Add grammar | `opendoist add "Pay rent {aug 1} p2"` |
| `list [query]` | List tasks — grouped by project, or filtered by a query | `opendoist list "p1 & #Work"` |
| `today` | Tasks due today, with overdue tasks first | `opendoist today` |
| `upcoming [--days <n>]` | Upcoming tasks grouped by day (n = 1–30, default 7) | `opendoist upcoming --days 14` |
| `done <task> [-y, --yes]` | Complete a task by id or fuzzy content match | `opendoist done "submit report"` |
| `reopen <task> [-y, --yes]` | Reopen a completed task | `opendoist reopen tsk_7Hq2` |
| `rm <task> [-y, --yes]` | Delete a task (always confirms unless `--yes`) | `opendoist rm tsk_7Hq2 --yes` |
| `projects` | List projects (tree order, Inbox first) | `opendoist projects` |
| `projects add <name> [--color <c>] [--parent <ref>]` | Create a project | `opendoist projects add Work --color green` |
| `sections [--project <ref>]` | List sections, optionally within one project | `opendoist sections --project Work` |
| `sections add <name> --project <ref>` | Create a section (project required) | `opendoist sections add Admin --project Work` |
| `labels` | List labels | `opendoist labels` |
| `labels add <name> [--color <c>]` | Create a label | `opendoist labels add errands --color yellow` |
| `filters` | List saved filters (`★` marks favorites) | `opendoist filters` |
| `filters add <name> <query> [--color <c>]` | Create a saved filter (query is validated first) | `opendoist filters add Urgent "(p1 \| p2) & 14 days"` |
| `search <query...> [-n, --limit <n>]` | Full-text search across tasks (default limit 30) | `opendoist search meeting notes` |
| `open [target]` | Open the web app, a view, or a task in your browser | `opendoist open today` |

`done`, `reopen`, and `rm` accept either a task id (`tsk_…`) or a case-insensitive substring of the task's content. A fuzzy match asks for confirmation before mutating; an ambiguous match lists the candidates so you can pass the id. `open [target]` understands `inbox`, `today`, `upcoming`, a task id, or a fuzzy task reference — with no target it opens the app root.

## Filters

`list [query]` and `filters add` use OpenDoist's filter language — identical to the web app's. A few examples:

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
| Linux | `~/.config/opendoist/config.json` |
| macOS | `~/Library/Preferences/opendoist/config.json` |
| Windows | `%APPDATA%\opendoist\Config\config.json` |

Environment variables override the file (useful in CI, containers, and shared machines):

| Variable | Effect |
|---|---|
| `OPENDOIST_URL` | Server URL — **beats** the saved config |
| `OPENDOIST_TOKEN` | API token — **beats** the saved config |
| `OPENDOIST_CONFIG_PATH` | Use a config file at a custom path |
| `NO_COLOR` | Disable ANSI colors |
| `FORCE_COLOR` | Force colors even when stdout is not a TTY |

`whoami` reports which source is in effect (`env`, `config`, or `mixed`). When `OPENDOIST_URL` and `OPENDOIST_TOKEN` are both set you don't need to `login` at all.

## Scripting

Pass `--json` to any command for stable, machine-readable output on stdout. Human tables never appear in JSON mode, and prompts/errors go to stderr, so the stdout stream is always clean to pipe.

```sh
opendoist today --json | jq '.[].content'
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

The CLI is baked into the OpenDoist server image (as both `opendoist` and `od`), so you can drive your instance without installing anything on the host:

```sh
docker exec -e OPENDOIST_TOKEN=od_xxxxxxxxxxxx <container> opendoist today
```

Inside the container `OPENDOIST_URL` already defaults to the local server (`http://127.0.0.1:7968`), so you only need to supply a token.

## Priorities

OpenDoist stores priorities as **`p1` = highest … `p4` = default (no priority)**. Todoist's REST API inverts this (its `priority: 4` is the urgent one) — OpenDoist does **not**. What you see is what you type: `p1` is the most urgent, everywhere.

## License

[AGPL-3.0-only](https://github.com/pranav-karra-3301/opendoist/blob/main/LICENSE). Source, issues, and docs: <https://github.com/pranav-karra-3301/opendoist>.
