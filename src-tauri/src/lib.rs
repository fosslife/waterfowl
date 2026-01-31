use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::Manager;
use tauri_plugin_store::StoreExt;
use uuid::Uuid;
use sqlx::postgres::{PgPoolOptions, PgPool};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ConnectionConfig {
    pub id: Option<String>,
    pub name: String,
    pub host: String,
    pub port: String,
    pub user: String,
    pub password: Option<String>,
    pub database: String,
    pub driver: String,
}

struct AppState {
    pools: Mutex<HashMap<String, PgPool>>,
}

#[derive(Serialize)]
struct TableInfo {
    table_name: String,
}

#[tauri::command]
fn save_connection(
    app_handle: tauri::AppHandle,
    mut connection: ConnectionConfig,
) -> Result<String, String> {
    let store = app_handle
        .store("connections.json")
        .map_err(|e| e.to_string())?;

    let id = connection.id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
    connection.id = Some(id.clone());

    let value = serde_json::to_value(&connection).map_err(|e| e.to_string())?;
    
    store.set(id.clone(), value);
    store.save().map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
fn get_connections(app_handle: tauri::AppHandle) -> Result<Vec<ConnectionConfig>, String> {
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

#[tauri::command]
async fn test_connection(connection: ConnectionConfig) -> Result<String, String> {
    let url = format!(
        "postgres://{}:{}@{}:{}/{}",
        connection.user,
        connection.password.unwrap_or_default(),
        connection.host,
        connection.port,
        connection.database
    );

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .map_err(|e| e.to_string())?;
    
    pool.close().await;
    Ok("Connection successful".to_string())
}

#[tauri::command]
async fn establish_connection(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    id: String
) -> Result<String, String> {
    // 1. Get config from Store
    let store = app_handle.store("connections.json").map_err(|e| e.to_string())?;
    let value = store.get(id.clone()).ok_or("Connection not found")?;
    let config: ConnectionConfig = serde_json::from_value(value).map_err(|e| e.to_string())?;

    // 2. Connect
    let url = format!(
        "postgres://{}:{}@{}:{}/{}",
        config.user,
        config.password.unwrap_or_default(),
        config.host,
        config.port,
        config.database
    );

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&url)
        .await
        .map_err(|e| e.to_string())?;

    // 3. Store pool in State
    state.pools.lock().unwrap().insert(id, pool);

    Ok("Connected".to_string())
}

use sqlx::Row; // Add import

#[tauri::command]
async fn get_tables(
    state: tauri::State<'_, AppState>,
    id: String
) -> Result<Vec<String>, String> {
    let pool = {
        let pools = state.pools.lock().unwrap();
        pools.get(&id).cloned().ok_or("Not connected")?
    };

    let rows = sqlx::query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let tables: Vec<String> = rows.iter().map(|r| r.get::<String, _>("table_name")).collect();
    Ok(tables)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            pools: Mutex::new(HashMap::new()),
        })
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            save_connection,
            get_connections,
            test_connection,
            establish_connection,
            get_tables
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
