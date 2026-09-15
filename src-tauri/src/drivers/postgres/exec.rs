//! Ad-hoc statement execution.
//!
//! Shared by both paths that run user-written SQL: one-off execution on a
//! pooled connection, and execution on a pinned editor session. Keeping it in
//! one place means the row cap and the affected-row accounting can't drift
//! apart between them.

use futures::TryStreamExt;
use sqlx::postgres::{PgConnection, PgRow};
use sqlx::{Either, Executor};

use super::decode;
use crate::types::QueryResult;

/// Hard ceiling on the number of rows an ad-hoc query may buffer.
///
/// Unlike the table browser, this path has no pagination — a bare
/// `SELECT * FROM huge_table` would otherwise pull the whole result set into
/// RAM and take the app down with it. Rows past the cap are never decoded and
/// the result is flagged `truncated`.
const MAX_QUERY_ROWS: usize = 10_000;

/// A statement's result, plus what it did to the connection it ran on.
pub(super) struct ExecOutcome {
    pub result: QueryResult,
    /// True when we stopped reading mid-result-set. The server is still
    /// streaming rows at this connection, so it can't serve another query until
    /// every one of them has been drained — the caller must discard it rather
    /// than pass it on to an unrelated query that would stall behind the drain.
    pub connection_spent: bool,
}

/// Run a single statement, buffering at most `MAX_QUERY_ROWS` rows.
pub(super) async fn run_statement(
    conn: &mut PgConnection,
    query: &str,
) -> Result<ExecOutcome, String> {
    let start_time = std::time::Instant::now();

    // `fetch_many` yields the server's command tag (`Either::Left`) as well as
    // the rows. Without the tag there is nothing to report for an
    // `UPDATE`/`DELETE`/`INSERT` that has no `RETURNING` clause — those come
    // back as an empty row set, so counting rows would claim "0 affected"
    // however many rows actually changed. Called through `Executor` because
    // `Query::fetch_many` is deprecated for its multi-statement semantics,
    // which we don't rely on: statements are split before they get here.
    let mut stream = conn.fetch_many(sqlx::query(query));

    let mut rows: Vec<PgRow> = Vec::new();
    let mut rows_affected: u64 = 0;
    let mut truncated = false;

    while let Some(item) = stream.try_next().await.map_err(|e| e.to_string())? {
        match item {
            Either::Left(tag) => rows_affected += tag.rows_affected(),
            Either::Right(row) => {
                if rows.len() >= MAX_QUERY_ROWS {
                    truncated = true;
                    break;
                }
                rows.push(row);
            }
        }
    }
    drop(stream);

    if truncated {
        // Postgres reports `SELECT n` in the command tag too, but we stopped
        // reading before it arrived. Report what we actually returned.
        rows_affected = rows.len() as u64;
    }

    let execution_time_ms = start_time.elapsed().as_millis();
    let (results, columns_info) = decode::decode_rows(&rows, None);

    Ok(ExecOutcome {
        result: QueryResult {
            rows: results,
            columns: columns_info,
            rows_affected,
            truncated,
            // Only the session path can answer this; it overwrites the flag.
            session_reset: false,
            execution_time_ms,
        },
        connection_spent: truncated,
    })
}
