# FAQ

- [Where is my data?](#where-is-my-data)
- [How do backups and restore work?](#how-do-backups-and-restore-work)
- [Why don't push notifications work on my iPhone?](#why-dont-push-notifications-work-on-my-iphone)
- [Why does Google Calendar lag behind my iCal feed?](#why-does-google-calendar-lag-behind-my-ical-feed)
- [Why is priority 1 "highest" here but 4 in Todoist's API?](#why-is-priority-1-highest-here-but-4-in-todoists-api)
- [How do I re-open registration?](#how-do-i-re-open-registration)
- [How do I turn off the update check?](#how-do-i-turn-off-the-update-check)
- [Do I need HTTPS?](#do-i-need-https)
- [What's explicitly out of scope?](#whats-explicitly-out-of-scope)

## Where is my data?

Everything lives in a single `/data` volume: the SQLite database
(`opentask.db`), your `attachments/`, nightly `backups/`, and the
auto-generated `secrets.json`. There is no external database and no cloud
component. Back up (or move) the whole `/data` directory and you have moved your
entire instance. See [Data & volume layout](install.md#data--volume-layout).

## How do backups and restore work?

OpenTask takes a nightly snapshot with SQLite's `VACUUM INTO` and zips it (with
your attachments unless disabled) into `/data/backups`, keeping the last 14 by
default. From **Settings → Backups** you can list and download snapshots, click
**Back up now**, or restore by uploading a zip — a restore is verified and swaps
in behind a maintenance lock, taking a safety snapshot of the current state
first. Full details, retention semantics, and a manual fallback are in the
[Backups guide](backups.md).

## Why don't push notifications work on my iPhone?

Apple only delivers Web Push to a site that has been **added to the Home
Screen**, and only on **iOS/iPadOS 16.4 or newer**. In Safari, open OpenTask,
tap the Share button, choose **Add to Home Screen**, then open OpenTask from the
new icon and enable notifications there. (OpenTask shows these steps in an
in-app install dialog.)

If you can't or don't want to install to the Home Screen, use the **ntfy**
channel instead: configure it in **Settings → Notifications** and install the
ntfy app. ntfy (and gotify) deliver reliably on iOS without the Home-Screen
requirement.

## Why does Google Calendar lag behind my iCal feed?

That's Google, not OpenTask. Google Calendar refreshes subscribed (`webcal`/
external) calendars on its own schedule — typically every **8 to 24 hours** — so
new or changed tasks can take most of a day to appear. Apple Calendar and most
desktop clients let you set a much shorter refresh interval. The feed itself
(`/ical/<token>/tasks.ics`) is always current; only the client's poll frequency
is slow. See the [REST API](api.md) page for the feed and how to rotate its token.

## Why is priority 1 "highest" here but 4 in Todoist's API?

OpenTask stores priority the intuitive way: **1 = p1 (highest) … 4 = p4
(default)**. Todoist's *REST API* inverts this — in their API, `4` is the highest
priority and `1` is the default (the Todoist UI still labels them P1–P4). When
you [import from Todoist](import-todoist.md), OpenTask maps the values for you,
so a Todoist P1 task stays a p1 task here.

## How do I re-open registration?

Registration is open until the first account is created, then it locks
automatically. To create another account, set `OPENTASK_ALLOW_REGISTRATION=true`
and restart the container; the sign-up form reappears. Turn it back off
afterward to relock. See [Configuration → Core](configuration.md#core).

## How do I turn off the update check?

Set `OPENTASK_DISABLE_UPDATE_CHECK=true` and restart. OpenTask otherwise polls
GitHub Releases once a day to tell you when a newer version is available; nothing
is ever downloaded or installed automatically.

## Do I need HTTPS?

For anything beyond local testing, **yes**. Browsers only allow **Web Push** and
**installing the PWA** ("Add to Home Screen") on a secure (HTTPS) origin, so
reminders-to-device and the installable app require TLS. `http://localhost` is
the one exempt origin, which is why everything works when you're testing on the
same machine. Terminate TLS at a reverse proxy and set `OPENTASK_PUBLIC_URL` —
see [Running behind a reverse proxy](install.md#running-behind-a-reverse-proxy).

## What's explicitly out of scope?

OpenTask is single-user and deliberately narrow. Not planned for v1:

- **Sharing / assignees / teams** — it is single-user by design.
- **Board & calendar layouts** — list-first only (first candidates post-1.0).
- **CalDAV** — the read-only iCal feed is the calendar integration; two-way sync
  is out.
- **Google Calendar two-way sync** and **location reminders**.
- **Email reminder channel** — the notification-channel interface exists, but
  SMTP isn't wired up (push, ntfy, gotify, and webhook are).
- **Native mobile apps** — the installable PWA is the mobile story.
- **Localization** — the UI and the Quick Add parser are English at launch.

These are non-goals, not promises. See the design spec's non-goals section for
the full rationale.

---

[Docs index](README.md) · [Install](install.md) · [Configuration](configuration.md)
