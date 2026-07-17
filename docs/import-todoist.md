# Import from Todoist

Bring your existing Todoist data into OpenDoist. There are two ways to do it — an
offline backup file or a live API token — and both do the same thing under the
hood: fetch or parse your data, normalize it, and create the equivalent
projects, sections, labels, tasks, and comments in your account.

Importing is **additive and non-destructive**: it only ever _creates_ new items.
Nothing already in OpenDoist is edited or deleted, and every import can be
**previewed** first so you see exactly what will be created before anything is
written.

- [Two ways to import](#two-ways-to-import)
- [Path A — Todoist backup ZIP](#path-a--todoist-backup-zip)
- [Path B — Todoist API token](#path-b--todoist-api-token)
- [Preview first, then import](#preview-first-then-import)
- [What gets imported](#what-gets-imported)
- [How fields are mapped](#how-fields-are-mapped)
- [What gets dropped](#what-gets-dropped)
- [The import report](#the-import-report)
- [Importing over the API](#importing-over-the-api)

## Two ways to import

Open **Settings → Import** in OpenDoist. You will see up to two sources:

| Source | Tab | When to use it |
| --- | --- | --- |
| Todoist backup ZIP | **Backup file** | The simplest path — no API token needed. |
| Todoist API | **API token** | Pull your _current_ data straight from Todoist. |

Only the sources your instance advertises in `GET /api/v1/info` →
`available_importers` are offered. OpenDoist ships both `todoist-csv` (the backup
ZIP) and `todoist-api` (the live token).

Whichever you pick, the import runs as a background job and produces the same
normalized result and the same [report](#the-import-report).

## Path A — Todoist backup ZIP

A Todoist backup is a `.zip` holding one CSV per project — a complete snapshot of
everything Todoist can export, with no token required.

1. In **Todoist**: go to **Settings → Backups → Download** and save the latest
   backup `.zip`.
2. In **OpenDoist**: open **Settings → Import**, choose the **Backup file** tab,
   click **Choose .zip file**, and select the download.
3. Click **Preview import** to see what would be created, or **Import** to create
   it.

The zip is parsed entirely on the server; nothing is uploaded to any third party.
Uploads are capped at **256 MiB** (deliberately larger than the attachment cap so
a big export always fits).

## Path B — Todoist API token

The live importer reads your account through the Todoist API, so it always
reflects your current data.

1. In **Todoist**: go to **Settings → Integrations → Developer** and copy your
   API token.
2. In **OpenDoist**: open **Settings → Import**, choose the **API token** tab, and
   paste it.
3. Click **Preview import** or **Import**.

The token is used **once, for this import only** — it is never stored, logged, or
sent back to your browser. (If you run a self-hosted Todoist-compatible mirror,
the underlying endpoint also accepts an optional `baseUrl`; see
[Importing over the API](#importing-over-the-api).)

## Preview first, then import

Both sources offer the same two buttons:

- **Preview import** runs a **dry run**: OpenDoist fetches and parses everything
  and shows exactly what it _would_ create — but writes nothing.
- **Import** runs the real thing (an **apply**), behind a confirm dialog:
  _"Imports add to your existing data. Nothing is deleted."_

Because an import only ever adds, running the same import twice creates
**duplicates**. Preview to check the counts, then import once.

## What gets imported

- **Projects** — from the **API** path, nested sub-projects and colors are
  preserved; a **backup ZIP** is one flat CSV per project, so those arrive as
  top-level projects without colors.
- **Sections** — in their original order within each project.
- **Labels** — by name; an existing label of the same name is reused, not
  duplicated.
- **Tasks** — content, description, priority, due date, deadline, duration, and
  labels, with **sub-task nesting** preserved.
- **Comments** — the text of each task's comments (see attachments below).

Two behaviors worth knowing:

- Your existing **Inbox is reused** — a Todoist "Inbox" merges into it rather than
  creating a second Inbox.
- An **uncompletable task** (Todoist's `* ` prefix) keeps that prefix and stays
  uncompletable.

**Not carried over:** reminders, saved filters, and any board/calendar view
layout. OpenDoist recreates reminders itself from a task's due time (via your
**Settings → Reminders** auto-reminder), its saved-filter grammar differs from
Todoist's, and it has no board or calendar view (both are
[non-goals](configuration.md) for now). None of these block the import — your
projects, tasks, labels, and comments come across regardless.

## How fields are mapped

### Priority is inverted

This is the one conversion worth understanding. Both apps call their most-urgent
level "P1", but the numbers they store are **reversed**: Todoist's API stores
`4 = urgent`, while OpenDoist stores `1 = highest`. The importer flips them so the
urgency you meant is preserved:

| In Todoist (label · API value) | In OpenDoist |
| --- | --- |
| P1 — urgent · API `4` | **p1** — highest |
| P2 · API `3` | **p2** |
| P3 · API `2` | **p3** |
| P4 — default · API `1` | **p4** — default |

The rule is `opendoist = 5 − todoist`. You never do this by hand — it is
automatic on both import paths. (For why OpenDoist stores `1 = highest`, see the
[FAQ](faq.md) and the [API reference](api.md).)

### Due dates and recurrence

A task's natural-language due phrase — `"every Monday"`, `"tomorrow 5pm"` — is
kept as text and **re-parsed by OpenDoist's own date engine** at import time. That
means recurring tasks stay recurring, and relative dates and time zones resolve
exactly the way they do when you type into Quick Add. Date-only dues stay
date-only; timed dues keep their wall-clock time.

### Deadlines, durations, and labels

- **Deadlines** import as date-only.
- **Durations** import in minutes (a day-unit duration is converted to minutes).
  Anything longer than one day (1440 minutes) is capped at 1440 and noted in the
  skip list.
- **`@labels`** import by name; a name that already exists is reused.

## What gets dropped

Anything OpenDoist can't represent is **skipped rather than silently mangled**,
and each skip is listed in the report so you know precisely what didn't come
across. These per-item skips appear in the report with a reason:

| Skipped item | Reason shown |
| --- | --- |
| Collaborators on a shared project | `collaborators dropped` — OpenDoist is single-user, so the project imports but its sharing does not |
| Assignee (a task's "responsible" user) | `assignee dropped` — the task imports, unassigned |
| A file attached to a comment | `attachment dropped` — the comment text imports; the file does not |
| A note with no parent task (backup CSV) | `orphan note dropped` — nothing to attach it to |
| A task with empty content | `empty content` — nothing to create |
| A duration longer than one day | `duration capped to 1 day` — the task imports with a 1440-minute duration |

One case is **rescued instead of dropped**: a sub-task whose parent can't be
resolved is imported as a top-level task (and noted as
`subtask promoted to top-level`), so it is never lost.

Because OpenDoist is single-user by design, **sharing, assignees, and teams are
[out of scope](configuration.md)** — dropping collaborators and assignees is
expected, not a failure.

## The import report

After a preview or an import, OpenDoist shows a report with:

- **A counts table** — for each entity type (projects, sections, labels, tasks,
  comments), how many were **Found** in the source versus **To create** (preview)
  or **Created** (apply). "Created" can be lower than "Found" when existing
  labels are reused.
- **A collapsible skip list** — headed "_N items skipped_", each entry naming the
  entity type, a reference (usually the task or comment content), and the reason
  from the table above.

A preview report is titled _"Preview — nothing has been imported yet"_ and offers
an **Import now** button to apply the very same plan.

## Importing over the API

The Settings UI is a thin wrapper over three endpoints, so you can drive an import
from a script. All three require an authenticated session cookie or a
`read_write` `od_` token (see the [API reference](api.md)):

```
POST /api/v1/import/todoist-csv    multipart form: file=<backup.zip>, mode=dry-run|apply
POST /api/v1/import/todoist-api    json: { "token": "…", "mode": "dry-run"|"apply", "baseUrl"?: "…" }
GET  /api/v1/import/jobs/{id}      poll job status + final report
```

A `POST` starts a background job and returns `202 { "jobId": "…" }`; poll
`GET /api/v1/import/jobs/{id}` until its `status` is `done` or `error`. `mode`
defaults to `dry-run`, so an import never writes unless you ask it to.

---

**Related:** [Configuration](configuration.md) ·
[API reference](api.md) · [CLI](cli.md) · [FAQ](faq.md) ·
[back to the docs index](README.md)
