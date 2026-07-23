# Backups & Restore

OpenTask backs itself up automatically every night and lets you take on-demand
backups and restore from any of them — all from a single self-contained `.zip`
per backup. No external service is required; an optional Litestream sidecar is
documented at the end for off-host, point-in-time replication.

## What a backup contains

Each backup is one zip under `<OPENTASK_DATA_DIR>/backups/`:

| Entry            | Contents                                                                              |
| ---------------- | ------------------------------------------------------------------------------------- |
| `opentask.db`   | A `VACUUM INTO` snapshot of the live SQLite database — a single, consistent file.     |
| `meta.json`      | `{ app: "opentask", version, createdAt, includesAttachments, schema: "v1" }`.        |
| `attachments/**` | The uploaded-files tree (`<dataDir>/attachments/`), **only when attachments are on**. |

The snapshot is produced with SQLite's [`VACUUM INTO`](https://www.sqlite.org/lang_vacuum.html#vacuuminto),
which captures the full committed state (including any WAL frames) in one
transaction **without blocking writers** — so a nightly backup never interrupts
the app. Writes are staged to `.tmp-*` files and renamed into place atomically,
so an interrupted backup never leaves a half-written file under a real name.

## Nightly job

On boot the server registers a [croner](https://github.com/hexagon/croner) job
`backup.nightly` that runs `createBackup({ kind: 'scheduled' })` followed by
`pruneBackups()`. Overlapping runs are skipped (`protect: true`) and any error is
logged (`pino`) but never propagated — a failed backup can't crash the app or
kill the scheduler. The schedule defaults to **03:00** local time and is fully
configurable (see `OPENTASK_BACKUP_CRON`).

## Configuration

All backup behavior is controlled by environment variables (prefix
`OPENTASK_`). Per-instance overrides for retention and attachment inclusion can
also be set from the **Settings → Backups** page, which take precedence over the
environment; leaving a field on "Default" falls back to the env value below.

| Env var                                | Default     | Meaning                                                                             |
| -------------------------------------- | ----------- | ----------------------------------------------------------------------------------- |
| `OPENTASK_DATA_DIR`                   | `/data`     | Root data directory; backups live in `<dir>/backups/`.                              |
| `OPENTASK_BACKUP_CRON`                | `0 3 * * *` | Cron expression for the nightly backup (5-field, server local time).               |
| `OPENTASK_BACKUP_RETENTION`           | `14`        | How many scheduled + manual backups to keep (count-based — see below). Min `1`.     |
| `OPENTASK_BACKUP_INCLUDE_ATTACHMENTS` | `true`      | Whether backups embed the `attachments/` tree. `1`/`true`/`yes` = on.               |

The effective values (row override ?? env ?? built-in default of `14` / `true`)
are what the engine reads at backup time and what the settings page shows as the
"Default" placeholder.

## Filename scheme

Names are validated by a single regex
(`/^opentask-(backup|prerestore)-\d{4}-\d{2}-\d{2}(-\d{6})?\.zip$/`) that also
guards the download route against path traversal.

- **Scheduled / manual** — `opentask-backup-YYYY-MM-DD.zip` (UTC date). If that
  name is already taken (a second backup the same day), a UTC time suffix is
  appended: `opentask-backup-YYYY-MM-DD-HHMMSS.zip`.
- **Pre-restore safety snapshots** — always timestamped:
  `opentask-prerestore-YYYY-MM-DD-HHMMSS.zip`.

## Retention semantics

Retention is **count-based**, applied by `pruneBackups()` after every nightly
backup:

- Keep the newest **`retentionDays`** backups of kind `scheduled` + `manual`
  (they share one pool). Because the nightly job produces roughly one backup per
  day, keeping `N` backups ≈ `N` days of history — hence the env var's name.
- Keep the newest **3** `pre_restore` snapshots.
- Everything older is deleted, both the file and its `backups_meta` row.

`listBackups()` self-heals the `backups_meta` table against the directory on
every read: rows whose file has vanished are dropped, and orphan files that match
the filename regex (e.g. one dropped in by hand) are adopted with size/mtime read
from disk and kind inferred from the name. Manual and scheduled backups are never
auto-pruned below the retention count, so a manual backup you care about survives
as long as it's within the newest `retentionDays`.

## API

All routes require a logged-in session or a `read_write` API token.

| Method & path                              | Purpose                                                          |
| ------------------------------------------ | --------------------------------------------------------------- |
| `GET /api/v1/backups`                      | `{ results: BackupInfo[], next_cursor: null }`, newest first.   |
| `POST /api/v1/backups`                     | Take a manual backup now → `201 BackupInfo`.                    |
| `GET /api/v1/backups/settings`             | Retention + include-attachments overrides and effective values. |
| `PATCH /api/v1/backups/settings`           | Update the overrides (send `null` to reset a field to default). |
| `GET /api/v1/backups/{filename}/download`  | Stream the zip (`application/zip`, attachment disposition).      |
| `POST /api/v1/backups/restore`             | Restore from an uploaded zip (multipart `file`) — see below.    |

## Restore flow & the maintenance lock

Restoring swaps the live database out from under every in-flight request, so it
runs under an **app-level maintenance lock**. Only one restore can run at a time.

1. The uploaded zip is opened and its `opentask.db` extracted to a temp dir.
2. **Verification** — the extracted db is opened read-only and must pass
   `PRAGMA integrity_check` **and** contain a `tasks` table. If either check
   fails the request is rejected (`400`) and the live database is untouched.
3. The lock is acquired and a **pre-restore safety snapshot**
   (`opentask-prerestore-…zip`) is taken first.
4. The live `opentask.db` (plus any `-wal` / `-shm`) is moved aside, the
   verified db is copied into place, and — if the zip carried an `attachments/`
   tree — the live attachments are swapped for the backup's.
5. The database is reopened, which runs pending migrations, so restoring an
   **older** backup transparently upgrades its schema to the current version.

While the lock is held, every API path except `GET /api/health` answers
`503 Maintenance in progress` (RFC 9457 problem JSON); clients retry once the
restore completes. If any step after the swap fails, the originals are moved back
and the database is reopened before the error surfaces — the lock is always
released. The response is `{ restored: true, preRestoreBackup: "<filename>" }`,
so if a restore turns out to be a mistake you can immediately restore the
safety snapshot it created.

The web **Settings → Backups** page wraps this in a type-to-confirm dialog and a
full-page "Restoring…" overlay, then reloads once it completes.

## Manual restore (fallback, no UI/API)

Because a backup is just a zip with a plain SQLite file inside, you can restore
without the app — useful for disaster recovery. Stop the server first so nothing
is writing to the database.

```sh
# 1. Stop the container (compose example)
docker compose stop opentask

# 2. Unzip the backup somewhere temporary
unzip opentask-backup-2026-07-15.zip -d /tmp/restore

# 3. Replace the live database inside the data volume.
#    Delete any stale WAL/SHM sidecars so SQLite doesn't reapply them.
docker run --rm -v opentask-data:/data -v /tmp/restore:/restore alpine sh -c '
  rm -f /data/opentask.db /data/opentask.db-wal /data/opentask.db-shm &&
  cp /restore/opentask.db /data/opentask.db &&
  if [ -d /restore/attachments ]; then rm -rf /data/attachments && cp -r /restore/attachments /data/attachments; fi
'

# 4. Start again — pending migrations run on boot, upgrading an older backup.
docker compose start opentask
```

If you run OpenTask directly (not in Docker), do the same three file operations
against `$OPENTASK_DATA_DIR` while the process is stopped.

## Optional: off-host replication with Litestream

The built-in zip backups live on the same host as the data. For off-site,
**point-in-time** recovery, add a [Litestream](https://litestream.io) sidecar
that continuously streams the SQLite database to S3-compatible object storage.
Pin a recent **0.5.x** (≥ `0.5.14`); the 0.5 rewrite adds true point-in-time
recovery via the LTX format.

> **Caveats.** Litestream **0.5.x cannot restore backups made by pre-0.5
> versions** — don't mix major lines. Litestream replicates only the
> `opentask.db` **file**, not the `attachments/` tree, so keep the built-in zip
> backups (which do include attachments) as your complete-snapshot mechanism and
> treat Litestream as an additional database-only safety net.

`docker-compose.yml` (excerpt):

```yaml
services:
  opentask:
    image: ghcr.io/pranav-karra-3301/opentask:latest
    environment:
      OPENTASK_DATA_DIR: /data
    volumes:
      - opentask-data:/data

  litestream:
    image: litestream/litestream:0.5
    depends_on: [opentask]
    command: replicate
    environment:
      LITESTREAM_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID}
      LITESTREAM_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY}
    volumes:
      - opentask-data:/data
      - ./litestream.yml:/etc/litestream.yml:ro

volumes:
  opentask-data:
```

`litestream.yml`:

```yaml
dbs:
  - path: /data/opentask.db
    replicas:
      - type: s3
        bucket: my-opentask-backups
        path: opentask
        region: us-east-1
```

Restore the database from S3 into a fresh volume before first boot:

```sh
litestream restore -o /data/opentask.db s3://my-opentask-backups/opentask
```
