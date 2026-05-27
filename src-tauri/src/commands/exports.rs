//! Data export commands.
//!
//! Exposes two commands:
//! - `export_table_streaming`: run a streamed export to disk for a table/view.
//! - `cancel_export`: signal an in-flight export to abort at the next row.
//!
//! The streamed path writes directly from Rust to a `BufWriter<File>` so the
//! whole result set never lives in memory. Progress is emitted via Tauri
//! events at most every N rows to avoid IPC overhead dominating CPU on
//! fast exports.

use std::fs::File;
use std::io::{BufWriter, Write};
use std::sync::Mutex;
use std::time::Instant;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::drivers::DriverConnection;
use crate::exporters::create_exporter;
use crate::state::AppState;
use crate::types::ColumnFilter;

/// Streaming progress event payload. Sent on the channel
/// `export-progress:<export_id>`.
#[derive(Serialize, Clone, Debug)]
pub struct ExportProgressPayload {
    pub export_id: String,
    pub rows_written: u64,
    /// Best-effort row count for progress UI. None for views with no fast count.
    pub total_estimate: Option<i64>,
}

#[derive(Serialize, Debug)]
pub struct ExportSummary {
    pub rows_written: u64,
    pub bytes_written: u64,
    pub duration_ms: u128,
    pub cancelled: bool,
}

fn get_connection(
    state: &tauri::State<'_, AppState>,
    id: &str,
) -> Result<DriverConnection, String> {
    let connections = state.connections.lock().unwrap();
    connections
        .get(id)
        .cloned()
        .ok_or_else(|| "Not connected".to_string())
}

/// Start a streamed export to a file path. Blocks until the export completes
/// or is cancelled.
///
/// `export_id` is allocated by the caller (a UUID is fine). It identifies the
/// export for cancellation and tags progress events. Re-using an id from a
/// prior export is safe — the old cancel token is replaced.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn export_table_streaming(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    export_id: String,
    connection_id: String,
    object_type: String,
    name: String,
    schema: Option<String>,
    filters: Vec<ColumnFilter>,
    format_id: String,
    format_options: Value,
    dest_path: String,
) -> Result<ExportSummary, String> {
    let schema_name = schema.unwrap_or_else(|| "public".to_string());
    let is_table = object_type.as_str() == "table";
    let conn = get_connection(&state, &connection_id)?;

    let exporter = create_exporter(&format_id, &format_options)?;
    let cancel = state.register_cancel(&export_id);

    // 64 KiB buffer trades a little memory for many fewer syscalls on large
    // exports. The OS page cache absorbs the writes; we just batch them.
    let file = File::create(&dest_path).map_err(|e| format!("create {}: {}", dest_path, e))?;
    let writer = BufWriter::with_capacity(64 * 1024, file);

    // Progress emitter — moved into the on_progress closure. Cloned per event
    // because the closure is `FnMut` and `emit` only needs a borrow.
    let app_for_progress = app.clone();
    let export_id_for_progress = export_id.clone();
    let progress_channel = format!("export-progress:{}", export_id);
    let on_progress = move |p: crate::drivers::StreamProgress| {
        // Errors emitting events are non-fatal — the export should still
        // finish even if no one is listening for progress.
        let _ = app_for_progress.emit(
            &progress_channel,
            ExportProgressPayload {
                export_id: export_id_for_progress.clone(),
                rows_written: p.rows_written,
                total_estimate: p.total_estimate,
            },
        );
    };

    // The exporter + writer are mutated by `on_row` and consulted by the
    // post-loop finalize/flush. Mutex<…> lets us reach back into them after
    // the closure has been dropped without fighting the borrow checker on
    // the async lifetime — contention is zero because only one task touches
    // them at a time.
    let exporter_writer = Mutex::new((exporter, writer, false));

    let start = Instant::now();
    let stream_result = conn
        .stream_table_data(
            &name,
            &schema_name,
            is_table,
            &filters,
            cancel.clone(),
            on_progress,
            |values, columns| {
                let mut guard = exporter_writer.lock().unwrap();
                let (ref mut exporter, ref mut writer, ref mut header_written) = *guard;
                if !*header_written {
                    exporter
                        .write_header(columns, writer as &mut dyn Write)
                        .map_err(|e| format!("write header: {}", e))?;
                    *header_written = true;
                }
                exporter
                    .write_row(values, columns, writer as &mut dyn Write)
                    .map_err(|e| format!("write row: {}", e))
            },
        )
        .await;

    // Always drop the cancel slot — leaving it around leaks one Arc.
    state.drop_cancel(&export_id);

    // Determine outcome. The streaming method returns `Err("cancelled")`
    // when the cancel flag was tripped — translate that to a clean summary.
    let (rows_written, cancelled) = match stream_result {
        Ok(n) => (n, false),
        Err(ref e) if e == "cancelled" => {
            // Pull row count from the exporter state (we don't track it
            // separately on the cancel path). The loop tracked it internally
            // but we discarded it on early return — re-derive from the
            // progress events isn't worth the complexity. Report 0 as a
            // safe lower bound. The UI mainly cares about `cancelled: true`.
            (0, true)
        }
        Err(e) => return Err(e),
    };

    // Finalize the exporter (no-op for CSV today) and flush the writer so
    // the file is durable before we report success.
    let (mut exporter, writer, _) = exporter_writer.into_inner().unwrap();
    let mut writer = writer; // rebind so we can call finalize then into_inner
    exporter
        .finalize(&mut writer as &mut dyn Write)
        .map_err(|e| format!("finalize: {}", e))?;
    let bytes_written = writer
        .into_inner()
        .map_err(|e| format!("flush: {}", e.error()))?
        .metadata()
        .map(|m| m.len())
        .unwrap_or(0);

    Ok(ExportSummary {
        rows_written,
        bytes_written,
        duration_ms: start.elapsed().as_millis(),
        cancelled,
    })
}

/// Signal an in-flight export to cancel. The streaming loop checks the flag
/// between rows, so cancel is observed quickly but not instantly.
#[tauri::command]
pub fn cancel_export(state: tauri::State<'_, AppState>, export_id: String) {
    state.signal_cancel(&export_id);
}

/// Write a UTF-8 string to a file path. Used by the in-memory export path
/// (current page / selected rows) where the frontend already has the full
/// payload in hand. Kept minimal — for large payloads, use the streaming
/// command instead.
///
/// Sync `std::fs::write` is fine here: payloads are bounded to one page
/// worth of rows so the brief blocking write doesn't matter; spinning up a
/// tokio::spawn_blocking would just add ceremony.
#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("write {}: {}", path, e))
}
