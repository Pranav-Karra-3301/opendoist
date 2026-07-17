# Command-line interface

`opendoist` is a standalone CLI for driving your OpenDoist server from the
terminal. It bundles the same Quick Add grammar and filter engine as the web app,
so `opendoist add "…"` parses your text exactly the way the app does — offline,
before it ever hits the network.

- [Install](#install)
- [Log in](#log-in)
- [Commands](#commands)
- [JSON output](#json-output)
- [Configuration](#configuration)
- [Tip: a shorter alias](#tip-a-shorter-alias)

## Install

The CLI is **baked into the OpenDoist Docker image**, so every install already
has it — nothing to download. Run it with `docker exec` against your running
container; the image pre-sets `OPENDOIST_URL` to the bundled server, so a token
(from **Settings → Integrations**) is all it needs. The container is named
`opendoist` if you used the quick start in [install.md](install.md) — substitute
your own container name otherwise:

```sh
docker exec -e OPENDOIST_TOKEN=od_… opendoist opendoist today

# `od` is a built-in short alias inside the image:
docker exec -e OPENDOIST_TOKEN=od_… opendoist od today
```

> **Standalone npm package — not published yet.** `npm install -g opendoist`
> (requires **Node ≥ 22**) is the planned install path, but the package is not
> on npm as of 0.1.0, so that command currently fails with a 404. To use the
> CLI outside the container today, build it from a source checkout:
>
> ```sh
> git clone https://github.com/pranav-karra-3301/opendoist.git && cd opendoist
> pnpm install && pnpm --filter opendoist build
> node packages/cli/dist/index.js --help
> ```

## Log in

The CLI needs a server URL and an API token. There are two ways to provide them.

**1. Save credentials with `login`.** Run:

```sh
opendoist login
```

It prompts for your server URL and an API token — create one in **Settings →
Integrations** (it starts with `od_`) — validates them against the server, and
saves them to a config file with `0600` permissions. You can also pass them
directly:

```sh
opendoist login --url https://todo.example.com --token od_…
```

**2. Use environment variables.** Set `OPENDOIST_URL` and `OPENDOIST_TOKEN`;
these **take precedence** over the saved config and are ideal for CI, containers,
or one-off sessions:

```sh
export OPENDOIST_URL=https://todo.example.com
export OPENDOIST_TOKEN=od_…
```

Then `opendoist whoami` confirms the account, server, and where the credentials
came from. `opendoist logout` removes the saved config file.

## Commands

| Command | What it does |
| --- | --- |
| `add <text…>` | Add a task with the Quick Add grammar (`p1`, `#Project`, `/Section`, `@label`, dates, recurrence). |
| `list [query]` | List open tasks grouped by project — or, given a filter query, just the matches (e.g. `opendoist list "@errands & p1"`). |
| `today` | Tasks that are overdue or due today. |
| `upcoming` | Tasks due within the next N days, grouped by day. `--days <n>` (default `7`, range 1-30). |
| `done <task>` | Complete a task, by id or a fuzzy content match. |
| `reopen <task>` | Reopen a completed task. |
| `rm <task>` | Delete a task. |
| `projects` | List projects in tree order. `projects add <name>` creates one (`--color`, `--parent`). |
| `sections` | List sections. `--project <ref>` scopes the list; `sections add <name>` creates one. |
| `labels` | List labels. `labels add <name>` creates one (`--color`). |
| `filters` | List saved filters. `filters add <name> <query>` creates one (`--color`). |
| `search <query…>` | Full-text search across tasks and comments. `-n, --limit <n>` (default `30`). |
| `open [target]` | Open the app in your browser — `inbox`, `today`, `upcoming`, or a task id/text; no target opens the home view. |
| `login` · `logout` · `whoami` | Manage credentials (see [above](#log-in)). |

A few conventions:

- **Fuzzy references.** `done`, `reopen`, `rm`, and `open` accept either a task id
  or a substring of the task's content. An ambiguous substring lists the matching
  ids so you can rerun with the exact one.
- **Confirmations.** `done`, `reopen`, and `rm` ask before acting on a fuzzy
  match (and `rm` always asks); pass `-y` / `--yes` to skip the prompt.
- **Version.** `opendoist --version` (or `-V`) prints the CLI version.

Run `opendoist <command> --help` for the full options of any command.

## JSON output

Every read command accepts the global `--json` flag for stable,
machine-readable output you can pipe into [`jq`](https://jqlang.github.io/jq/):

```sh
# titles of everything due today, highest priority first
opendoist today --json | jq -r 'sort_by(.priority)[] | "p\(.priority)  \(.content)"'
```

Exit codes are stable, too, so scripts can branch on them:

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Error (bad input, not found, server error) |
| `2` | Authentication problem (missing/invalid token) |

## Configuration

- **Config file.** `opendoist login` writes `{ url, token }` to a per-user config
  file with `0600` permissions. Its location follows OS conventions:

  | OS | Path |
  | --- | --- |
  | Linux | `~/.config/opendoist/config.json` |
  | macOS | `~/Library/Preferences/opendoist/config.json` |
  | Windows | `%APPDATA%\opendoist\Config\config.json` |

  Override the location with `OPENDOIST_CONFIG_PATH`.
- **Environment variables.** `OPENDOIST_URL` and `OPENDOIST_TOKEN` override the
  config file (precedence: **env > config**) — handy for CI, containers, and
  throwaway shells.

The token you use here is an ordinary OpenDoist API token; its `read` /
`read_write` scope applies exactly as described in the [API reference](api.md), so
a `read`-scoped token can run `list`/`today`/`search` but not `add`/`done`/`rm`.

## Tip: a shorter alias

```sh
alias od=opendoist
```

Now `od today`, `od add "Buy milk #Home"`, and the rest just work. (Inside the
Docker image, `od` already exists as a built-in symlink.)

---

**Related:** [API reference](api.md) · [Import from Todoist](import-todoist.md) ·
[Configuration](configuration.md) · [back to the docs index](README.md)
