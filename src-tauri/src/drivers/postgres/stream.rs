//! Row-streaming utilities for the PostgreSQL driver.
//!
//! Used by the export pipeline to walk a (possibly very large) result set
//! row-by-row without loading it all into memory. The single sqlx
//! `.fetch()` cursor avoids the `OFFSET N` quadratic blowup of repeated
//! `LIMIT/OFFSET` paging.

use futures::TryStreamExt;
use serde_json::Value;
use sqlx::Row;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use super::{pg_cast_target, PostgresDriver};
use crate::drivers::postgres::decode::decode_pg_row_values;
use crate::types::{ColumnFilter, ColumnInfo, FilterOperator};

/// Progress snapshot emitted to subscribers while a stream is in flight.
#[derive(Debug, Clone)]
pub struct StreamProgress {
    pub rows_written: u64,
    /// May be `None` when the streaming source is a view with no cheap count.
    pub total_estimate: Option<i64>,
}

/// Internal: column metadata fetched once before the stream starts.
/// Carries everything the WHERE-builder needs without re-querying.
pub(super) struct FilterSchema {
    /// Columns in `ordinal_position` order — also the row decode order.
    columns: Vec<ColumnInfo>,
    /// column_name → udt_name (uppercased) for cast dispatch.
    type_map: HashMap<String, String>,
    /// column_name → (udt_name original-case, udt_schema) for user-defined
    /// type casts. Postgres type names are case-sensitive in pg_type.
    udt_map: HashMap<String, (String, String)>,
}

impl PostgresDriver {
    /// Fetch column metadata for a table or view. Schema/table names are
    /// validated by the caller. Returned `columns` are pre-ordered by
    /// ordinal_position so callers can index decoded rows by position.
    pub(super) async fn fetch_filter_schema(
        &self,
        table: &str,
        schema: &str,
    ) -> Result<FilterSchema, String> {
        let rows = sqlx::query(
            r#"
            SELECT column_name, udt_name, udt_schema, ordinal_position
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2
            ORDER BY ordinal_position
            "#,
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        let columns: Vec<ColumnInfo> = rows
            .iter()
            .map(|r| {
                let name: String = r.get("column_name");
                let data_type: String = r.get("udt_name");
                let ordinal: i32 = r.get("ordinal_position");
                ColumnInfo {
                    name,
                    data_type: data_type.to_uppercase(),
                    ordinal_position: Some(ordinal),
                }
            })
            .collect();

        let type_map: HashMap<String, String> = columns
            .iter()
            .map(|c| (c.name.clone(), c.data_type.clone()))
            .collect();

        let udt_map: HashMap<String, (String, String)> = rows
            .iter()
            .map(|r| {
                let name: String = r.get("column_name");
                let udt_name: String = r.get("udt_name");
                let udt_schema: String = r.get("udt_schema");
                (name, (udt_name, udt_schema))
            })
            .collect();

        Ok(FilterSchema {
            columns,
            type_map,
            udt_map,
        })
    }

    /// Build the parameterized WHERE clause from `filters`.
    /// Returns `(where_sql_including_leading_WHERE, bind_values)`.
    /// `where_sql` is empty when no filter produced a clause.
    /// Mirrors the logic in `get_filtered_table_data` so both code paths
    /// produce identical SQL — keep them in sync.
    pub(super) fn build_filter_where(
        filters: &[ColumnFilter],
        schema: &FilterSchema,
    ) -> (String, Vec<String>) {
        let valid_columns: HashSet<&str> = schema.type_map.keys().map(|s| s.as_str()).collect();

        let mut clauses: Vec<String> = Vec::new();
        let mut binds: Vec<String> = Vec::new();
        let mut param_index: usize = 1;

        for filter in filters {
            if !valid_columns.contains(filter.column.as_str()) {
                continue;
            }

            let col_quoted = format!("\"{}\"", filter.column);
            let col_type = schema
                .type_map
                .get(filter.column.as_str())
                .map(|s| s.as_str())
                .unwrap_or("TEXT");
            let is_text_type = matches!(
                col_type,
                "TEXT" | "VARCHAR" | "CHAR" | "BPCHAR" | "NAME" | "CITEXT"
            );

            // Helper: append a typed-cast clause and bind the value.
            // Closure captures by mutable ref so we can keep the body compact.
            let mut push_cast = |op: &str, val: &str, idx: &mut usize| {
                if is_text_type {
                    clauses.push(format!("{} {} ${}", col_quoted, op, idx));
                } else {
                    let (udt_name_orig, udt_schema) = schema
                        .udt_map
                        .get(filter.column.as_str())
                        .map(|(n, s)| (n.as_str(), s.as_str()))
                        .unwrap_or((col_type, "pg_catalog"));
                    let cast = pg_cast_target(col_type, udt_name_orig, udt_schema);
                    clauses.push(format!("{} {} ${}::{}", col_quoted, op, idx, cast));
                }
                binds.push(val.to_string());
                *idx += 1;
            };

            match filter.operator {
                FilterOperator::IsNull => {
                    clauses.push(format!("{} IS NULL", col_quoted));
                }
                FilterOperator::IsNotNull => {
                    clauses.push(format!("{} IS NOT NULL", col_quoted));
                }
                FilterOperator::Contains => {
                    if let Some(ref val) = filter.value {
                        clauses.push(format!("{}::text ILIKE ${}", col_quoted, param_index));
                        binds.push(format!("%{}%", val));
                        param_index += 1;
                    }
                }
                FilterOperator::StartsWith => {
                    if let Some(ref val) = filter.value {
                        clauses.push(format!("{}::text ILIKE ${}", col_quoted, param_index));
                        binds.push(format!("{}%", val));
                        param_index += 1;
                    }
                }
                FilterOperator::EndsWith => {
                    if let Some(ref val) = filter.value {
                        clauses.push(format!("{}::text ILIKE ${}", col_quoted, param_index));
                        binds.push(format!("%{}", val));
                        param_index += 1;
                    }
                }
                FilterOperator::Equals => {
                    if let Some(ref val) = filter.value {
                        push_cast("=", val, &mut param_index);
                    }
                }
                FilterOperator::NotEquals => {
                    if let Some(ref val) = filter.value {
                        push_cast("!=", val, &mut param_index);
                    }
                }
                FilterOperator::GreaterThan => {
                    if let Some(ref val) = filter.value {
                        push_cast(">", val, &mut param_index);
                    }
                }
                FilterOperator::LessThan => {
                    if let Some(ref val) = filter.value {
                        push_cast("<", val, &mut param_index);
                    }
                }
                FilterOperator::GreaterThanOrEqual => {
                    if let Some(ref val) = filter.value {
                        push_cast(">=", val, &mut param_index);
                    }
                }
                FilterOperator::LessThanOrEqual => {
                    if let Some(ref val) = filter.value {
                        push_cast("<=", val, &mut param_index);
                    }
                }
            }
        }

        let where_sql = if clauses.is_empty() {
            String::new()
        } else {
            format!(" WHERE {}", clauses.join(" AND "))
        };
        (where_sql, binds)
    }

    /// Estimate or count the number of rows that would be returned. For
    /// unfiltered queries on a base table we use `pg_class.reltuples` (O(1));
    /// otherwise we issue `COUNT(*)`. Returns 0 when both fail (e.g. view).
    /// `relkind`: pass `"r"` for a table, `"v"` for a view. Only affects
    /// whether the fast estimate is attempted.
    pub(super) async fn estimate_rows(
        &self,
        qualified_table: &str,
        where_sql: &str,
        binds: &[String],
        table: &str,
        schema: &str,
        is_table: bool,
    ) -> Result<Option<i64>, String> {
        if where_sql.is_empty() && is_table {
            let row = sqlx::query(
                r#"
                SELECT c.reltuples::bigint AS estimate
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relname = $1 AND n.nspname = $2
                "#,
            )
            .bind(table)
            .bind(schema)
            .fetch_one(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
            return Ok(Some(row.try_get::<i64, _>("estimate").unwrap_or(0).max(0)));
        }

        let sql = format!("SELECT COUNT(*) FROM {}{}", qualified_table, where_sql);
        let mut q = sqlx::query(&sql);
        for v in binds {
            q = q.bind(v);
        }
        match q.fetch_one(&self.pool).await {
            Ok(row) => Ok(row.try_get::<i64, _>(0).ok()),
            Err(_) => Ok(None),
        }
    }

    /// Stream every row of a table or view, decoding each into JSON values
    /// and invoking `on_row` per row. `on_row(&values, &columns)` returns
    /// `Err(_)` to abort the stream (the error is propagated).
    ///
    /// `cancel`, when set true by another task, aborts after the current row.
    ///
    /// Returns the number of rows actually written.
    pub async fn stream_table_data<F>(
        &self,
        table: &str,
        schema: &str,
        is_table: bool,
        filters: &[ColumnFilter],
        cancel: Arc<AtomicBool>,
        mut on_progress: impl FnMut(StreamProgress) + Send,
        mut on_row: F,
    ) -> Result<u64, String>
    where
        F: FnMut(&[Value], &[ColumnInfo]) -> Result<(), String> + Send,
    {
        // Validate identifiers up-front. These are interpolated into SQL, so
        // the same alphanumeric+underscore policy from the rest of the driver
        // applies here.
        if !table.chars().all(|c| c.is_alphanumeric() || c == '_') {
            return Err("Invalid table name".to_string());
        }
        if !schema.chars().all(|c| c.is_alphanumeric() || c == '_') {
            return Err("Invalid schema name".to_string());
        }

        let filter_schema = self.fetch_filter_schema(table, schema).await?;
        let (where_sql, binds) = Self::build_filter_where(filters, &filter_schema);
        let qualified = format!("\"{}\".\"{}\"", schema, table);

        // Best-effort total estimate for the progress UI. Failures are
        // non-fatal — the UI will just show indeterminate progress.
        let total_estimate = self
            .estimate_rows(&qualified, &where_sql, &binds, table, schema, is_table)
            .await
            .ok()
            .flatten();

        let sql = format!("SELECT * FROM {}{}", qualified, where_sql);
        let mut query = sqlx::query(&sql);
        for v in &binds {
            query = query.bind(v);
        }

        // Decode + dispatch each row. Reuse a single Vec<Value> buffer so
        // we don't churn the allocator on large exports.
        let mut buf: Vec<Value> = Vec::with_capacity(filter_schema.columns.len());
        let mut rows_written: u64 = 0;
        // Emit a progress event at most every PROGRESS_EVERY rows. Tauri IPC
        // has non-trivial per-event overhead, so per-row events would dominate
        // CPU on fast exports.
        const PROGRESS_EVERY: u64 = 1000;

        let mut stream = query.fetch(&self.pool);
        while let Some(row) = stream
            .try_next()
            .await
            .map_err(|e| format!("query stream error: {}", e))?
        {
            if cancel.load(Ordering::Relaxed) {
                return Err("cancelled".to_string());
            }

            decode_pg_row_values(&row, &filter_schema.columns, &mut buf);
            on_row(&buf, &filter_schema.columns)?;
            rows_written += 1;

            if rows_written % PROGRESS_EVERY == 0 {
                on_progress(StreamProgress {
                    rows_written,
                    total_estimate,
                });
            }
        }

        // Final progress tick so the UI always sees the actual end value
        // (rather than the last multiple of PROGRESS_EVERY).
        on_progress(StreamProgress {
            rows_written,
            total_estimate,
        });

        Ok(rows_written)
    }
}
