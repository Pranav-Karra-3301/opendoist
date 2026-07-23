# Configuration

Every OpenTask setting is an **optional** environment variable prefixed with
`OPENTASK_`. Environment variables set instance-wide **defaults**; per-user
Settings inside the app (theme, notification channels, Ramble providers, and so
on) override them at runtime. Nothing here is required to boot — a bare
`docker run` works, and the defaults below apply.

Secrets are never configured through the environment: on first boot the server
generates `/data/secrets.json` (see [Secrets](#secrets)).

- [Core](#core)
- [Backups](#backups)
- [Single sign-on (OIDC)](#single-sign-on-oidc)
- [Ramble: speech-to-text & LLM](#ramble-speech-to-text--llm)
- [Advanced / build-time](#advanced--build-time)
- [Secrets](#secrets)

> **Booleans** accept `1`, `true`, or `yes` (case-insensitive) as true; any other
> value — including unset — is false.

## Core

| Variable | Default | Purpose |
|---|---|---|
| `OPENTASK_PUBLIC_URL` | — | **Recommended.** Absolute external origin, e.g. `https://tasks.example.com`. Makes Web-Push, iCal, and OIDC redirect URLs correct. |
| `OPENTASK_PORT` | `7968` | HTTP listen port. |
| `OPENTASK_DATA_DIR` | `/data` | Directory holding the SQLite database, attachments, backups, and `secrets.json`. |
| `OPENTASK_ALLOW_REGISTRATION` | `false` | Sign-up is open until the first account exists, then locks. Set `true` to reopen. |
| `OPENTASK_DISABLE_UPDATE_CHECK` | `false` | Set `true` to skip the daily GitHub-release update poll. |
| `OPENTASK_LOG_LEVEL` | `info` | Log level: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`. |
| `OPENTASK_TRUST_PROXY` | `false` | Honor `X-Forwarded-*` headers. Set `true` behind a reverse proxy. |
| `OPENTASK_UPLOAD_MAX_MB` | `25` | Maximum size (MB) for attachment and Ramble audio uploads. |

## Backups

See the [Backups guide](backups.md) for how snapshots, retention, and restore
work end to end.

| Variable | Default | Purpose |
|---|---|---|
| `OPENTASK_BACKUP_RETENTION` | `14` | Number of nightly backup snapshots to keep. |
| `OPENTASK_BACKUP_INCLUDE_ATTACHMENTS` | `true` | Include the `attachments/` folder in each backup zip. |
| `OPENTASK_BACKUP_CRON` | `0 3 * * *` | Cron expression for the nightly backup job (default 03:00 daily). |

## Single sign-on (OIDC)

Generic OIDC single sign-on turns on **only when all three** of `ISSUER`,
`CLIENT_ID`, and `CLIENT_SECRET` are set. The "Continue with …" button then
appears on the login screen (the login page reads this from `/api/v1/info`).

| Variable | Default | Purpose |
|---|---|---|
| `OPENTASK_OIDC_ISSUER` | — | OIDC issuer URL. Required to enable SSO. |
| `OPENTASK_OIDC_CLIENT_ID` | — | OIDC client ID. Required. |
| `OPENTASK_OIDC_CLIENT_SECRET` | — | OIDC client secret. Required. |
| `OPENTASK_OIDC_NAME` | `OIDC` | Label shown on the sign-in button (e.g. `Authentik`, `Google`). |

Set your provider's allowed redirect URL using `OPENTASK_PUBLIC_URL` as the
origin.

## Ramble: speech-to-text & LLM

These are **instance defaults** for the voice [Ramble](voice-ramble.md) feature;
each can also be set per-instance in **Settings → Integrations**, which is where
keys are stored encrypted at rest. A block activates as soon as its `_PROVIDER`
variable is set — the `_BASE_URL`, `_MODEL`, and `_API_KEY` variables are
optional. See [Ramble](voice-ramble.md) for provider recipes, the provider
matrix, and the self-hosted STT sidecar.

| Variable | Default | Purpose |
|---|---|---|
| `OPENTASK_STT_PROVIDER` | — | Speech-to-text provider: `openai-compatible`, `deepgram`, or `elevenlabs`. Enables transcription. |
| `OPENTASK_STT_BASE_URL` | — | STT API base URL (for `openai-compatible`, e.g. a local Speaches sidecar). |
| `OPENTASK_STT_MODEL` | — | STT model name. |
| `OPENTASK_STT_API_KEY` | — | STT API key (omit for keyless local sidecars). |
| `OPENTASK_LLM_PROVIDER` | — | LLM provider for task extraction (`openai-compatible`). Leave unset (or pick `none` in Settings) to put the whole transcript into a single task. |
| `OPENTASK_LLM_BASE_URL` | — | LLM API base URL. |
| `OPENTASK_LLM_MODEL` | — | LLM model name. |
| `OPENTASK_LLM_API_KEY` | — | LLM API key. |

The LLM never invents dates: spoken phrases are handed back to OpenTask's own
date parser, so `"tomorrow at 9"` is resolved the same way as in Quick Add.

## Advanced / build-time

You normally never set these by hand.

| Variable | Default | Purpose |
|---|---|---|
| `OPENTASK_WEB_DIST` | — (Docker image: `/app/web-dist`) | Directory the server serves the built web SPA from. Set automatically in the image; needed only when [running from source](install.md#running-from-source). |
| `OPENTASK_VERSION` | `<package version>-dev` (image: build-arg) | Version string reported by `/api/v1/info`. Baked in at image-build time; do not set it yourself. |

## Secrets

On first boot the server writes `<data-dir>/secrets.json` with file mode `600`.
It holds, all auto-generated:

- the **session secret**,
- the **Web-Push VAPID** public/private keypair, and
- the **AES-GCM encryption key** used to encrypt stored provider keys (STT/LLM).

These values are never read from the environment. Do not commit or share the
file. It is included in [backups](backups.md); losing it invalidates existing
sessions and push subscriptions and makes encrypted provider keys unrecoverable.

---

[Docs index](README.md) · [Install](install.md) · [FAQ](faq.md)
