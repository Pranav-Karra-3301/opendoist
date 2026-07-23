//! Background self-updater (plan Task D "updater wiring" / Task E distribution — the
//! Rust core owns the minisign updater).
//!
//! Registering `tauri_plugin_updater` in `lib.rs` only *exposes* update APIs; the plugin
//! never checks on its own. This module is the wiring that makes "updates are automatic"
//! true: shortly after launch, and then on a fixed cadence, it asks the endpoint pinned
//! in `tauri.conf.json` (`plugins.updater.endpoints` — the repo's latest desktop
//! release's `latest.json`) whether a newer version exists and, if so, downloads and
//! installs it in the background. The plugin verifies every artifact against the
//! bundled minisign public key before installing — an update that is not signed by the
//! project's private key is rejected.
//!
//! ## Policy: install silently, apply on the next launch
//!
//! A menu-bar app must never restart out from under the user, so a successful install
//! does NOT call `app.restart()`: the running process keeps its version and the updated
//! bundle takes over the next time the app launches. Once an update is installed,
//! checking stops until relaunch (`should_keep_checking`): `check()` compares the remote
//! version against the *running* (still old) version, so another check would just
//! re-download the artifact that is already installed on disk.
//!
//! Failures (offline, no desktop release yet, bad signature, …) are logged and retried
//! at the next interval. Nothing secret is involved: the endpoint is a public GitHub
//! URL and no `ot_` token ever touches this code path.

use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

/// Webview event carrying the installed version — `DesktopUpdatePrompt` listens for it
/// and shows the "Restart to update" banner.
const UPDATE_INSTALLED_EVENT: &str = "opentask://update-installed";

/// First check shortly after launch — late enough to stay out of startup's (and the
/// first reminders poll's) way, early enough that a rarely-relaunched tray app still
/// picks updates up promptly.
const INITIAL_DELAY: Duration = Duration::from_secs(30);
/// Re-check cadence for the long-lived tray process.
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

/// What one update check concluded. Pure data so the loop policy below is unit-testable
/// without an `AppHandle` or network.
#[derive(Debug, PartialEq, Eq)]
enum CheckOutcome {
    /// Endpoint reachable, no newer version than the running one.
    UpToDate,
    /// This version was downloaded, minisign-verified, and installed on disk; it runs
    /// at the next launch.
    Installed(String),
    /// Check or install failed (offline, endpoint missing, bad signature, …).
    Failed(String),
}

/// Whether the loop should poll again after `outcome`. `false` only once an update is
/// installed: the running process still reports the old version, so any further check
/// would "find" and re-download the exact update already sitting on disk.
fn should_keep_checking(outcome: &CheckOutcome) -> bool {
    !matches!(outcome, CheckOutcome::Installed(_))
}

/// One check-and-install attempt. Returns the outcome instead of logging so the loop
/// owns all logging (and the tests own the policy).
async fn check_once(app: &AppHandle) -> CheckOutcome {
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(err) => return CheckOutcome::Failed(format!("updater unavailable: {err}")),
    };
    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => return CheckOutcome::UpToDate,
        Err(err) => return CheckOutcome::Failed(format!("check failed: {err}")),
    };
    match update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
    {
        Ok(()) => CheckOutcome::Installed(update.version.clone()),
        Err(err) => CheckOutcome::Failed(format!(
            "download/install of {} failed: {err}",
            update.version
        )),
    }
}

/// Launch the self-update loop on the Tauri async runtime (same shape as
/// `reminders::spawn`, including the blocking-pool sleep — tauri's `async_runtime` does
/// not re-export an async sleep). Lives for the app's lifetime or until an update is
/// installed; there is nothing to join.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let _ = tauri::async_runtime::spawn_blocking(|| std::thread::sleep(INITIAL_DELAY)).await;
        loop {
            let outcome = check_once(&app).await;
            match &outcome {
                CheckOutcome::UpToDate => {}
                CheckOutcome::Installed(version) => {
                    eprintln!(
                        "[opentask] update {version} installed — it takes effect at the next launch"
                    );
                    // Surface it: an in-app "Restart to update" banner (webview event) plus a
                    // native heads-up in case the window is hidden. Both best-effort — the
                    // update still applies at the next launch even if neither lands.
                    let _ = app.emit(UPDATE_INSTALLED_EVENT, version.clone());
                    let _ = app
                        .notification()
                        .builder()
                        .title("OpenTask update ready")
                        .body(format!(
                            "Version {version} is installed — restart the app to start using it."
                        ))
                        .show();
                }
                // Routine when offline or before the first desktop release exists.
                CheckOutcome::Failed(err) => eprintln!("[opentask] update check skipped: {err}"),
            }
            if !should_keep_checking(&outcome) {
                return;
            }
            let _ =
                tauri::async_runtime::spawn_blocking(|| std::thread::sleep(CHECK_INTERVAL)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_checking_while_up_to_date() {
        assert!(should_keep_checking(&CheckOutcome::UpToDate));
    }

    #[test]
    fn keeps_checking_after_a_failed_check() {
        // Offline / no release yet are routine — the loop must retry next interval.
        assert!(should_keep_checking(&CheckOutcome::Failed(
            "offline".into()
        )));
    }

    #[test]
    fn stops_checking_once_an_update_is_installed() {
        // After an install the running process still reports the old version, so another
        // check would re-download the very update already installed on disk.
        assert!(!should_keep_checking(&CheckOutcome::Installed(
            "0.2.0".into()
        )));
    }
}
