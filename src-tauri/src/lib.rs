//! Waterfowl - A cross-platform database management GUI.
//!
//! This is the main entry point for the Tauri application.
//! The codebase is organized as follows:
//!
//! - `types.rs` - Shared data structures (ConnectionConfig, QueryResult, etc.)
//! - `state.rs` - Application state management
//! - `commands/` - Tauri command handlers
//!   - `connections.rs` - Connection CRUD operations
//!   - `queries.rs` - Query execution and schema introspection
//! - `drivers/` - Database driver implementations
//!   - `mod.rs` - Driver trait and connection enum
//!   - `postgres/` - PostgreSQL driver
//!
//! To add support for a new database (e.g., MySQL):
//! 1. Create `drivers/mysql/mod.rs` implementing `DatabaseDriver`
//! 2. Add `MySQL(MySqlDriver)` variant to `DriverConnection` enum
//! 3. Update `DriverConnection::connect()` and `DriverConnection::test()`

mod commands;
mod drivers;
mod exporters;
mod state;
mod types;

use state::AppState;
use std::env;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_window_state::{StateFlags, WindowExt};

/// Show the window, then restore maximized or fullscreen.
/// Doing that earlier shows the window through the platform maximize call,
/// before the page has applied the saved zoom.
fn present_main_window(window: &tauri::WebviewWindow) {
    if let Err(error) = window.show() {
        eprintln!("Showing the window failed: {error}");
    }
    if let Err(error) = window.restore_state(StateFlags::MAXIMIZED | StateFlags::FULLSCREEN) {
        eprintln!("Restoring maximized or fullscreen state failed: {error}");
    }
}

#[tauri::command]
fn reveal_main_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window is missing".to_string())?;
    present_main_window(&window);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        // Save every flag except visibility. Skip the automatic restore so a
        // saved maximized state cannot show the window before zoom is applied.
        // setup restores size and position while the window is still hidden.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all().difference(StateFlags::VISIBLE))
                .skip_initial_state("main")
                .build(),
        )
        .manage(AppState::new())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            // Connection commands
            commands::test_connection,
            commands::establish_connection,
            commands::close_connection,
            // Query commands
            commands::get_schemas,
            commands::get_tables,
            commands::get_table_data,
            commands::get_filtered_table_data,
            commands::get_view_data,
            commands::get_database_info,
            commands::get_schema_objects,
            commands::get_function_info,
            commands::get_sequence_info,
            commands::get_table_structure,
            commands::get_enum_values,
            commands::execute_query,
            commands::execute_script,
            commands::open_session,
            commands::close_session,
            // Export commands
            commands::export_table_streaming,
            commands::cancel_export,
            commands::write_text_file,
            reveal_main_window,
        ])
        .setup(|app| {
            let process_arg: Vec<String> = env::args().collect();
            let window = app.get_webview_window("main").unwrap();
            if process_arg.contains(&"--debug".to_string()) {
                // in prod build, if --debug is passed, open devtools
                window.open_devtools();
            }

            // open devtools in dev build anyway
            #[cfg(debug_assertions)]
            window.open_devtools();

            if let Err(error) = window.restore_state(
                StateFlags::SIZE | StateFlags::POSITION | StateFlags::DECORATIONS,
            ) {
                eprintln!("Restoring window size and position failed: {error}");
            }

            // The page applies the saved zoom, then reveals the window.
            // If that never happens, reveal it anyway so startup cannot hide the app forever.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(2000));
                let Some(window) = handle.get_webview_window("main") else {
                    return;
                };
                match window.is_visible() {
                    Ok(true) => {}
                    Ok(false) => present_main_window(&window),
                    Err(error) => {
                        eprintln!("Could not read window visibility during startup: {error}");
                        present_main_window(&window);
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
