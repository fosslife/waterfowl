//! Data export module.
//!
//! Provides a pluggable `Exporter` trait so new output formats can be added
//! without touching the streaming pipeline. Adding a format:
//! 1. Implement `Exporter` in a new submodule.
//! 2. Register it in `create_exporter`.
//! 3. Expose its `id` in the frontend format registry.
//!
//! Exporters are designed for row-at-a-time streaming: callers feed one
//! decoded row, the exporter writes its serialized form straight to the
//! provided `Write` sink. No intermediate `Vec` of all rows is required.

pub mod csv;

use crate::types::ColumnInfo;
use serde_json::Value;
use std::io::{self, Write};

/// A streaming row-by-row exporter for a specific output format.
///
/// Lifecycle: `write_header` (once) → `write_row` (N times) → `finalize` (once).
/// Each call writes directly to `w` — exporters MUST NOT buffer rows
/// internally, since the whole point is constant-memory export of large tables.
pub trait Exporter: Send {
    /// Write the header row (column names). Called once before any rows.
    /// Implementations may no-op (e.g. if the user disabled headers).
    fn write_header(
        &mut self,
        columns: &[ColumnInfo],
        w: &mut dyn Write,
    ) -> io::Result<()>;

    /// Write a single decoded row. `values[i]` corresponds to `columns[i]`.
    /// Called once per row.
    fn write_row(
        &mut self,
        values: &[Value],
        columns: &[ColumnInfo],
        w: &mut dyn Write,
    ) -> io::Result<()>;

    /// Flush any trailing state. Called once after the last row.
    /// Most formats don't need anything here; CSV is a no-op.
    fn finalize(&mut self, _w: &mut dyn Write) -> io::Result<()> {
        Ok(())
    }
}

/// Construct an exporter by format id, parsing format-specific options from
/// the JSON `options` blob. Unknown formats / invalid options return Err.
///
/// `options` is `serde_json::Value` so each exporter can define its own
/// schema without leaking type bounds through the trait. v1 only knows CSV.
pub fn create_exporter(
    format_id: &str,
    options: &Value,
) -> Result<Box<dyn Exporter>, String> {
    match format_id {
        "csv" => {
            let opts: csv::CsvOptions = serde_json::from_value(options.clone())
                .map_err(|e| format!("invalid CSV options: {}", e))?;
            Ok(Box::new(csv::CsvExporter::new(opts)))
        }
        other => Err(format!("unknown export format: {}", other)),
    }
}
