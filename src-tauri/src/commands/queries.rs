//! Query and schema commands.
//!
//! Handles database queries, schema introspection, and data retrieval.

use crate::drivers::DatabaseDriver;
use crate::state::AppState;
use crate::types::{
    DatabaseInfo, FunctionInfo, PaginatedTableData, QueryResult, SchemaObjects, SequenceInfo,
    TableStructure,
};

/// Helper to get a cloned connection from state.
/// We clone because we can't hold the mutex lock across await points.
fn get_connection(
    state: &tauri::State<'_, AppState>,
    id: &str,
) -> Result<crate::drivers::DriverConnection, String> {
    let connections = state.connections.lock().unwrap();
    connections
        .get(id)
        .cloned()
        .ok_or_else(|| "Not connected".to_string())
}

/// Get list of schemas in the database.
#[tauri::command]
pub async fn get_schemas(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<Vec<String>, String> {
    let conn = get_connection(&state, &id)?;
    conn.get_schemas().await
}

/// Get list of tables in a schema.
#[tauri::command]
pub async fn get_tables(
    state: tauri::State<'_, AppState>,
    id: String,
    schema: Option<String>,
) -> Result<Vec<String>, String> {
    let schema_name = schema.unwrap_or_else(|| "public".to_string());
    let conn = get_connection(&state, &id)?;
    conn.get_tables(&schema_name).await
}

/// Get paginated data from a table.
#[tauri::command]
pub async fn get_table_data(
    state: tauri::State<'_, AppState>,
    id: String,
    table: String,
    schema: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<PaginatedTableData, String> {
    let schema_name = schema.unwrap_or_else(|| "public".to_string());
    let limit_val = limit.unwrap_or(100);
    let offset_val = offset.unwrap_or(0);

    let conn = get_connection(&state, &id)?;
    conn.get_table_data(&table, &schema_name, limit_val, offset_val)
        .await
}

/// Get paginated data from a view (read-only).
#[tauri::command]
pub async fn get_view_data(
    state: tauri::State<'_, AppState>,
    id: String,
    view: String,
    schema: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<PaginatedTableData, String> {
    let schema_name = schema.unwrap_or_else(|| "public".to_string());
    let limit_val = limit.unwrap_or(100);
    let offset_val = offset.unwrap_or(0);

    let conn = get_connection(&state, &id)?;
    conn.get_view_data(&view, &schema_name, limit_val, offset_val)
        .await
}

/// Get high-level database information.
#[tauri::command]
pub async fn get_database_info(
    state: tauri::State<'_, AppState>,
    id: String,
    schema: Option<String>,
) -> Result<DatabaseInfo, String> {
    let schema_name = schema.unwrap_or_else(|| "public".to_string());
    let conn = get_connection(&state, &id)?;
    conn.get_database_info(&schema_name).await
}

/// Get all objects in a schema (tables, views, functions, sequences).
#[tauri::command]
pub async fn get_schema_objects(
    state: tauri::State<'_, AppState>,
    id: String,
    schema: Option<String>,
) -> Result<SchemaObjects, String> {
    let schema_name = schema.unwrap_or_else(|| "public".to_string());
    let conn = get_connection(&state, &id)?;
    conn.get_schema_objects(&schema_name).await
}

/// Get function definition and metadata.
#[tauri::command]
pub async fn get_function_info(
    state: tauri::State<'_, AppState>,
    id: String,
    function_name: String,
    schema: Option<String>,
) -> Result<FunctionInfo, String> {
    let schema_name = schema.unwrap_or_else(|| "public".to_string());
    let conn = get_connection(&state, &id)?;
    conn.get_function_info(&function_name, &schema_name).await
}

/// Get sequence information.
#[tauri::command]
pub async fn get_sequence_info(
    state: tauri::State<'_, AppState>,
    id: String,
    sequence_name: String,
    schema: Option<String>,
) -> Result<SequenceInfo, String> {
    let schema_name = schema.unwrap_or_else(|| "public".to_string());
    let conn = get_connection(&state, &id)?;
    conn.get_sequence_info(&sequence_name, &schema_name).await
}

/// Get table structure (columns, indexes, constraints).
#[tauri::command]
pub async fn get_table_structure(
    state: tauri::State<'_, AppState>,
    id: String,
    table: String,
    schema: Option<String>,
) -> Result<TableStructure, String> {
    let schema_name = schema.unwrap_or_else(|| "public".to_string());
    let conn = get_connection(&state, &id)?;
    conn.get_table_structure(&table, &schema_name).await
}

/// Execute an arbitrary SQL query.
#[tauri::command]
pub async fn execute_query(
    state: tauri::State<'_, AppState>,
    id: String,
    query: String,
) -> Result<QueryResult, String> {
    let conn = get_connection(&state, &id)?;
    conn.execute_query(&query).await
}
