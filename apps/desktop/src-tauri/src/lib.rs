//! OpenTask desktop shell (Task A). Owns the tray icon, the global summon shortcut
//! (Cmd+Shift+Space), the `toggle_quickadd` command shared by both, single-instance,
//! and plugin registration. The reminders watcher (`src/reminders.rs`, Task D) and the
//! self-update loop (`src/updater.rs`, Task D/E) are spawned from `setup`.

use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_positioner::{Position, WindowExt};

/// Reminders watcher — polls the paired instance and fires native notifications for
/// freshly-fired reminders (Task D, `src/reminders.rs`). Spawned in `setup` below.
mod reminders;
/// Self-update loop — periodically checks the pinned release endpoint and silently
/// installs minisign-verified updates, applied on the next launch (`src/updater.rs`).
/// Registering the updater plugin alone checks nothing; this loop is the actual wiring.
/// Spawned in `setup` below.
mod updater;

/// Show the Quick Add popover anchored under the tray icon, or hide it when visible.
/// Invoked from the tray left-click, the global shortcut, and JS (`invoke('toggle_quickadd')`).
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

/// Cmd+Shift+Space from anywhere toggles the Quick Add popover.
fn register_summon_shortcut(app: &AppHandle) -> Result<(), tauri_plugin_global_shortcut::Error> {
    let summon = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Space);
    app.global_shortcut()
        .on_shortcut(summon, |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                toggle_quickadd(app.clone());
            }
        })
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
        .invoke_handler(tauri::generate_handler![toggle_quickadd])
        .setup(|app| {
            build_tray(app.handle())?;
            register_summon_shortcut(app.handle())?;
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
