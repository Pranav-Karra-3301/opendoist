# API

OpenDoist ships a full REST API under `/api/v1` — the same API the web app and the
[CLI](cli.md) use, so anything the app can do, a script can do too.

This page is a **quick orientation**, not the full reference. The complete,
always-up-to-date reference is generated from the server itself:

- **Interactive docs (Scalar):** `/api/v1/docs` — browse and try every endpoint
  in your browser.
- **OpenAPI spec:** `/api/v1/openapi.json` — the machine-readable schema, for code
  generators and tooling.

Both are served by your instance — open `https://<your-host>/api/v1/docs` in a
browser where you're signed in (like the rest of `/api/v1`, they sit behind
authentication).

- [Authentication](#authentication)
- [Conventions](#conventions)
- [Quick start](#quick-start)
- [Live updates (SSE)](#live-updates-sse)
- [Calendar feed (iCal)](#calendar-feed-ical)
- [Health & instance info](#health--instance-info)

## Authentication

Everything under `/api/v1` requires authentication except the public
`GET /api/v1/info` and the `GET /api/health` check. There are two ways to
authenticate:

- **Session cookie** — set when you log in through the web app; this is how the
  browser calls the API.
- **API token** — for scripts and the CLI. Send it as a bearer token:

  ```
  Authorization: Bearer od_…
  ```

  Create tokens in **Settings → Integrations**. Every OpenDoist token starts with
  the `od_` prefix.

**Scopes.** A token is either **`read`** or **`read_write`**:

| Scope | Can call | Cannot call |
| --- | --- | --- |
| `read` | `GET` / `HEAD` | any write — returns `403 insufficient scope` |
| `read_write` | everything | — |

Choose `read` for dashboards and exports; `read_write` for anything that creates,
edits, completes, or deletes.

## Conventions

- **Base path** — every endpoint is under `/api/v1` (the iCal feed and the
  `/api/health` check are the two exceptions).
- **Cursor pagination** — list endpoints return

  ```json
  { "results": [ /* … */ ], "next_cursor": "…" }
  ```

  When `next_cursor` is non-`null`, pass it back as `?cursor=<value>` to fetch the
  next page. A `null` cursor means you have reached the last page.
- **Errors** — non-2xx responses are [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)
  problem documents (`Content-Type: application/problem+json`) with `type`,
  `title`, `status`, and an optional `detail`.
- **Priority is `1 = highest`.** OpenDoist stores `1` = p1 (highest) through `4` =
  p4 (default) — the **opposite** of Todoist's API, where `4` is urgent. Keep this
  in mind whenever you read or write a `priority` field. (The Todoist
  [importer](import-todoist.md) converts this for you automatically.)

## Quick start

The fastest way to create a task is the Quick Add endpoint, which parses the same
one-line grammar as the app and CLI:

```sh
curl -X POST "$OPENDOIST_URL/api/v1/tasks/quick" \
  -H "Authorization: Bearer od_…" \
  -H "Content-Type: application/json" \
  -d '{"text": "Pay rent tomorrow 9am p1 #Home"}'
```

`p1`, `#Project`, `/Section`, `@label`, due dates, deadlines, durations, and
recurrence all work in the one `text` field. The endpoint re-parses the string
server-side and returns the created task.

## Live updates (SSE)

`GET /api/v1/events` is a [Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events)
stream (`text/event-stream`) that pushes changes — created, updated, completed,
and deleted items — as they happen. It is how the web app stays in sync across
tabs and devices in real time.

Authenticate it like any other endpoint. Reconnect with a `Last-Event-ID` header
and the server replays the events you missed, so a dropped connection never loses
an update.

## Calendar feed (iCal)

Your tasks are also published as a read-only iCalendar feed:

```
/ical/<token>/tasks.ics
```

Subscribe to it from any calendar app (Apple Calendar, Google Calendar, Outlook,
…). This feed uses its **own dedicated feed token — not an `od_` API token** —
which you create and **rotate** in **Settings → Integrations**. Rotating the
token invalidates the old URL immediately.

Note that calendar clients refresh subscriptions on _their own_ schedule (Google
Calendar in particular can lag 8-24 hours); see the [FAQ](faq.md) if the feed
looks stale.

## Health & instance info

Two unauthenticated endpoints are handy for monitoring and provisioning:

- `GET /api/health` → `{ "status": "ok" }` — a lightweight liveness probe for
  uptime monitors and container health checks.
- `GET /api/v1/info` → public instance metadata: `version`, `first_run`,
  `registration_open`, `auth_providers`, `features` (`stt` / `llm` / `push`), and
  `available_importers`.

---

**Related:** [CLI](cli.md) · [Import from Todoist](import-todoist.md) ·
[Configuration](configuration.md) · [FAQ](faq.md) ·
[back to the docs index](README.md)
