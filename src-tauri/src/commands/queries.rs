//! Query and schema commands.
//!
//! Handles database queries, schema introspection, and data retrieval.

use crate::drivers::DatabaseDriver;
use crate::state::{AppState, SessionEntry};
use crate::types::{
    ColumnFilter, DatabaseInfo, EnumValues, FunctionInfo, PaginatedTableData, QueryResult,
    SchemaObjects, ScriptResult, ScriptStatementResult, SequenceInfo, TableStructure,
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

/// Get paginated data from a table with column filters applied.
#[tauri::command]
pub async fn get_filtered_table_data(
    state: tauri::State<'_, AppState>,
    id: String,
    table: String,
    schema: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    filters: Vec<ColumnFilter>,
) -> Result<PaginatedTableData, String> {
    let schema_name = schema.unwrap_or_else(|| "public".to_string());
    let limit_val = limit.unwrap_or(100);
    let offset_val = offset.unwrap_or(0);

    let conn = get_connection(&state, &id)?;
    conn.get_filtered_table_data(&table, &schema_name, limit_val, offset_val, &filters)
        .await
}

/// Get enum values for a specific column.
#[tauri::command]
pub async fn get_enum_values(
    state: tauri::State<'_, AppState>,
    id: String,
    table: String,
    column: String,
    schema: Option<String>,
) -> Result<EnumValues, String> {
    let schema_name = schema.unwrap_or_else(|| "public".to_string());

    let conn = get_connection(&state, &id)?;
    conn.get_enum_values(&table, &column, &schema_name).await
}

/// Run a list of statements in order on one session.
///
/// The statements arrive already split by the editor, which is the only place
/// that knows where the user's cursor and selection are. Nothing is wrapped in
/// a transaction implicitly — a script does exactly what it says, and `BEGIN` /
/// `COMMIT` in the text work because every statement runs on the same session.
///
/// Execution stops at the first error, and also if a statement costs us the
/// session: everything after that would run on a fresh connection, outside any
/// transaction the script had opened.
#[tauri::command]
pub async fn execute_script(
    state: tauri::State<'_, AppState>,
    session_id: String,
    statements: Vec<String>,
) -> Result<ScriptResult, String> {
    let session = state
        .sessions
        .lock()
        .unwrap()
        .get(&session_id)
        .map(|entry| entry.session.clone())
        .ok_or_else(|| "No session for this editor tab".to_string())?;

    let start_time = std::time::Instant::now();
    let total = statements.len();
    let mut results: Vec<ScriptStatementResult> = Vec::with_capacity(total);

    for (index, statement) in statements.into_iter().enumerate() {
        match session.execute_query(&statement).await {
            Ok((mut result, session_reset)) => {
                result.session_reset = session_reset;
                results.push(ScriptStatementResult {
                    index,
                    statement,
                    result: Some(result),
                    error: None,
                });
                if session_reset {
                    break;
                }
            }
            Err(error) => {
                results.push(ScriptStatementResult {
                    index,
                    statement,
                    result: None,
                    error: Some(error),
                });
                break;
            }
        }
    }

    Ok(ScriptResult {
        stopped_early: results.len() < total,
        statements: results,
        execution_time_ms: start_time.elapsed().as_millis(),
    })
}

/// Open a pinned session for a SQL editor tab, keyed by `session_id`.
///
/// Idempotent: reopening an existing session is a no-op, so a tab component
/// that remounts (switching away and back) keeps the session it had, along with
/// any transaction open on it.
#[tauri::command]
pub async fn open_session(
    state: tauri::State<'_, AppState>,
    id: String,
    session_id: String,
) -> Result<(), String> {
    let conn = get_connection(&state, &id)?;
    let mut sessions = state.sessions.lock().unwrap();
    sessions.entry(session_id).or_insert_with(|| SessionEntry {
        connection_id: id,
        session: conn.open_session(),
    });
    Ok(())
}

/// Close a session and release its connection. Call this when the tab is
/// closed, not when it is merely hidden.
#[tauri::command]
pub async fn close_session(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let entry = state.sessions.lock().unwrap().remove(&session_id);
    if let Some(entry) = entry {
        entry.session.close().await;
    }
    Ok(())
}

/// Execute an arbitrary SQL query.
///
/// With a `session_id` the statement runs on that tab's pinned connection, so
/// transaction control and other session state carry across calls. Without one
/// it runs on a pooled connection, which is fine for one-shot queries that
/// depend on nothing before them.
#[tauri::command]
pub async fn execute_query(
    state: tauri::State<'_, AppState>,
    id: String,
    query: String,
    session_id: Option<String>,
) -> Result<QueryResult, String> {
    let session = session_id.and_then(|sid| {
        state
            .sessions
            .lock()
            .unwrap()
            .get(&sid)
            .map(|entry| entry.session.clone())
    });

    match session {
        Some(session) => {
            let (mut result, session_reset) = session.execute_query(&query).await?;
            result.session_reset = session_reset;
            Ok(result)
        }
        None => {
            let conn = get_connection(&state, &id)?;
            conn.execute_query(&query).await
        }
    }
}
