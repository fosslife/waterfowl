//! Pinned editor sessions.
//!
//! Every SQL editor tab owns one of these. Statements from a tab always run on
//! the same backend session, which is what makes `BEGIN`/`COMMIT`, `SET`,
//! `SET ROLE` and temp tables behave the way anyone typing them expects.
//!
//! Running them on the shared pool instead would scatter consecutive statements
//! across different connections: a `BEGIN` would open a transaction on one, the
//! `UPDATE` after it would autocommit on another, and the `COMMIT` would fail on
//! a third — with the user believing the whole time that they had a safety net.
//!
//! Sessions connect on their own rather than borrowing from the pool, so a tab
//! sitting idle in a transaction can never starve schema browsing of
//! connections.

use futures::lock::Mutex;
use sqlx::postgres::PgConnection;
use sqlx::{ConnectOptions, Connection};
use std::sync::Arc;

use super::exec;
use crate::types::QueryResult;

/// A database session bound to one editor tab. Cheap to clone — clones share
/// the same underlying connection.
#[derive(Clone)]
pub struct PgSession {
    url: String,
    /// `None` before the first statement, and again after anything that leaves
    /// the connection unusable. The next statement reconnects.
    conn: Arc<Mutex<Option<PgConnection>>>,
}

impl PgSession {
    /// Create a session. Connecting is deferred to the first statement so that
    /// opening an editor tab can't fail or block on the network.
    pub fn new(url: String) -> Self {
        Self {
            url,
            conn: Arc::new(Mutex::new(None)),
        }
    }

    /// Run one statement on this session.
    ///
    /// Returns `(result, session_reset)`. `session_reset` is true when the
    /// connection had to be thrown away — see the truncation note below — which
    /// means any session state the user had built up is gone.
    pub async fn execute_query(&self, query: &str) -> Result<(QueryResult, bool), String> {
        let mut guard = self.conn.lock().await;

        if guard.is_none() {
            let conn = self
                .url
                .parse::<sqlx::postgres::PgConnectOptions>()
                .map_err(|e| e.to_string())?
                .connect()
                .await
                .map_err(|e| e.to_string())?;
            *guard = Some(conn);
        }

        let conn = guard.as_mut().expect("connection was just established");
        let outcome = match exec::run_statement(conn, query).await {
            Ok(outcome) => outcome,
            Err(err) => {
                // A statement erroring is ordinary — Postgres keeps the session
                // alive (in a failed transaction, if one was open) and the user
                // is expected to fix their SQL and retry. Keep the connection.
                return Err(err);
            }
        };

        if outcome.connection_spent {
            // The result set was truncated, so the server is still streaming
            // rows down this connection. Draining them could take minutes on a
            // large table, so close it and let the next statement reconnect.
            // The cost is any open transaction rolling back, which is the safe
            // direction to fail: nothing gets committed that the user didn't
            // ask for.
            if let Some(conn) = guard.take() {
                let _ = conn.close().await;
            }
            return Ok((outcome.result, true));
        }

        Ok((outcome.result, false))
    }

    /// Close the session's connection. Rolls back any open transaction.
    pub async fn close(&self) {
        if let Some(conn) = self.conn.lock().await.take() {
            let _ = conn.close().await;
        }
    }
}
