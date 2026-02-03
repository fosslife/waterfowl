//! Connection management commands.
//!
//! Handles testing, establishing, and closing database connections.
//! Connection CRUD is handled on the JavaScript side using SQLite.

use crate::drivers::{DatabaseDriver, DriverConnection};
use crate::state::AppState;
use crate::types::ConnectionConfig;

/// Test a connection without establishing a persistent connection.
#[tauri::command]
pub async fn test_connection(connection: ConnectionConfig) -> Result<String, String> {
    DriverConnection::test(&connection).await
}

/// Establish a persistent connection to a database.
/// Takes the connection config directly (no longer fetches from store).
#[tauri::command]
pub async fn establish_connection(
    state: tauri::State<'_, AppState>,
    id: String,
    connection: ConnectionConfig,
) -> Result<String, String> {
    // Connect using the appropriate driver
    let driver_conn = DriverConnection::connect(&connection).await?;

    // Store connection in State
    state.connections.lock().unwrap().insert(id, driver_conn);

    Ok("Connected".to_string())
}

/// Close an active database connection.
#[tauri::command]
pub async fn close_connection(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = {
        let mut connections = state.connections.lock().unwrap();
        connections.remove(&id)
    };

    if let Some(conn) = conn {
        conn.close().await;
    }

    Ok(())
}
