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
pub mod json;
pub mod sql;

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
    fn write_header(&mut self, columns: &[ColumnInfo], w: &mut dyn Write) -> io::Result<()>;

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
/// schema without leaking type bounds through the trait.
pub fn create_exporter(format_id: &str, options: &Value) -> Result<Box<dyn Exporter>, String> {
    match format_id {
        "csv" => {
            let opts: csv::CsvOptions = serde_json::from_value(options.clone())
                .map_err(|e| format!("invalid CSV options: {}", e))?;
            Ok(Box::new(csv::CsvExporter::new(opts)))
        }
        "json" => {
            let opts: json::JsonOptions = serde_json::from_value(options.clone())
                .map_err(|e| format!("invalid JSON options: {}", e))?;
            Ok(Box::new(json::JsonExporter::new(opts)))
        }
        "sql" => {
            let opts: sql::SqlOptions = serde_json::from_value(options.clone())
                .map_err(|e| format!("invalid SQL options: {}", e))?;
            if opts.table.is_empty() {
                return Err("SQL export needs a target table name".to_string());
            }
            Ok(Box::new(sql::SqlExporter::new(opts)))
        }
        other => Err(format!("unknown export format: {}", other)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drivers::postgres::PostgresDriver;
    use crate::types::ConnectionConfig;
    use serde_json::json;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    /// Matches `dev/compose.yaml` and `dev/seed.ts`.
    fn dev_config() -> ConnectionConfig {
        ConnectionConfig {
            id: None,
            name: "dev".to_string(),
            host: "localhost".to_string(),
            port: "5432".to_string(),
            user: "postgres".to_string(),
            password: Some("postgres".to_string()),
            database: "waterfowl_test".to_string(),
            driver: "postgres".to_string(),
            default_schema: "public".to_string(),
        }
    }

    /// Stream a real table through `format_id` and return the bytes the export
    /// would have written to disk. `None` when the dev database isn't up, so
    /// these skip rather than fail on a machine without it.
    async fn stream_export(format_id: &str, options: Value, table: &str) -> Option<String> {
        stream_export_object(format_id, options, table, true).await
    }

    /// As `stream_export`, but lets the caller say whether the object is a
    /// table or a view — `is_table` picks the row-count estimator, so the
    /// view path is genuinely different code.
    async fn stream_export_object(
        format_id: &str,
        options: Value,
        table: &str,
        is_table: bool,
    ) -> Option<String> {
        let driver = match PostgresDriver::connect(&dev_config()).await {
            Ok(d) => d,
            Err(e) => {
                eprintln!("skipping: dev database unreachable ({e})");
                return None;
            }
        };

        let mut exporter = create_exporter(format_id, &options).expect("create exporter");
        let mut buf: Vec<u8> = Vec::new();
        let mut header_written = false;

        driver
            .stream_table_data(
                table,
                "public",
                is_table,
                &[],
                Arc::new(AtomicBool::new(false)),
                |_| {},
                |values, columns| {
                    if !header_written {
                        exporter
                            .write_header(columns, &mut buf as &mut dyn Write)
                            .map_err(|e| e.to_string())?;
                        header_written = true;
                    }
                    exporter
                        .write_row(values, columns, &mut buf as &mut dyn Write)
                        .map_err(|e| e.to_string())
                },
            )
            .await
            .expect("stream table");

        exporter
            .finalize(&mut buf as &mut dyn Write)
            .expect("finalize");
        Some(String::from_utf8(buf).expect("utf-8 output"))
    }

    /// The streamed JSON export has to be parseable as one document — this is
    /// what catches a bracket or separator emitted in the wrong place, which
    /// the per-row unit tests can't see.
    #[tokio::test]
    async fn streamed_json_array_reparses() {
        let Some(out) = stream_export("json", json!({}), "type_showcase").await else {
            return;
        };
        let parsed: Value = serde_json::from_str(&out).expect("output is valid JSON");
        let rows = parsed.as_array().expect("top level is an array");
        assert!(!rows.is_empty(), "type_showcase is empty — run `pnpm seed`");
        assert!(rows[0].get("id").is_some(), "row objects keep column names");
    }

    /// `ViewPanel` exports with `objectType: "view"`, which reaches the driver
    /// as `is_table: false` and takes the exact-COUNT estimator instead of the
    /// `pg_class` one. Nothing else in the suite covers a view.
    #[tokio::test]
    async fn streamed_view_export_produces_rows() {
        let Some(out) = stream_export_object("json", json!({}), "v_user_stats", false).await else {
            return;
        };
        let parsed: Value = serde_json::from_str(&out).expect("output is valid JSON");
        let rows = parsed.as_array().expect("top level is an array");
        assert!(!rows.is_empty(), "v_user_stats is empty — run `pnpm seed`");
    }

    #[tokio::test]
    async fn streamed_ndjson_has_one_object_per_line() {
        let Some(out) = stream_export("json", json!({"layout": "ndjson"}), "type_showcase").await
        else {
            return;
        };
        let lines: Vec<&str> = out.lines().collect();
        assert!(!lines.is_empty());
        for line in &lines {
            serde_json::from_str::<Value>(line).expect("each line is a JSON object");
        }
    }

    /// A streamed export has to carry `bytea` in full. The grid abbreviates
    /// anything past 100 bytes to `\x<50 bytes>... (N bytes)`, and for a long
    /// time the export inherited that — so a `bytea` column silently didn't
    /// survive a round trip. `documents.file_data` runs to several hundred
    /// bytes, which is what makes this visible.
    #[tokio::test]
    async fn streamed_export_carries_full_bytea() {
        let Some(out) = stream_export("json", json!({}), "documents").await else {
            return;
        };
        let parsed: Value = serde_json::from_str(&out).expect("output is valid JSON");
        let rows = parsed.as_array().expect("top level is an array");

        let mut longest = 0usize;
        for row in rows {
            let Some(blob) = row.get("file_data").and_then(|v| v.as_str()) else {
                continue;
            };
            assert!(
                !blob.contains("bytes)"),
                "export carried the abbreviated display form: {blob}"
            );
            // `\x` plus two hex characters per byte.
            assert!(
                blob.starts_with("\\x"),
                "unexpected bytea rendering: {blob}"
            );
            assert!((blob.len() - 2) % 2 == 0, "hex should be byte-aligned");
            longest = longest.max(blob.len());
        }
        assert!(
            longest > 2 + 100 * 2,
            "no row exceeded the display limit — this test proves nothing \
             unless the seed writes a bytea over 100 bytes (longest was {longest})"
        );
    }

    /// Round-trip the generated script back through PostgreSQL. A syntax error
    /// or a mis-escaped literal fails here even though the string-level tests
    /// pass, which is the whole point of running it against a real server.
    ///
    /// Runs against `product_reviews`: three `text[]` columns, jsonb, numeric
    /// and timestamps, and no column whose type the decoder can't handle.
    /// Richer tables (`users`, `type_showcase`) can't round-trip yet — the
    /// types in `KNOWN_PLACEHOLDER_COLUMNS` export as a `[TYPE: \x..]`
    /// placeholder, and PostgreSQL rightly refuses to insert that back into a
    /// `tsvector` or `line` column. Retarget this once those decoders land.
    #[tokio::test]
    async fn streamed_sql_replays_into_postgres() {
        let opts = json!({"table": "product_reviews", "schema": "public"});
        let Some(script) = stream_export("sql", opts, "product_reviews").await else {
            return;
        };

        // Use sqlx directly rather than the driver: replaying needs the simple
        // query protocol (many statements in one string), which the driver's
        // row-returning query path doesn't expose.
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect(&dev_config().to_connection_url())
            .await
            .expect("connect");

        // Replay into a scratch copy so the seeded data is left alone. A TEMP
        // table would be scoped to a single pooled connection, so use a real
        // one and drop it afterwards.
        sqlx::raw_sql(
            "DROP TABLE IF EXISTS export_replay_check; \
             CREATE TABLE export_replay_check (LIKE product_reviews INCLUDING DEFAULTS);",
        )
        .execute(&pool)
        .await
        .expect("create scratch table");

        let replay = script.replace(
            "\"public\".\"product_reviews\"",
            "\"public\".\"export_replay_check\"",
        );
        let replay_result = sqlx::raw_sql(&replay).execute(&pool).await;

        let source_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM product_reviews")
            .fetch_one(&pool)
            .await
            .expect("count source rows");
        let replayed_rows: Option<i64> = if replay_result.is_ok() {
            sqlx::query_scalar("SELECT COUNT(*) FROM export_replay_check")
                .fetch_one(&pool)
                .await
                .ok()
        } else {
            None
        };

        // Always clean up before asserting, so a failure doesn't leave the
        // scratch table behind for the next run.
        let _ = sqlx::raw_sql("DROP TABLE IF EXISTS export_replay_check")
            .execute(&pool)
            .await;

        replay_result.expect("generated script replays without error");
        assert_eq!(
            replayed_rows,
            Some(source_rows),
            "every exported row should survive the round trip"
        );
    }
}
