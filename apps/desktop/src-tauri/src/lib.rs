//! OpenTask desktop shell (Task A). Owns the tray icon, the configurable global summon shortcut
//! (default ⌘⇧Space, stored in settings.json), the `toggle_quickadd` command shared by both, single-instance,
//! and plugin registration. The reminders watcher (`src/reminders.rs`, Task D) and the
//! self-update loop (`src/updater.rs`, Task D/E) are spawned from `setup`.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::tray::TrayIconBuilder;
#[cfg(not(target_os = "linux"))]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

/// Whether the LAST summon happened while another app was frontmost. Dismissing the
/// popover then hides the whole app (returning focus to that app, Spotlight-style)
/// instead of letting macOS promote our main window to key.
static SUMMONED_FROM_OUTSIDE: AtomicBool = AtomicBool::new(false);

/// Record, at summon time, whether the user was in another app (the main window not
/// focused — or not existing at all in tray-only operation).
fn note_summon_origin(app: &AppHandle) {
    let outside = app
        .get_webview_window("main")
        .map(|m| !m.is_focused().unwrap_or(false))
        .unwrap_or(true);
    SUMMONED_FROM_OUTSIDE.store(outside, Ordering::Relaxed);
}

/// Explicit dismissal (Enter-confirm or Escape from the popover): hide it, and when the
/// summon came from outside the app, hide the app too so focus returns to the previous
/// app — never surfacing the main window. Blur-dismissal stays in `on_window_event`
/// untouched: there the user already clicked their next focus target.
#[tauri::command]
fn dismiss_quickadd(app: AppHandle) {
    if let Some(w) = app.get_webview_window("quickadd") {
        let _ = w.hide();
    }
    // `AppHandle::hide` is macOS-only (NSApp hide → previous app regains focus). On
    // Windows/Linux the window manager hands focus back on its own when the popover hides.
    #[cfg(target_os = "macos")]
    if SUMMONED_FROM_OUTSIDE.load(Ordering::Relaxed) {
        let _ = app.hide();
    }
}
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_positioner::{Position, WindowExt};
use tauri_plugin_store::StoreExt;

/// Emitted to the quickadd webview on every summon so it can grab keyboard focus for the
/// input — the window `Focused` event alone races the show on macOS and can drop the caret.
const QUICKADD_SUMMONED_EVENT: &str = "opentask://summoned";

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

/// Nudge a just-positioned window fully inside its monitor's horizontal bounds — a
/// 660-wide popover tray-centered near the screen edge would otherwise overflow off-screen.
fn clamp_to_monitor(w: &tauri::WebviewWindow) {
    let Ok(pos) = w.outer_position() else { return };
    let Ok(size) = w.outer_size() else { return };
    let Ok(Some(monitor)) = w.current_monitor() else { return };
    let m_pos = monitor.position();
    let m_size = monitor.size();
    let min_x = m_pos.x;
    let max_x = (m_pos.x + m_size.width as i32 - size.width as i32).max(min_x);
    let x = pos.x.clamp(min_x, max_x);
    if x != pos.x {
        let _ = w.set_position(tauri::PhysicalPosition::new(x, pos.y));
    }
}

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
        note_summon_origin(&app);
        if w.as_ref()
            .window()
            .move_window(Position::TrayCenter)
            .is_err()
        {
            let _ = w.center();
        } else {
            clamp_to_monitor(&w);
        }
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.emit(QUICKADD_SUMMONED_EVENT, ());
    }
}

/// Tray icon. macOS/Windows: template/colored glyph, left click toggles the Quick Add
/// popover (every tray event is forwarded to the positioner so `Position::TrayCenter`
/// can anchor it under the icon). Linux: appindicator trays deliver no reliable click
/// events, so the tray carries a menu (Quick Add / Open OpenTask / Quit) instead.
fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("bundle.icon must list at least one PNG");
    let builder = TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("OpenTask");

    #[cfg(target_os = "linux")]
    let builder = {
        use tauri::menu::{MenuBuilder, MenuItemBuilder};
        let quick_add = MenuItemBuilder::with_id("quickadd", "Quick Add").build(app)?;
        let open = MenuItemBuilder::with_id("open", "Open OpenTask").build(app)?;
        let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
        let menu = MenuBuilder::new(app)
            .item(&quick_add)
            .item(&open)
            .separator()
            .item(&quit)
            .build()?;
        builder
            .menu(&menu)
            .show_menu_on_left_click(true)
            .on_menu_event(|app, event| match event.id().as_ref() {
                "quickadd" => toggle_quickadd_centered(app),
                "open" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
                "quit" => app.exit(0),
                _ => {}
            })
    };

    #[cfg(not(target_os = "linux"))]
    let builder = builder
        .show_menu_on_left_click(false)
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
        });

    builder.build(app)?;
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
        note_summon_origin(app);
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.emit(QUICKADD_SUMMONED_EVENT, ());
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
            dismiss_quickadd,
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
