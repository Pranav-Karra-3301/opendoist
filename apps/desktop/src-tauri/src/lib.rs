//! OpenTask desktop shell (Task A). Owns the tray icon, the configurable global summon shortcut
//! (default ⌘⇧Space, stored in settings.json), the `toggle_quickadd` command shared by both, single-instance,
//! and plugin registration. The reminders watcher (`src/reminders.rs`, Task D) and the
//! self-update loop (`src/updater.rs`, Task D/E) are spawned from `setup`.

use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_positioner::{Position, WindowExt};
use tauri_plugin_store::StoreExt;

/// Tauri-store key (shared `settings.json` beside the pairing) for the summon accelerator.
const QUICKADD_SHORTCUT_KEY: &str = "quickadd-shortcut";
/// Default summon combo (⌘⇧Space on macOS) — also what "Reset" in settings restores.
const DEFAULT_QUICKADD_SHORTCUT: &str = "CmdOrCtrl+Shift+Space";

/// Reminders watcher — polls the paired instance and fires native notifications for
/// freshly-fired reminders (Task D, `src/reminders.rs`). Spawned in `setup` below.
mod reminders;
/// Self-update loop — periodically checks the pinned release endpoint and silently
/// installs minisign-verified updates, applied on the next launch (`src/updater.rs`).
/// Registering the updater plugin alone checks nothing; this loop is the actual wiring.
/// Spawned in `setup` below.
mod updater;

/// Show the Quick Add popover anchored under the tray icon, or hide it when visible.
/// Invoked from the tray left-click and JS; the global shortcut path uses the centered variant.
#[tauri::command]
fn toggle_quickadd(app: AppHandle) {
    let Some(w) = app.get_webview_window("quickadd") else {
        return;
    };
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
    } else {
        // TrayCenter only works once the positioner has seen a tray event (it caches the
        // icon rect from `on_tray_event`). Before any tray interaction — e.g. a shortcut
        // summon right after launch — fall back to centring on the current monitor.
        if w.as_ref()
            .window()
            .move_window(Position::TrayCenter)
            .is_err()
        {
            let _ = w.center();
        }
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Menu-bar icon: template (monochrome) glyph, left click toggles the Quick Add popover.
/// Every tray event is forwarded to the positioner so `Position::TrayCenter` can anchor
/// the popover under the icon.
fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("bundle.icon must list at least one PNG");
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(true)
        .show_menu_on_left_click(false)
        .tooltip("OpenTask")
        .on_tray_icon_event(|tray, event| {
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_quickadd(tray.app_handle().clone());
            }
        })
        .build(app)?;
    Ok(())
}

/// Show/hide the popover CENTERED on the current monitor — the global-shortcut path
/// (Spotlight-style), deliberately different from the tray path's under-the-icon anchor.
fn toggle_quickadd_centered(app: &AppHandle) {
    let Some(w) = app.get_webview_window("quickadd") else {
        return;
    };
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
    } else {
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// The persisted summon accelerator, or the default when none was ever customized.
fn stored_shortcut(app: &AppHandle) -> String {
    app.store("settings.json")
        .ok()
        .and_then(|store| store.get(QUICKADD_SHORTCUT_KEY))
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| DEFAULT_QUICKADD_SHORTCUT.to_string())
}

/// Parse + OS-register `accel` as the (centered) summon shortcut.
fn register_summon(app: &AppHandle, accel: &str) -> Result<(), String> {
    let shortcut: Shortcut = accel
        .parse()
        .map_err(|err| format!("invalid shortcut: {err}"))?;
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                toggle_quickadd_centered(app);
            }
        })
        .map_err(|err| format!("could not register: {err}"))
}

/// Current summon accelerator — the settings recorder's initial value.
#[tauri::command]
fn get_quickadd_shortcut(app: AppHandle) -> String {
    stored_shortcut(&app)
}

/// Re-bind the summon shortcut live, persisting only after the OS accepts it. On any
/// failure the previous binding is restored, so the summon can never end up dead.
#[tauri::command]
fn set_quickadd_shortcut(app: AppHandle, accel: String) -> Result<String, String> {
    let accel = accel.trim().to_string();
    if accel.is_empty() {
        return Err("shortcut is empty".into());
    }
    let previous = stored_shortcut(&app);
    let _ = app.global_shortcut().unregister_all();
    if let Err(err) = register_summon(&app, &accel) {
        let _ = register_summon(&app, &previous);
        return Err(err);
    }
    if let Ok(store) = app.store("settings.json") {
        store.set(QUICKADD_SHORTCUT_KEY, serde_json::Value::String(accel.clone()));
        let _ = store.save();
    }
    Ok(accel)
}

pub fn run() {
    tauri::Builder::default()
        // single-instance MUST be the first registered plugin.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            toggle_quickadd,
            get_quickadd_shortcut,
            set_quickadd_shortcut
        ])
        .setup(|app| {
            build_tray(app.handle())?;
            // Register the stored (or default) summon combo; a corrupt stored value must
            // never kill the summon, so fall back to the default before giving up.
            let stored = stored_shortcut(app.handle());
            if register_summon(app.handle(), &stored).is_err() {
                eprintln!("[opentask] stored shortcut {stored:?} rejected — using default");
                let _ = register_summon(app.handle(), DEFAULT_QUICKADD_SHORTCUT);
            }
            reminders::spawn(app.handle().clone());
            updater::spawn(app.handle().clone());
            Ok(())
        })
        .on_window_event(|w, e| {
            if let tauri::WindowEvent::Focused(false) = e {
                if w.label() == "quickadd" {
                    let _ = w.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
