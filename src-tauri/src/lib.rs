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
    #[serde(default = "default_schema")]
    pub default_schema: String,
}

fn default_schema() -> String {
    "public".to_string()
}

struct AppState {
    pools: Mutex<HashMap<String, PgPool>>,
}

#[derive(Serialize)]
struct TableInfo {
    table_name: String,
}

#[derive(Serialize)]
pub struct DatabaseInfo {
    pub version: String,
    pub database_name: String,
    pub database_size: String,
    pub total_tables: i64,
    pub total_views: i64,
    pub total_functions: i64,
    pub total_sequences: i64,
}

#[derive(Serialize)]
pub struct SchemaObject {
    pub name: String,
    pub object_type: String, // "table", "view", "function", "sequence"
    pub row_count: Option<i64>,
    pub size: Option<String>,
}

#[derive(Serialize)]
pub struct SchemaObjects {
    pub tables: Vec<SchemaObject>,
    pub views: Vec<SchemaObject>,
    pub functions: Vec<SchemaObject>,
    pub sequences: Vec<SchemaObject>,
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
fn get_connection(
    app_handle: tauri::AppHandle,
    id: String
) -> Result<ConnectionConfig, String> {
    let store = app_handle
        .store("connections.json")
        .map_err(|e| e.to_string())?;

    let value = store.get(id).ok_or("Connection not found")?;
    let conn = serde_json::from_value(value).map_err(|e| e.to_string())?;
    Ok(conn)
}

#[tauri::command]
fn delete_connection(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    id: String
) -> Result<(), String> {
    let store = app_handle
        .store("connections.json")
        .map_err(|e| e.to_string())?;

    store.delete(id.clone());
    store.save().map_err(|e| e.to_string())?;

    // Remove from active pools if exists
    let mut pools = state.pools.lock().unwrap();
    if let Some(pool) = pools.remove(&id) {
        // Pool is dropped effectively here (async close happens when all refs drop)
        // We can't await close() here easily in sync fn without block_on, 
        // but dropping usually suffices for eventual cleanup or let tokio handle it.
        // For explicitly closing: 
        // tauri::async_runtime::spawn(async move { pool.close().await; });
        let _ = pool; 
    }

    Ok(())
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

use sqlx::{Column, TypeInfo, ValueRef};
use serde_json::{Map, Value};

#[tauri::command]
async fn get_schemas(
    state: tauri::State<'_, AppState>,
    id: String
) -> Result<Vec<String>, String> {
    let pool = {
        let pools = state.pools.lock().unwrap();
        pools.get(&id).cloned().ok_or("Not connected")?
    };

    let rows = sqlx::query(
        r#"
        SELECT schema_name 
        FROM information_schema.schemata 
        WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ORDER BY 
            CASE WHEN schema_name = 'public' THEN 0 ELSE 1 END,
            schema_name
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let schemas: Vec<String> = rows.iter().map(|r| r.get::<String, _>("schema_name")).collect();
    Ok(schemas)
}

#[tauri::command]
async fn get_tables(
    state: tauri::State<'_, AppState>,
    id: String,
    schema: Option<String>
) -> Result<Vec<String>, String> {
    let pool = {
        let pools = state.pools.lock().unwrap();
        pools.get(&id).cloned().ok_or("Not connected")?
    };

    let schema_name = schema.unwrap_or_else(|| "public".to_string());

    let rows = sqlx::query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = $1"
    )
    .bind(&schema_name)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let tables: Vec<String> = rows.iter().map(|r| r.get::<String, _>("table_name")).collect();
    Ok(tables)
}

#[tauri::command]
async fn get_table_data(
    state: tauri::State<'_, AppState>,
    id: String,
    table: String,
    schema: Option<String>
) -> Result<Vec<Map<String, Value>>, String> {
    let pool = {
        let pools = state.pools.lock().unwrap();
        pools.get(&id).cloned().ok_or("Not connected")?
    };

    let schema_name = schema.unwrap_or_else(|| "public".to_string());

    // Sanitize table and schema names (very basic)
    // In production, use proper escaping or check against known tables logic
    if !table.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return Err("Invalid table name".to_string());
    }
    if !schema_name.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return Err("Invalid schema name".to_string());
    }

    let rows = sqlx::query(&format!("SELECT * FROM \"{}\".\"{}\" LIMIT 100", schema_name, table))
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();

    for row in rows {
        let mut map = Map::new();
        for col in row.columns() {
            let col_name = col.name();
            let value_ref = row.try_get_raw(col.ordinal()).unwrap();
            
            let val = if value_ref.is_null() {
                Value::Null
            } else {
                let type_name = col.type_info().name();
                match type_name {
                    "BOOL" => Value::Bool(row.get(col.ordinal())),
                    "INT4" | "INT8" | "INT2" => {
                        let i: i64 = row.get(col.ordinal());
                        json!(i)
                    },
                    "FLOAT4" | "FLOAT8" => {
                        let f: f64 = row.get(col.ordinal());
                        json!(f)
                    },
                    "TEXT" | "VARCHAR" | "CHAR" | "NAME" => {
                        let s: String = row.get(col.ordinal());
                        Value::String(s)
                    },
                    "JSON" | "JSONB" => {
                        let v: Value = row.get(col.ordinal());
                        v
                    },
                    "UUID" => {
                         let u: uuid::Uuid = row.get(col.ordinal());
                         Value::String(u.to_string())
                    }
                    _ => {
                        Value::String(format!("[{}]", type_name))
                    }
                }
            };
            map.insert(col_name.to_string(), val);
        }
        results.push(map);
    }

    Ok(results)
}

#[tauri::command]
async fn get_database_info(
    state: tauri::State<'_, AppState>,
    id: String,
    schema: Option<String>
) -> Result<DatabaseInfo, String> {
    let pool = {
        let pools = state.pools.lock().unwrap();
        pools.get(&id).cloned().ok_or("Not connected")?
    };

    let schema_name = schema.unwrap_or_else(|| "public".to_string());

    // Get PostgreSQL version
    let version_row = sqlx::query("SELECT version()")
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let version: String = version_row.get(0);

    // Get current database name
    let db_row = sqlx::query("SELECT current_database()")
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let database_name: String = db_row.get(0);

    // Get database size
    let size_row = sqlx::query("SELECT pg_size_pretty(pg_database_size(current_database()))")
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let database_size: String = size_row.get(0);

    // Get counts for the specified schema
    let tables_row = sqlx::query(
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'"
    )
    .bind(&schema_name)
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?;
    let total_tables: i64 = tables_row.get(0);

    let views_row = sqlx::query(
        "SELECT COUNT(*) FROM information_schema.views WHERE table_schema = $1"
    )
    .bind(&schema_name)
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?;
    let total_views: i64 = views_row.get(0);

    let functions_row = sqlx::query(
        "SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = $1"
    )
    .bind(&schema_name)
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?;
    let total_functions: i64 = functions_row.get(0);

    let sequences_row = sqlx::query(
        "SELECT COUNT(*) FROM information_schema.sequences WHERE sequence_schema = $1"
    )
    .bind(&schema_name)
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?;
    let total_sequences: i64 = sequences_row.get(0);

    Ok(DatabaseInfo {
        version,
        database_name,
        database_size,
        total_tables,
        total_views,
        total_functions,
        total_sequences,
    })
}

#[tauri::command]
async fn get_schema_objects(
    state: tauri::State<'_, AppState>,
    id: String,
    schema: Option<String>
) -> Result<SchemaObjects, String> {
    let pool = {
        let pools = state.pools.lock().unwrap();
        pools.get(&id).cloned().ok_or("Not connected")?
    };

    let schema_name = schema.unwrap_or_else(|| "public".to_string());

    // Get tables with row counts and sizes
    let table_rows = sqlx::query(
        r#"
        SELECT 
            t.table_name,
            pg_size_pretty(pg_total_relation_size((quote_ident($1) || '.' || quote_ident(t.table_name))::regclass)) as size,
            (SELECT c.reltuples::bigint 
             FROM pg_class c 
             JOIN pg_namespace n ON n.oid = c.relnamespace 
             WHERE c.relname = t.table_name AND n.nspname = $1) as row_estimate
        FROM information_schema.tables t
        WHERE t.table_schema = $1 AND t.table_type = 'BASE TABLE'
        ORDER BY t.table_name
        "#
    )
    .bind(&schema_name)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let tables: Vec<SchemaObject> = table_rows.iter().map(|r| {
        SchemaObject {
            name: r.get("table_name"),
            object_type: "table".to_string(),
            row_count: r.try_get::<i64, _>("row_estimate").ok(),
            size: r.try_get::<String, _>("size").ok(),
        }
    }).collect();

    // Get views
    let view_rows = sqlx::query(
        "SELECT table_name FROM information_schema.views WHERE table_schema = $1 ORDER BY table_name"
    )
    .bind(&schema_name)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let views: Vec<SchemaObject> = view_rows.iter().map(|r| {
        SchemaObject {
            name: r.get("table_name"),
            object_type: "view".to_string(),
            row_count: None,
            size: None,
        }
    }).collect();

    // Get functions
    let function_rows = sqlx::query(
        "SELECT routine_name FROM information_schema.routines WHERE routine_schema = $1 ORDER BY routine_name"
    )
    .bind(&schema_name)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let functions: Vec<SchemaObject> = function_rows.iter().map(|r| {
        SchemaObject {
            name: r.get("routine_name"),
            object_type: "function".to_string(),
            row_count: None,
            size: None,
        }
    }).collect();

    // Get sequences
    let sequence_rows = sqlx::query(
        "SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = $1 ORDER BY sequence_name"
    )
    .bind(&schema_name)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let sequences: Vec<SchemaObject> = sequence_rows.iter().map(|r| {
        SchemaObject {
            name: r.get("sequence_name"),
            object_type: "sequence".to_string(),
            row_count: None,
            size: None,
        }
    }).collect();

    Ok(SchemaObjects {
        tables,
        views,
        functions,
        sequences,
    })
}

#[tauri::command]
async fn close_connection(
    state: tauri::State<'_, AppState>,
    id: String
) -> Result<(), String> {
    let pool = {
        let mut pools = state.pools.lock().unwrap();
        pools.remove(&id)
    };

    if let Some(pool) = pool {
        pool.close().await;
    }

    Ok(())
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
            get_schemas,
            get_tables,
            get_table_data,
            get_connection,
            delete_connection,
            get_database_info,
            get_schema_objects,
            close_connection
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
