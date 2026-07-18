# OpenDoist for macOS

A fast, light **native macOS app** for your self-hosted [OpenDoist](https://github.com/Pranav-Karra-3301/opendoist) instance, built with [Tauri 2](https://v2.tauri.app/) (system WebKit + a Rust core — **~5–10 MB download, ~30–50 MB RAM**, versus ~150 MB for an Electron equivalent).

It is the same React app you use in the browser, wrapped in a native shell that adds:

- **Menu-bar Quick Add** — a frameless popover summoned from anywhere with `⌘⇧Space` (or a click on the tray icon) to capture a task in natural language without leaving what you're doing.
- **Native reminder notifications** — a background watcher polls your instance and fires real macOS notifications when reminders come due.
- **Launch at login** — an optional toggle so the tray is always there.
- **Automatic updates** — a minisign-verified in-app updater, so you never re-download manually.

The main window is the full OpenDoist web app; the desktop build simply talks to your instance over a bearer token instead of a browser cookie (which also sidesteps CORS).

---

## Install

1. Download **`OpenDoist_<version>_universal.dmg`** from the latest [desktop release](https://github.com/Pranav-Karra-3301/opendoist/releases). The build is *universal* — one download runs natively on both Apple Silicon and Intel Macs.
2. Open the `.dmg` and drag **OpenDoist** into your **Applications** folder.
3. **First launch is blocked by Gatekeeper.** The app is *ad-hoc signed but not notarized* (see [below](#why-does-macos-say-the-app-is-unverified)), so macOS refuses it the first time:
   - Open **System Settings → Privacy & Security**.
   - Scroll to the security section — you'll see *"OpenDoist" was blocked to protect your Mac.*
   - Click **Open Anyway**, then authenticate with Touch ID or your password.
   - On the next dialog, click **Open** once more.

   > macOS Sequoia (15) removed the old *right-click → Open* shortcut, so the **Open Anyway** button in System Settings is the supported path. As a command-line fallback you can strip the download quarantine flag directly:
   >
   > ```sh
   > xattr -dr com.apple.quarantine /Applications/OpenDoist.app
   > ```

After the first successful launch macOS remembers your choice and opens the app normally.

## Pair with your instance

On first run the app shows a short pairing screen:

1. **Instance URL** — the full `https://` URL of your OpenDoist server (HTTP is rejected; the token would travel in the clear otherwise).
2. **API token** — an `od_…` token. Mint one in your instance under **Settings → Integrations**.

Click **Connect**. The app validates the URL and token against your instance and stores them locally (via `tauri-plugin-store`); the token is never written to a URL or logged. From then on the main window loads your real task list and the Quick Add popover posts straight to your instance.

## Features & shortcuts

| Action | How |
| --- | --- |
| Summon Quick Add from anywhere | `⌘⇧Space`, or click the menu-bar (tray) icon |
| Add a task | Type natural language (e.g. `pay rent tom p1 #Home`) → `Enter` |
| Dismiss Quick Add without saving | `Esc`, or click away (it hides on blur) |
| Reminders | Fire as native notifications automatically once paired |
| Launch at login | Toggle in the app's settings |

## Updates

Updates are **automatic**. The app checks the latest desktop release shortly after launch and every six hours from then on; when a newer version exists it is downloaded and installed silently in the background and **takes effect the next time the app launches** — the running app is never restarted out from under you. Every update artifact is verified against the bundled minisign public key before it is applied — an update that isn't signed by the project's private key is rejected. You never need to re-run the Gatekeeper steps for an update.

## Why does macOS say the app is "unverified"?

OpenDoist is distributed **without an Apple Developer account**, so the app is **ad-hoc signed** (`signingIdentity: "-"`) rather than signed with an Apple certificate and **notarized**. Practically:

- Ad-hoc signing is what lets the app run on Apple Silicon at all (Apple Silicon requires *some* signature).
- Without notarization, Apple hasn't run its automated malware scan, so Gatekeeper shows the one-time "unverified developer" prompt handled in [Install](#install) above.
- This is a trust/verification gap, **not** a safety defect — the app is exactly what you build from this repository. The self-updater's minisign signatures are the project's own end-to-end integrity check, independent of Apple.

---

## Building from source

Prerequisites: Rust (stable), the Xcode Command Line Tools, Node 22+, and pnpm (pinned via the repo's `packageManager` field).

```sh
pnpm install

# Dev: opens the app pointing at the Vite dev server (localhost:5173).
pnpm --filter @opendoist/desktop tauri dev

# Production bundle (.app + .dmg) under apps/desktop/src-tauri/target/…/bundle/.
pnpm --filter @opendoist/desktop tauri build
```

> **Tray and notification behaviour must be tested against a *built* app**, not `tauri dev`. `tauri dev` runs a bare binary whose bundle identity/entitlements differ, so notifications and some tray behaviour misreport there. Use a debug bundle to test them:
>
> ```sh
> pnpm --filter @opendoist/desktop tauri build --debug
> open apps/desktop/src-tauri/target/debug/bundle/macos/OpenDoist.app
> ```

## Releasing (maintainers)

Releases are produced by the **[`Desktop Release`](../../.github/workflows/desktop-release.yml)** GitHub Actions workflow — kept deliberately separate from the server's `docker.yml` / `prepare-release.yml` pipelines.

**Cut a release** by pushing a `desktop-v*` tag (or run the workflow manually with a `tag` input):

```sh
git tag desktop-v0.1.0
git push origin desktop-v0.1.0
```

The workflow, on a single Apple-Silicon runner, builds one **universal** (arm64 + x86_64) bundle, ad-hoc signs it, minisign-signs the updater artifacts, and attaches the `.dmg`, `.app.tar.gz`, its `.sig`, and `latest.json` to a GitHub Release, which it then marks **Latest**.

### Updater signing keys

The updater trusts a single **minisign** keypair (this is *unrelated* to Apple code signing):

- The **public key** is committed in [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json) under `plugins.updater.pubkey`.
- The **private key** and its password are **never committed**. They live at `~/.tauri/opendoist_updater.key` (+ `.password.txt`) and as the GitHub Actions secrets **`TAURI_SIGNING_PRIVATE_KEY`** and **`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`**, which the workflow passes to the Tauri CLI.

To (re)generate a keypair — note this **invalidates every previously shipped app's ability to auto-update**, since the baked-in public key changes:

```sh
pnpm --filter @opendoist/desktop exec tauri signer generate -w ~/.tauri/opendoist_updater.key
# then paste the printed public key into plugins.updater.pubkey, and update the secrets:
gh secret set TAURI_SIGNING_PRIVATE_KEY          < ~/.tauri/opendoist_updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD < ~/.tauri/opendoist_updater.password.txt
```

### Updater endpoint caveat

The updater endpoint pinned in `tauri.conf.json` is the repository's **Latest** release:

```
https://github.com/Pranav-Karra-3301/opendoist/releases/latest/download/latest.json
```

The release workflow marks each desktop release **Latest** so this resolves correctly. The server's `vX.Y.Z` releases are distributed as Docker images (not via this download URL), so in practice they don't interfere. If a future server release is also marked "Latest", the desktop updater would momentarily resolve to a release with no `latest.json`; if that becomes a concern, point the endpoint at a dedicated, desktop-only "latest" instead.
