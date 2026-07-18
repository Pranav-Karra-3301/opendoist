//! Reminders watcher (plan Task D). A background poller that mirrors the paired
//! instance's server-side reminder firing into native macOS notifications.
//!
//! ## How it decides what to notify
//!
//! The instance runs its own reminder scheduler: a 30 s tick that stamps `fired_at`
//! on a reminder the moment it fires (see `apps/server/src/reminders/scheduler.ts`).
//! That stamp is the authoritative, server-side "this reminder has fired" signal, so we
//! mirror it rather than re-deriving "is it due?" from a local clock — no client/server
//! skew, and the server's stale-suppression is already reflected. For each reminder that
//! has *newly* gained a `fired_at` we haven't notified for, we show one native notification.
//!
//! The dedup key is `{id}@{fired_at}` so a recurring reminder that re-arms (its `fired_at`
//! resets to null, then gets a fresh instant on the next fire) notifies again next time.
//!
//! ## Why the first poll never fires
//!
//! `GET /api/v1/reminders` returns *all* the user's reminders, including ones that fired
//! long ago. On the first successful poll we therefore only *seed* the seen-set with
//! everything already fired and notify nothing — launching (or relaunching) the app must
//! never replay a backlog. This is the plan's "fires once, not repeatedly" and "the server
//! is the source of truth"; nothing is persisted, the seen-set is in-memory only.
//!
//! ## Platform note
//!
//! Native notifications require a *bundled*, signed app. Under `tauri dev` (a raw binary)
//! macOS attributes and drops them differently — the plugin itself keys off `tauri::is_dev()`
//! (`com.apple.Terminal` vs the real bundle id). Verify with `tauri build --debug`
//! (plan Task D Step 3 / Task F), never `tauri dev`.

use std::collections::HashSet;
use std::time::Duration;

use serde::Deserialize;
use tauri::AppHandle;
use tauri_plugin_http::reqwest;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_store::StoreExt;

/// How often to poll the instance for freshly-fired reminders. The server scheduler runs
/// every 30 s, so a 60 s poll surfaces a fire within ~90 s worst-case — fine for reminders.
const POLL_INTERVAL: Duration = Duration::from_secs(60);
/// Bound each request so a hung or slow instance can never wedge the poll loop.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

/// The tauri-plugin-store file Task B persists the pairing into, and its keys. Reading the
/// same store (the plugin returns the already-loaded instance) keeps the Rust watcher and
/// the JS pairing UI on one source of truth — never a second copy that could drift.
const STORE_PATH: &str = "settings.json";
const KEY_INSTANCE_URL: &str = "instanceUrl";
const KEY_TOKEN: &str = "token";

const NOTIFICATION_TITLE: &str = "OpenDoist";
/// Shown when the reminder fired but its task could not be fetched (offline blip, deleted
/// task); the user still learns a reminder came due rather than getting nothing.
const FALLBACK_BODY: &str = "You have a reminder due.";

/// The paired instance, read fresh from the store each tick so a pair/unpair mid-session is
/// picked up without restarting the watcher. The token lives only here and in the
/// `Authorization` header — never logged, echoed, or put in a URL.
struct Session {
    base_url: String,
    token: String,
}

/// One row from `GET /api/v1/reminders` — only the fields the watcher needs (serde ignores
/// the rest). `fired_at` is `null` while pending and an ISO-8601 UTC instant once fired.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct Reminder {
    id: String,
    task_id: String,
    #[serde(default)]
    fired_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ReminderList {
    results: Vec<Reminder>,
}

/// Minimal task shape for the notification body: `GET /api/v1/tasks/{id}` → `{ content, … }`.
#[derive(Debug, Deserialize)]
struct TaskContent {
    content: String,
}

/// In-memory dedup + first-poll seeding. Pure and independently unit-tested — the network
/// and notification I/O live in the async loop below, this type only decides *which*
/// reminders are new fires.
#[derive(Default)]
struct SeenSet {
    seeded: bool,
    seen: HashSet<String>,
}

impl SeenSet {
    fn new() -> Self {
        Self::default()
    }

    /// Dedup key for one fired reminder: id + fire instant, so a re-armed recurring reminder
    /// (same id, fresh `fired_at`) counts as a distinct firing.
    fn key(id: &str, fired_at: &str) -> String {
        format!("{id}@{fired_at}")
    }

    /// Record the current feed and return the reminders to notify about *now*.
    ///
    /// The first call seeds: every already-fired reminder is recorded and nothing is
    /// returned (a fresh launch never replays history). Every later call returns only
    /// reminders that gained a `fired_at` not seen before — each such firing exactly once.
    /// Reminders still pending (`fired_at == None`) are ignored until they fire.
    fn take_new_fires<'a>(&mut self, reminders: &'a [Reminder]) -> Vec<&'a Reminder> {
        let seeding = !self.seeded;
        let mut fires = Vec::new();
        for reminder in reminders {
            let Some(fired_at) = reminder.fired_at.as_deref() else {
                continue; // still pending — nothing to notify yet
            };
            let is_new = self.seen.insert(Self::key(&reminder.id, fired_at));
            if is_new && !seeding {
                fires.push(reminder);
            }
        }
        self.seeded = true;
        fires
    }
}

/// Load-time scheme gate, mirroring Task B's `normalizeInstanceUrl` rule (and its JS
/// read-side twin in `apps/web/src/desktop/session-store.ts` `loadPairing`): the pairing
/// UI only ever persists an absolute `https://` URL, so anything else in the
/// hand-editable `settings.json` is tampering or corruption — and the `od_` bearer must
/// never be sent over cleartext http. ASCII-case-insensitive because URL schemes are
/// case-insensitive and the JS side (via `new URL()`) accepts `HTTPS://…` too. Byte
/// slicing via `get(..8)` is boundary-safe: a multi-byte char in the first 8 bytes
/// yields `None` → rejected, never a panic.
fn is_https_url(url: &str) -> bool {
    url.get(..8)
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("https://"))
}

/// Read the paired session from the shared store, or `None` when unpaired or unreadable
/// (outside a paired session there is simply nothing to watch). Mirrors Task B's
/// `loadPairing`: trim, strip trailing slashes, require both fields non-empty, and
/// require an `https://` URL (see `is_https_url`).
fn load_session(app: &AppHandle) -> Option<Session> {
    let store = app.store(STORE_PATH).ok()?;
    let raw_url = store.get(KEY_INSTANCE_URL)?;
    let raw_token = store.get(KEY_TOKEN)?;
    let base_url = raw_url.as_str()?.trim().trim_end_matches('/').to_string();
    let token = raw_token.as_str()?.to_string();
    if base_url.is_empty() || token.is_empty() {
        return None;
    }
    if !is_https_url(&base_url) {
        // A hand-edited store (the pairing UI rejects non-https) — treat as unpaired so
        // the bearer never travels in the clear. Log the fact only: never the URL (it is
        // attacker-chosen here) and never the token.
        eprintln!(
            "[opendoist] reminders poll skipped: stored instance URL is not https:// — ignoring pairing"
        );
        return None;
    }
    Some(Session { base_url, token })
}

/// Authenticated `GET {base_url}{path}` returning the response body as text, or an error
/// string. Parsing is left to the caller via `serde_json` so we do not depend on reqwest's
/// (non-default in tauri-plugin-http) `json` feature.
async fn get_text(
    client: &reqwest::Client,
    session: &Session,
    path: &str,
) -> Result<String, String> {
    let url = format!("{}{}", session.base_url, path);
    let res = client
        .get(&url)
        .header("authorization", format!("Bearer {}", session.token))
        .header("accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    res.text()
        .await
        .map_err(|e| format!("read body failed: {e}"))
}

/// Fetch the caller's reminder feed.
async fn fetch_reminders(
    client: &reqwest::Client,
    session: &Session,
) -> Result<Vec<Reminder>, String> {
    let body = get_text(client, session, "/api/v1/reminders").await?;
    let list: ReminderList =
        serde_json::from_str(&body).map_err(|e| format!("parse failed: {e}"))?;
    Ok(list.results)
}

/// Fetch a single task's content for the notification body; `None` on any failure (the
/// caller falls back to a generic body rather than dropping the notification).
async fn fetch_task_content(
    client: &reqwest::Client,
    session: &Session,
    task_id: &str,
) -> Option<String> {
    let body = get_text(client, session, &format!("/api/v1/tasks/{task_id}"))
        .await
        .ok()?;
    let task: TaskContent = serde_json::from_str(&body).ok()?;
    Some(task.content)
}

/// One poll: read the session, fetch the feed, and fire a native notification for each
/// newly-fired reminder. Unpaired or offline is a normal, silent state — we skip without
/// seeding so that the first *successful* poll after pairing is the one that seeds.
async fn tick(app: &AppHandle, client: &reqwest::Client, seen: &mut SeenSet) {
    let Some(session) = load_session(app) else {
        return; // unpaired — nothing to watch yet
    };
    let reminders = match fetch_reminders(client, &session).await {
        Ok(reminders) => reminders,
        Err(err) => {
            // Transient (instance down, network blip): skip this tick, keep the seen-set,
            // retry next interval. Never surfaces the token.
            eprintln!("[opendoist] reminders poll skipped: {err}");
            return;
        }
    };

    let fires: Vec<Reminder> = seen
        .take_new_fires(&reminders)
        .into_iter()
        .cloned()
        .collect();
    for reminder in fires {
        let body = fetch_task_content(client, &session, &reminder.task_id)
            .await
            .unwrap_or_else(|| FALLBACK_BODY.to_string());
        if let Err(err) = app
            .notification()
            .builder()
            .title(NOTIFICATION_TITLE)
            .body(body)
            .show()
        {
            eprintln!(
                "[opendoist] notification failed for reminder {}: {err}",
                reminder.id
            );
        }
    }
}

/// Launch the reminders watcher. Runs the poll loop on the Tauri async runtime (so the
/// reqwest client and `notification().show()` both have their runtime), sleeping between
/// polls on the blocking pool (tauri's `async_runtime` does not re-export an async sleep).
/// The loop lives for the app's lifetime; there is nothing to join.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let client = match reqwest::Client::builder().timeout(REQUEST_TIMEOUT).build() {
            Ok(client) => client,
            Err(err) => {
                eprintln!(
                    "[opendoist] reminders watcher disabled — http client init failed: {err}"
                );
                return;
            }
        };
        let mut seen = SeenSet::new();
        loop {
            // The first tick seeds against the instance's current state; later ticks fire
            // only genuinely-new reminders.
            tick(&app, &client, &mut seen).await;
            let _ =
                tauri::async_runtime::spawn_blocking(|| std::thread::sleep(POLL_INTERVAL)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reminder(id: &str, task_id: &str, fired_at: Option<&str>) -> Reminder {
        Reminder {
            id: id.to_string(),
            task_id: task_id.to_string(),
            fired_at: fired_at.map(str::to_string),
        }
    }

    #[test]
    fn first_poll_seeds_without_firing() {
        let mut seen = SeenSet::new();
        let feed = vec![
            reminder("r1", "t1", Some("2026-07-15T09:00:00.000Z")),
            reminder("r2", "t2", Some("2026-07-15T10:00:00.000Z")),
        ];
        // Everything already fired at launch is baseline, not a notification.
        assert!(seen.take_new_fires(&feed).is_empty());
    }

    #[test]
    fn fires_a_reminder_that_fires_after_seeding() {
        let mut seen = SeenSet::new();
        // Poll 1: the reminder is still pending — seeds nothing about it.
        let pending = vec![reminder("r1", "t1", None)];
        assert!(seen.take_new_fires(&pending).is_empty());
        // Poll 2: the server has now stamped fired_at → exactly one new fire.
        let fired = vec![reminder("r1", "t1", Some("2026-07-15T09:00:00.000Z"))];
        let fires = seen.take_new_fires(&fired);
        assert_eq!(fires.len(), 1);
        assert_eq!(fires[0].id, "r1");
        assert_eq!(fires[0].task_id, "t1");
    }

    #[test]
    fn does_not_refire_the_same_firing() {
        let mut seen = SeenSet::new();
        assert!(seen
            .take_new_fires(&[reminder("r1", "t1", None)])
            .is_empty());
        let fired = vec![reminder("r1", "t1", Some("2026-07-15T09:00:00.000Z"))];
        assert_eq!(seen.take_new_fires(&fired).len(), 1);
        // The reminder stays in the feed with the same fired_at forever — never re-notify.
        assert!(seen.take_new_fires(&fired).is_empty());
        assert!(seen.take_new_fires(&fired).is_empty());
    }

    #[test]
    fn refires_recurring_reminder_on_a_new_instant() {
        let mut seen = SeenSet::new();
        assert!(seen
            .take_new_fires(&[reminder("r1", "t1", None)])
            .is_empty());
        // First occurrence fires.
        let first = vec![reminder("r1", "t1", Some("2026-07-15T09:00:00.000Z"))];
        assert_eq!(seen.take_new_fires(&first).len(), 1);
        // Recurring reminder re-armed: same id, later fired_at → a distinct firing.
        let second = vec![reminder("r1", "t1", Some("2026-07-16T09:00:00.000Z"))];
        let fires = seen.take_new_fires(&second);
        assert_eq!(fires.len(), 1);
        assert_eq!(
            fires[0].fired_at.as_deref(),
            Some("2026-07-16T09:00:00.000Z")
        );
    }

    #[test]
    fn ignores_pending_reminders_until_they_fire() {
        let mut seen = SeenSet::new();
        // Seed on an empty-ish feed.
        assert!(seen.take_new_fires(&[]).is_empty());
        // A brand-new but still-pending reminder is never a fire.
        let pending = vec![reminder("r9", "t9", None)];
        assert!(seen.take_new_fires(&pending).is_empty());
        assert!(seen.take_new_fires(&pending).is_empty());
    }

    #[test]
    fn fires_only_the_newly_fired_reminder_in_a_mixed_feed() {
        let mut seen = SeenSet::new();
        // Poll 1 seeds r1 (already fired) and notes r2 pending.
        let poll1 = vec![
            reminder("r1", "t1", Some("2026-07-15T08:00:00.000Z")),
            reminder("r2", "t2", None),
        ];
        assert!(seen.take_new_fires(&poll1).is_empty());
        // Poll 2: r1 unchanged (seeded), r2 now fired, r3 newly appears already fired.
        let poll2 = vec![
            reminder("r1", "t1", Some("2026-07-15T08:00:00.000Z")),
            reminder("r2", "t2", Some("2026-07-15T09:00:00.000Z")),
            reminder("r3", "t3", Some("2026-07-15T09:00:30.000Z")),
        ];
        let mut ids: Vec<&str> = seen
            .take_new_fires(&poll2)
            .iter()
            .map(|r| r.id.as_str())
            .collect();
        ids.sort_unstable();
        assert_eq!(ids, vec!["r2", "r3"]);
    }

    /// Load-time https gate (mirrors the JS `loadPairing` re-validation): a hand-edited
    /// `settings.json` must never make the watcher send the bearer over cleartext.
    #[test]
    fn https_gate_accepts_https_urls_case_insensitively() {
        assert!(is_https_url("https://tasks.example.com"));
        assert!(is_https_url("https://tasks.example.com:8443/subpath"));
        // URL schemes are case-insensitive; the JS side accepts these too.
        assert!(is_https_url("HTTPS://tasks.example.com"));
        assert!(is_https_url("Https://tasks.example.com"));
    }

    #[test]
    fn https_gate_rejects_cleartext_and_malformed_urls() {
        // The exact hand-edited value from the review's live bypass.
        assert!(!is_https_url("http://localhost:32416"));
        assert!(!is_https_url("HTTP://tasks.example.com"));
        assert!(!is_https_url("ftp://tasks.example.com"));
        assert!(!is_https_url("tasks.example.com"));
        assert!(!is_https_url("https:/tasks.example.com"));
        assert!(!is_https_url(""));
        assert!(!is_https_url("https"));
        // A scheme-less string that merely CONTAINS https later on.
        assert!(!is_https_url("see https://tasks.example.com"));
    }

    #[test]
    fn https_gate_is_utf8_boundary_safe() {
        // Multi-byte chars inside the first 8 bytes must reject, never panic.
        assert!(!is_https_url("héllo→🙂"));
        assert!(!is_https_url("🙂🙂🙂"));
    }
}
