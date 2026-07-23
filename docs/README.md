# OpenTask Documentation

OpenTask is a self-hosted, single-user, keyboard-first task manager — an open,
Todoist-compatible alternative you run in one Docker container against a single
`/data` volume. These pages cover installing and configuring your instance,
importing from Todoist, capturing tasks by voice, backups and restore, and the
REST API + command-line client.

New here? Start with [Install & first run](install.md), then skim
[Configuration](configuration.md).

## Pages

| Page | What's inside |
|---|---|
| [Install & first run](install.md) | Docker one-liner, Compose, running from source, first-account walkthrough, reverse proxy, updating, uninstall. |
| [Configuration](configuration.md) | Every `OPENTASK_*` environment variable, its default, and what it does. |
| [Import from Todoist](import-todoist.md) | Move projects, tasks, labels and comments over — via backup ZIP or a live API token — and the priority-inversion mapping. |
| [Ramble — voice capture](voice-ramble.md) | Hold-to-record voice notes turned into tasks: STT/LLM providers and the self-hosted sidecar recipe. |
| [Backups & restore](backups.md) | Nightly `VACUUM INTO` snapshots, retention, the restore flow, and optional off-host replication. |
| [REST API](api.md) | Bearer-token auth, the interactive Scalar docs, pagination and error shapes, plus the SSE and iCal feeds. |
| [Command-line client](cli.md) | Installing `opentask`, logging in, the command table, and `--json` output for scripting. |
| [FAQ](faq.md) | Data location, iPhone push, priority numbering, HTTPS, reopening registration, and what is out of scope. |

## At a glance

- One container, one `/data` volume, port **7968**.
- Image: `ghcr.io/pranav-karra-3301/opentask` (tags `latest`, `X.Y`, `X.Y.Z`, `nightly`).
- Priorities are stored **1 = highest (p1) … 4 = default (p4)** — the inverse of
  Todoist's REST API, which the importer maps for you.
- Every configuration value is an optional `OPENTASK_*` environment variable;
  secrets in `/data/secrets.json` are auto-generated on first boot and are never
  supplied as environment variables.

## Not in scope for v1

OpenTask deliberately does **not** ship: sharing / assignees / teams · board &
calendar layouts · CalDAV · Google Calendar two-way sync · location reminders ·
an email reminder channel (the channel interface exists; SMTP comes later) ·
native mobile apps (the installable PWA is the mobile story) · localization (the
UI and the Quick Add parser are English at launch). See the
[FAQ](faq.md#whats-explicitly-out-of-scope) for details.
