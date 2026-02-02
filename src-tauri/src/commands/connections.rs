//! Connection management commands.
//!
//! Handles saving, loading, testing, establishing, and closing database connections.

use tauri_plugin_store::StoreExt;
use uuid::Uuid;

use crate::drivers::{DatabaseDriver, DriverConnection};
use crate::state::AppState;
use crate::types::ConnectionConfig;

/// Save a connection configuration to persistent storage.
#[tauri::command]
pub fn save_connection(
    app_handle: tauri::AppHandle,
    mut connection: ConnectionConfig,
) -> Result<String, String> {
    let store = app_handle
        .store("connections.json")
        .map_err(|e| e.to_string())?;

    let id = connection
        .id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    connection.id = Some(id.clone());

    let value = serde_json::to_value(&connection).map_err(|e| e.to_string())?;

    store.set(id.clone(), value);
    store.save().map_err(|e| e.to_string())?;

    Ok(id)
}

/// Get all saved connections from persistent storage.
#[tauri::command]
pub fn get_connections(app_handle: tauri::AppHandle) -> Result<Vec<ConnectionConfig>, String> {
    let store = app_handle
        .store("connections.json")
        .map_err(|e| e.to_string())?;

    let mut connections = Vec::new();

    for (_, value) in store.entries() {
        if let Ok(conn) = serde_json::from_value::<ConnectionConfig>(value.clone()) {
            connections.push(conn);
        }
    }
    connections.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(connections)
}

/// Get a single connection by ID.
#[tauri::command]
pub fn get_connection(app_handle: tauri::AppHandle, id: String) -> Result<ConnectionConfig, String> {
    let store = app_handle
        .store("connections.json")
        .map_err(|e| e.to_string())?;

    let value = store.get(id).ok_or("Connection not found")?;
    let conn = serde_json::from_value(value).map_err(|e| e.to_string())?;
    Ok(conn)
}

/// Delete a connection from storage and close any active connection.
#[tauri::command]
pub fn delete_connection(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let store = app_handle
        .store("connections.json")
        .map_err(|e| e.to_string())?;

    store.delete(id.clone());
    store.save().map_err(|e| e.to_string())?;

    // Remove from active connections if exists
    let mut connections = state.connections.lock().unwrap();
    if let Some(conn) = connections.remove(&id) {
        // Connection is dropped here - async close happens when all refs drop
        // For explicitly closing, we could spawn an async task
        let _ = conn;
    }

    Ok(())
}

/// Test a connection without establishing a persistent connection.
#[tauri::command]
pub async fn test_connection(connection: ConnectionConfig) -> Result<String, String> {
    DriverConnection::test(&connection).await
}

/// Establish a persistent connection to a database.
#[tauri::command]
pub async fn establish_connection(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    id: String,
) -> Result<String, String> {
    // 1. Get config from Store
    let store = app_handle
        .store("connections.json")
        .map_err(|e| e.to_string())?;
    let value = store.get(id.clone()).ok_or("Connection not found")?;
    let config: ConnectionConfig = serde_json::from_value(value).map_err(|e| e.to_string())?;

    // 2. Connect using the appropriate driver
    let driver_conn = DriverConnection::connect(&config).await?;

    // 3. Store connection in State
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
