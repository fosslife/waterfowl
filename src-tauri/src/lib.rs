use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::postgres::{PgPool, PgPoolOptions};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_store::StoreExt;
use uuid::Uuid;

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
fn get_connection(app_handle: tauri::AppHandle, id: String) -> Result<ConnectionConfig, String> {
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
    id: String,
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
    id: String,
) -> Result<String, String> {
    // 1. Get config from Store
    let store = app_handle
        .store("connections.json")
        .map_err(|e| e.to_string())?;
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

use serde_json::{Map, Value};
use sqlx::{postgres::PgRow, Column, TypeInfo, ValueRef};

/// Decodes a PostgreSQL value to a serde_json::Value based on its type.
/// Handles all common PostgreSQL data types for display in the UI.
fn decode_pg_value(row: &PgRow, ordinal: usize, type_name: &str) -> Value {
    match type_name {
        // ===== Boolean =====
        "BOOL" => {
            let b: bool = row.get(ordinal);
            Value::Bool(b)
        }

        // ===== Integer types =====
        "INT2" | "SMALLINT" | "SMALLSERIAL" => {
            let i: i16 = row.get(ordinal);
            json!(i)
        }
        "INT4" | "INTEGER" | "SERIAL" => {
            let i: i32 = row.get(ordinal);
            json!(i)
        }
        "INT8" | "BIGINT" | "BIGSERIAL" => {
            let i: i64 = row.get(ordinal);
            json!(i)
        }
        "OID" => {
            // OID is internally an i32 in sqlx for Postgres
            let i: i32 = row.get(ordinal);
            json!(i)
        }

        // ===== Float types =====
        "FLOAT4" | "REAL" => {
            let f: f32 = row.get(ordinal);
            json!(f)
        }
        "FLOAT8" | "DOUBLE PRECISION" => {
            let f: f64 = row.get(ordinal);
            json!(f)
        }

        // ===== Numeric/Decimal =====
        "NUMERIC" | "DECIMAL" => match row.try_get::<sqlx::types::BigDecimal, _>(ordinal) {
            Ok(d) => Value::String(d.to_string()),
            Err(_) => Value::String("[NUMERIC]".to_string()),
        },

        // ===== Money =====
        "MONEY" => {
            // Money is stored as i64 cents, we decode via PgMoney
            match row.try_get::<sqlx::postgres::types::PgMoney, _>(ordinal) {
                Ok(m) => Value::String(format!("${:.2}", m.0 as f64 / 100.0)),
                Err(_) => Value::String("[MONEY]".to_string()),
            }
        }

        // ===== Text types =====
        "TEXT" | "VARCHAR" | "CHAR" | "BPCHAR" | "NAME" | "UNKNOWN" => {
            let s: String = row.get(ordinal);
            Value::String(s)
        }

        // ===== Binary =====
        "BYTEA" => {
            let bytes: Vec<u8> = row.get(ordinal);
            if bytes.len() > 100 {
                Value::String(format!(
                    "\\x{}... ({} bytes)",
                    hex::encode(&bytes[..50]),
                    bytes.len()
                ))
            } else {
                Value::String(format!("\\x{}", hex::encode(&bytes)))
            }
        }

        // ===== JSON types =====
        "JSON" | "JSONB" => {
            let v: Value = row.get(ordinal);
            v
        }

        // ===== UUID =====
        "UUID" => {
            let u: uuid::Uuid = row.get(ordinal);
            Value::String(u.to_string())
        }

        // ===== Date/Time types =====
        "DATE" => {
            let d: chrono::NaiveDate = row.get(ordinal);
            Value::String(d.to_string())
        }
        "TIME" => {
            let t: chrono::NaiveTime = row.get(ordinal);
            Value::String(t.to_string())
        }
        "TIMETZ" => {
            // Time with timezone - decode as PgTimeTz
            match row.try_get::<sqlx::postgres::types::PgTimeTz, _>(ordinal) {
                Ok(t) => {
                    Value::String(format!("{}{:+}", t.time, t.offset.local_minus_utc() / 3600))
                }
                Err(_) => Value::String("[TIMETZ]".to_string()),
            }
        }
        "TIMESTAMP" => {
            let ts: chrono::NaiveDateTime = row.get(ordinal);
            Value::String(ts.to_string())
        }
        "TIMESTAMPTZ" => {
            let ts: chrono::DateTime<chrono::Utc> = row.get(ordinal);
            Value::String(ts.to_rfc3339())
        }
        "INTERVAL" => match row.try_get::<sqlx::postgres::types::PgInterval, _>(ordinal) {
            Ok(interval) => {
                let mut parts = Vec::new();
                if interval.months != 0 {
                    let years = interval.months / 12;
                    let months = interval.months % 12;
                    if years != 0 {
                        parts.push(format!(
                            "{} year{}",
                            years,
                            if years.abs() != 1 { "s" } else { "" }
                        ));
                    }
                    if months != 0 {
                        parts.push(format!(
                            "{} mon{}",
                            months,
                            if months.abs() != 1 { "s" } else { "" }
                        ));
                    }
                }
                if interval.days != 0 {
                    parts.push(format!(
                        "{} day{}",
                        interval.days,
                        if interval.days.abs() != 1 { "s" } else { "" }
                    ));
                }
                if interval.microseconds != 0 {
                    let total_secs = interval.microseconds / 1_000_000;
                    let hours = total_secs / 3600;
                    let mins = (total_secs % 3600) / 60;
                    let secs = total_secs % 60;
                    let micros = interval.microseconds % 1_000_000;
                    if hours != 0 || mins != 0 || secs != 0 || micros != 0 {
                        if micros != 0 {
                            parts.push(format!(
                                "{:02}:{:02}:{:02}.{:06}",
                                hours, mins, secs, micros
                            ));
                        } else {
                            parts.push(format!("{:02}:{:02}:{:02}", hours, mins, secs));
                        }
                    }
                }
                if parts.is_empty() {
                    Value::String("00:00:00".to_string())
                } else {
                    Value::String(parts.join(" "))
                }
            }
            Err(_) => Value::String("[INTERVAL]".to_string()),
        },

        // ===== Network types =====
        "INET" => match row.try_get::<ipnetwork::IpNetwork, _>(ordinal) {
            Ok(ip) => Value::String(ip.to_string()),
            Err(_) => Value::String("[INET]".to_string()),
        },
        "CIDR" => match row.try_get::<ipnetwork::IpNetwork, _>(ordinal) {
            Ok(ip) => Value::String(ip.to_string()),
            Err(_) => Value::String("[CIDR]".to_string()),
        },
        "MACADDR" => match row.try_get::<mac_address::MacAddress, _>(ordinal) {
            Ok(mac) => Value::String(mac.to_string()),
            Err(_) => Value::String("[MACADDR]".to_string()),
        },
        "MACADDR8" => {
            // MACADDR8 might not have direct support, try as bytes
            match row.try_get::<mac_address::MacAddress, _>(ordinal) {
                Ok(mac) => Value::String(mac.to_string()),
                Err(_) => Value::String("[MACADDR8]".to_string()),
            }
        }

        // ===== Geometric types =====
        "POINT" => match row.try_get::<sqlx::postgres::types::PgPoint, _>(ordinal) {
            Ok(p) => Value::String(format!("({},{})", p.x, p.y)),
            Err(_) => Value::String("[POINT]".to_string()),
        },
        "LINE" => {
            // LINE is stored as {A,B,C} representing Ax + By + C = 0
            // sqlx doesn't have a built-in type, decode raw
            decode_pg_raw_text(row, ordinal, "LINE")
        }
        "LSEG" => decode_pg_raw_text(row, ordinal, "LSEG"),
        "BOX" => match row.try_get::<sqlx::postgres::types::PgBox, _>(ordinal) {
            Ok(b) => Value::String(format!(
                "(({},{}),({},{}))",
                b.upper_right_x, b.upper_right_y, b.lower_left_x, b.lower_left_y
            )),
            Err(_) => decode_pg_raw_text(row, ordinal, "BOX"),
        },
        "PATH" => decode_pg_raw_text(row, ordinal, "PATH"),
        "POLYGON" => decode_pg_raw_text(row, ordinal, "POLYGON"),
        "CIRCLE" => decode_pg_raw_text(row, ordinal, "CIRCLE"),

        // ===== Range types =====
        "INT4RANGE" => match row.try_get::<sqlx::postgres::types::PgRange<i32>, _>(ordinal) {
            Ok(r) => format_pg_range(&r),
            Err(_) => Value::String("[INT4RANGE]".to_string()),
        },
        "INT8RANGE" => match row.try_get::<sqlx::postgres::types::PgRange<i64>, _>(ordinal) {
            Ok(r) => format_pg_range(&r),
            Err(_) => Value::String("[INT8RANGE]".to_string()),
        },
        "NUMRANGE" => {
            match row.try_get::<sqlx::postgres::types::PgRange<sqlx::types::BigDecimal>, _>(ordinal)
            {
                Ok(r) => format_pg_range_decimal(&r),
                Err(_) => Value::String("[NUMRANGE]".to_string()),
            }
        }
        "DATERANGE" => {
            match row.try_get::<sqlx::postgres::types::PgRange<chrono::NaiveDate>, _>(ordinal) {
                Ok(r) => format_pg_range(&r),
                Err(_) => Value::String("[DATERANGE]".to_string()),
            }
        }
        "TSRANGE" => {
            match row.try_get::<sqlx::postgres::types::PgRange<chrono::NaiveDateTime>, _>(ordinal) {
                Ok(r) => format_pg_range(&r),
                Err(_) => Value::String("[TSRANGE]".to_string()),
            }
        }
        "TSTZRANGE" => {
            match row.try_get::<sqlx::postgres::types::PgRange<chrono::DateTime<chrono::Utc>>, _>(
                ordinal,
            ) {
                Ok(r) => format_pg_range(&r),
                Err(_) => Value::String("[TSTZRANGE]".to_string()),
            }
        }

        // ===== Bit string types =====
        "BIT" | "VARBIT" => {
            // BitVec requires the "bit-vec" feature, use raw text decode instead
            decode_pg_raw_text(row, ordinal, type_name)
        }

        // ===== Text search types =====
        "TSVECTOR" => decode_pg_raw_text(row, ordinal, "TSVECTOR"),
        "TSQUERY" => decode_pg_raw_text(row, ordinal, "TSQUERY"),

        // ===== XML =====
        "XML" => match row.try_get::<String, _>(ordinal) {
            Ok(s) => Value::String(s),
            Err(_) => Value::String("[XML]".to_string()),
        },

        // ===== Array types =====
        "_BOOL" => {
            let arr: Vec<bool> = row.get(ordinal);
            json!(arr)
        }
        "_INT2" => {
            let arr: Vec<i16> = row.get(ordinal);
            json!(arr)
        }
        "_INT4" => {
            let arr: Vec<i32> = row.get(ordinal);
            json!(arr)
        }
        "_INT8" => {
            let arr: Vec<i64> = row.get(ordinal);
            json!(arr)
        }
        "_FLOAT4" => {
            let arr: Vec<f32> = row.get(ordinal);
            json!(arr)
        }
        "_FLOAT8" => {
            let arr: Vec<f64> = row.get(ordinal);
            json!(arr)
        }
        "_TEXT" | "_VARCHAR" | "_BPCHAR" | "_NAME" => {
            let arr: Vec<String> = row.get(ordinal);
            json!(arr)
        }
        "_UUID" => {
            let arr: Vec<uuid::Uuid> = row.get(ordinal);
            let strings: Vec<String> = arr.iter().map(|u| u.to_string()).collect();
            json!(strings)
        }
        "_JSONB" | "_JSON" => {
            let arr: Vec<Value> = row.get(ordinal);
            json!(arr)
        }
        "_INET" => match row.try_get::<Vec<ipnetwork::IpNetwork>, _>(ordinal) {
            Ok(arr) => {
                let strings: Vec<String> = arr.iter().map(|ip| ip.to_string()).collect();
                json!(strings)
            }
            Err(_) => Value::String("[INET[]]".to_string()),
        },
        "_DATE" => {
            let arr: Vec<chrono::NaiveDate> = row.get(ordinal);
            let strings: Vec<String> = arr.iter().map(|d| d.to_string()).collect();
            json!(strings)
        }
        "_TIMESTAMP" => {
            let arr: Vec<chrono::NaiveDateTime> = row.get(ordinal);
            let strings: Vec<String> = arr.iter().map(|ts| ts.to_string()).collect();
            json!(strings)
        }
        "_TIMESTAMPTZ" => {
            let arr: Vec<chrono::DateTime<chrono::Utc>> = row.get(ordinal);
            let strings: Vec<String> = arr.iter().map(|ts| ts.to_rfc3339()).collect();
            json!(strings)
        }

        // ===== Custom ENUMs and unknown types =====
        // ENUMs in PostgreSQL are returned as strings
        _ => {
            // First try to decode as String (works for ENUMs and many other types)
            match row.try_get::<String, _>(ordinal) {
                Ok(s) => Value::String(s),
                Err(_) => {
                    // Try raw text decode as last resort
                    decode_pg_raw_text(row, ordinal, type_name)
                }
            }
        }
    }
}

/// Attempts to decode a PostgreSQL value by getting its raw bytes in text format
fn decode_pg_raw_text(row: &PgRow, ordinal: usize, type_name: &str) -> Value {
    use sqlx::postgres::PgValueFormat;

    match row.try_get_raw(ordinal) {
        Ok(value_ref) => {
            // Check if we can get the raw bytes
            match value_ref.format() {
                PgValueFormat::Text => {
                    // Text format - we can convert directly to string
                    match value_ref.as_bytes() {
                        Ok(bytes) => match std::str::from_utf8(bytes) {
                            Ok(s) => Value::String(s.to_string()),
                            Err(_) => Value::String(format!("[{} - invalid UTF-8]", type_name)),
                        },
                        Err(_) => Value::String(format!("[{}]", type_name)),
                    }
                }
                PgValueFormat::Binary => {
                    // Binary format - show hex representation for unknown types
                    match value_ref.as_bytes() {
                        Ok(bytes) if bytes.len() <= 100 => {
                            Value::String(format!("[{}: \\x{}]", type_name, hex::encode(bytes)))
                        }
                        Ok(bytes) => {
                            Value::String(format!("[{}: {} bytes]", type_name, bytes.len()))
                        }
                        Err(_) => Value::String(format!("[{}]", type_name)),
                    }
                }
            }
        }
        Err(_) => Value::String(format!("[{}]", type_name)),
    }
}

/// Formats a PgRange into a human-readable string
fn format_pg_range<T: std::fmt::Display>(range: &sqlx::postgres::types::PgRange<T>) -> Value {
    use std::ops::Bound;

    let start = match &range.start {
        Bound::Included(v) => format!("[{}", v),
        Bound::Excluded(v) => format!("({}", v),
        Bound::Unbounded => "(".to_string(),
    };

    let end = match &range.end {
        Bound::Included(v) => format!("{}]", v),
        Bound::Excluded(v) => format!("{})", v),
        Bound::Unbounded => ")".to_string(),
    };

    Value::String(format!("{},{}", start, end))
}

/// Formats a PgRange of BigDecimal
fn format_pg_range_decimal(
    range: &sqlx::postgres::types::PgRange<sqlx::types::BigDecimal>,
) -> Value {
    use std::ops::Bound;

    let start = match &range.start {
        Bound::Included(v) => format!("[{}", v),
        Bound::Excluded(v) => format!("({}", v),
        Bound::Unbounded => "(".to_string(),
    };

    let end = match &range.end {
        Bound::Included(v) => format!("{}]", v),
        Bound::Excluded(v) => format!("{})", v),
        Bound::Unbounded => ")".to_string(),
    };

    Value::String(format!("{},{}", start, end))
}

#[tauri::command]
async fn get_schemas(state: tauri::State<'_, AppState>, id: String) -> Result<Vec<String>, String> {
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
        "#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let schemas: Vec<String> = rows
        .iter()
        .map(|r| r.get::<String, _>("schema_name"))
        .collect();
    Ok(schemas)
}

#[tauri::command]
async fn get_tables(
    state: tauri::State<'_, AppState>,
    id: String,
    schema: Option<String>,
) -> Result<Vec<String>, String> {
    let pool = {
        let pools = state.pools.lock().unwrap();
        pools.get(&id).cloned().ok_or("Not connected")?
    };

    let schema_name = schema.unwrap_or_else(|| "public".to_string());

    let rows =
        sqlx::query("SELECT table_name FROM information_schema.tables WHERE table_schema = $1")
            .bind(&schema_name)
            .fetch_all(&pool)
            .await
            .map_err(|e| e.to_string())?;

    let tables: Vec<String> = rows
        .iter()
        .map(|r| r.get::<String, _>("table_name"))
        .collect();
    Ok(tables)
}

#[derive(Serialize)]
pub struct ColumnInfo {
    pub name: String,
    pub pg_type: String,
}

#[derive(Serialize)]
pub struct PaginatedTableData {
    pub rows: Vec<Map<String, Value>>,
    pub total_count: i64,
    pub columns: Vec<ColumnInfo>,
}

#[tauri::command]
async fn get_table_data(
    state: tauri::State<'_, AppState>,
    id: String,
    table: String,
    schema: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<PaginatedTableData, String> {
    let pool = {
        let pools = state.pools.lock().unwrap();
        pools.get(&id).cloned().ok_or("Not connected")?
    };

    let schema_name = schema.unwrap_or_else(|| "public".to_string());
    let limit_val = limit.unwrap_or(100);
    let offset_val = offset.unwrap_or(0);

    // Sanitize table and schema names (very basic)
    // In production, use proper escaping or check against known tables logic
    if !table.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return Err("Invalid table name".to_string());
    }
    if !schema_name.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return Err("Invalid schema name".to_string());
    }

    // Get total count
    let count_row = sqlx::query(&format!(
        "SELECT COUNT(*) FROM \"{}\".\"{}\"",
        schema_name, table
    ))
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?;
    let total_count: i64 = count_row.get(0);

    // Fetch paginated data
    let rows = sqlx::query(&format!(
        "SELECT * FROM \"{}\".\"{}\" LIMIT {} OFFSET {}",
        schema_name, table, limit_val, offset_val
    ))
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    let mut columns_info = Vec::new();

    // Extract column metadata from the first row (or from the query result columns)
    if let Some(first_row) = rows.first() {
        for col in first_row.columns() {
            columns_info.push(ColumnInfo {
                name: col.name().to_string(),
                pg_type: col.type_info().name().to_string(),
            });
        }
    }

    for row in rows {
        let mut map = Map::new();
        for col in row.columns() {
            let col_name = col.name();
            let value_ref = row.try_get_raw(col.ordinal()).unwrap();

            let val = if value_ref.is_null() {
                Value::Null
            } else {
                let type_name = col.type_info().name();
                decode_pg_value(&row, col.ordinal(), type_name)
            };
            map.insert(col_name.to_string(), val);
        }
        results.push(map);
    }

    Ok(PaginatedTableData {
        rows: results,
        total_count,
        columns: columns_info,
    })
}

#[tauri::command]
async fn get_database_info(
    state: tauri::State<'_, AppState>,
    id: String,
    schema: Option<String>,
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

    let views_row =
        sqlx::query("SELECT COUNT(*) FROM information_schema.views WHERE table_schema = $1")
            .bind(&schema_name)
            .fetch_one(&pool)
            .await
            .map_err(|e| e.to_string())?;
    let total_views: i64 = views_row.get(0);

    let functions_row =
        sqlx::query("SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = $1")
            .bind(&schema_name)
            .fetch_one(&pool)
            .await
            .map_err(|e| e.to_string())?;
    let total_functions: i64 = functions_row.get(0);

    let sequences_row =
        sqlx::query("SELECT COUNT(*) FROM information_schema.sequences WHERE sequence_schema = $1")
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
    schema: Option<String>,
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

    let tables: Vec<SchemaObject> = table_rows
        .iter()
        .map(|r| SchemaObject {
            name: r.get("table_name"),
            object_type: "table".to_string(),
            row_count: r.try_get::<i64, _>("row_estimate").ok(),
            size: r.try_get::<String, _>("size").ok(),
        })
        .collect();

    // Get views
    let view_rows = sqlx::query(
        "SELECT table_name FROM information_schema.views WHERE table_schema = $1 ORDER BY table_name"
    )
    .bind(&schema_name)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let views: Vec<SchemaObject> = view_rows
        .iter()
        .map(|r| SchemaObject {
            name: r.get("table_name"),
            object_type: "view".to_string(),
            row_count: None,
            size: None,
        })
        .collect();

    // Get functions
    let function_rows = sqlx::query(
        "SELECT routine_name FROM information_schema.routines WHERE routine_schema = $1 ORDER BY routine_name"
    )
    .bind(&schema_name)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let functions: Vec<SchemaObject> = function_rows
        .iter()
        .map(|r| SchemaObject {
            name: r.get("routine_name"),
            object_type: "function".to_string(),
            row_count: None,
            size: None,
        })
        .collect();

    // Get sequences
    let sequence_rows = sqlx::query(
        "SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = $1 ORDER BY sequence_name"
    )
    .bind(&schema_name)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let sequences: Vec<SchemaObject> = sequence_rows
        .iter()
        .map(|r| SchemaObject {
            name: r.get("sequence_name"),
            object_type: "sequence".to_string(),
            row_count: None,
            size: None,
        })
        .collect();

    Ok(SchemaObjects {
        tables,
        views,
        functions,
        sequences,
    })
}

#[tauri::command]
async fn close_connection(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let pool = {
        let mut pools = state.pools.lock().unwrap();
        pools.remove(&id)
    };

    if let Some(pool) = pool {
        pool.close().await;
    }

    Ok(())
}

#[derive(Serialize)]
pub struct QueryResult {
    pub rows: Vec<Map<String, Value>>,
    pub columns: Vec<ColumnInfo>,
    pub rows_affected: u64,
    pub execution_time_ms: u128,
}

#[tauri::command]
async fn execute_query(
    state: tauri::State<'_, AppState>,
    id: String,
    query: String,
) -> Result<QueryResult, String> {
    let pool = {
        let pools = state.pools.lock().unwrap();
        pools.get(&id).cloned().ok_or("Not connected")?
    };

    let start_time = std::time::Instant::now();

    // Execute the query
    let rows = sqlx::query(&query)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let execution_time_ms = start_time.elapsed().as_millis();

    let mut results = Vec::new();
    let mut columns_info = Vec::new();

    // Extract column metadata from the first row
    if let Some(first_row) = rows.first() {
        for col in first_row.columns() {
            columns_info.push(ColumnInfo {
                name: col.name().to_string(),
                pg_type: col.type_info().name().to_string(),
            });
        }
    }

    for row in &rows {
        let mut map = Map::new();
        for col in row.columns() {
            let col_name = col.name();
            let value_ref = row.try_get_raw(col.ordinal()).unwrap();

            let val = if value_ref.is_null() {
                Value::Null
            } else {
                let type_name = col.type_info().name();
                decode_pg_value(row, col.ordinal(), type_name)
            };
            map.insert(col_name.to_string(), val);
        }
        results.push(map);
    }

    Ok(QueryResult {
        rows: results,
        columns: columns_info,
        rows_affected: rows.len() as u64,
        execution_time_ms,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
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
            close_connection,
            execute_query
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
