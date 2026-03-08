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
mod state;
mod types;

use state::AppState;
#[cfg(debug_assertions)]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::new().build())
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
            commands::get_view_data,
            commands::get_database_info,
            commands::get_schema_objects,
            commands::get_function_info,
            commands::get_sequence_info,
            commands::get_table_structure,
            commands::execute_query,
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            app.get_webview_window("main").unwrap().open_devtools();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
