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
use tauri_plugin_window_state::StateFlags;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        // Do not restore visibility. The window stays hidden until zoom is applied,
        // and a saved "visible" flag would show the default zoom first.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all().difference(StateFlags::VISIBLE))
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
        ])
        .setup(|app| {
            let process_arg: Vec<String> = env::args().collect();
            if process_arg.contains(&"--debug".to_string()) {
                // in prod build, if --debug is passed, open devtools
                app.get_webview_window("main").unwrap().open_devtools();
            }

            // open devtools in dev build anyway
            #[cfg(debug_assertions)]
            app.get_webview_window("main").unwrap().open_devtools();

            // The page applies the saved zoom, then shows the window.
            // If that never happens, show it anyway so startup cannot hide the app forever.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(2000));
                let Some(window) = handle.get_webview_window("main") else {
                    return;
                };
                match window.is_visible() {
                    Ok(true) => {}
                    Ok(false) => {
                        if let Err(error) = window.show() {
                            eprintln!(
                                "Showing the window after the startup fallback failed: {error}"
                            );
                        }
                    }
                    Err(error) => {
                        eprintln!("Could not read window visibility during startup: {error}");
                        let _ = window.show();
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
