//! PostgreSQL database driver implementation.

mod decode;

use async_trait::async_trait;
use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::Row;

use crate::drivers::DatabaseDriver;
use crate::types::{
    ConnectionConfig, DatabaseInfo, PaginatedTableData, QueryResult, SchemaObject, SchemaObjects,
};

/// PostgreSQL driver wrapping a connection pool.
/// 
/// This is Clone because PgPool is Arc-based internally,
/// so cloning is cheap and shares the same connection pool.
#[derive(Clone)]
pub struct PostgresDriver {
    pool: PgPool,
}

impl PostgresDriver {
    /// Establish a new connection to a PostgreSQL database.
    pub async fn connect(config: &ConnectionConfig) -> Result<Self, String> {
        let url = config.to_connection_url();

        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&url)
            .await
            .map_err(|e| e.to_string())?;

        Ok(Self { pool })
    }
}

#[async_trait]
impl DatabaseDriver for PostgresDriver {
    async fn test_connection(config: &ConnectionConfig) -> Result<String, String> {
        let url = config.to_connection_url();

        let pool = PgPoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .map_err(|e| e.to_string())?;

        pool.close().await;
        Ok("Connection successful".to_string())
    }

    async fn get_schemas(&self) -> Result<Vec<String>, String> {
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
        .fetch_all(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        let schemas: Vec<String> = rows
            .iter()
            .map(|r| r.get::<String, _>("schema_name"))
            .collect();
        Ok(schemas)
    }

    async fn get_tables(&self, schema: &str) -> Result<Vec<String>, String> {
        let rows =
            sqlx::query("SELECT table_name FROM information_schema.tables WHERE table_schema = $1")
                .bind(schema)
                .fetch_all(&self.pool)
                .await
                .map_err(|e| e.to_string())?;

        let tables: Vec<String> = rows
            .iter()
            .map(|r| r.get::<String, _>("table_name"))
            .collect();
        Ok(tables)
    }

    async fn get_table_data(
        &self,
        table: &str,
        schema: &str,
        limit: i64,
        offset: i64,
    ) -> Result<PaginatedTableData, String> {
        // Sanitize table and schema names
        if !table.chars().all(|c| c.is_alphanumeric() || c == '_') {
            return Err("Invalid table name".to_string());
        }
        if !schema.chars().all(|c| c.is_alphanumeric() || c == '_') {
            return Err("Invalid schema name".to_string());
        }

        // Get total count
        let count_row =
            sqlx::query(&format!("SELECT COUNT(*) FROM \"{}\".\"{}\"", schema, table))
                .fetch_one(&self.pool)
                .await
                .map_err(|e| e.to_string())?;
        let total_count: i64 = count_row.get(0);

        // Fetch paginated data
        let rows = sqlx::query(&format!(
            "SELECT * FROM \"{}\".\"{}\" LIMIT {} OFFSET {}",
            schema, table, limit, offset
        ))
        .fetch_all(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        let (results, columns_info) = decode::decode_rows(&rows);

        Ok(PaginatedTableData {
            rows: results,
            total_count,
            columns: columns_info,
        })
    }

    async fn get_database_info(&self, schema: &str) -> Result<DatabaseInfo, String> {
        // Get PostgreSQL version
        let version_row = sqlx::query("SELECT version()")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        let version: String = version_row.get(0);

        // Get current database name
        let db_row = sqlx::query("SELECT current_database()")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        let database_name: String = db_row.get(0);

        // Get database size
        let size_row = sqlx::query("SELECT pg_size_pretty(pg_database_size(current_database()))")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        let database_size: String = size_row.get(0);

        // Get counts for the specified schema
        let tables_row = sqlx::query(
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'"
        )
        .bind(schema)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        let total_tables: i64 = tables_row.get(0);

        let views_row =
            sqlx::query("SELECT COUNT(*) FROM information_schema.views WHERE table_schema = $1")
                .bind(schema)
                .fetch_one(&self.pool)
                .await
                .map_err(|e| e.to_string())?;
        let total_views: i64 = views_row.get(0);

        let functions_row =
            sqlx::query("SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = $1")
                .bind(schema)
                .fetch_one(&self.pool)
                .await
                .map_err(|e| e.to_string())?;
        let total_functions: i64 = functions_row.get(0);

        let sequences_row =
            sqlx::query("SELECT COUNT(*) FROM information_schema.sequences WHERE sequence_schema = $1")
                .bind(schema)
                .fetch_one(&self.pool)
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

    async fn get_schema_objects(&self, schema: &str) -> Result<SchemaObjects, String> {
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
            "#,
        )
        .bind(schema)
        .fetch_all(&self.pool)
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
            "SELECT table_name FROM information_schema.views WHERE table_schema = $1 ORDER BY table_name",
        )
        .bind(schema)
        .fetch_all(&self.pool)
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
            "SELECT routine_name FROM information_schema.routines WHERE routine_schema = $1 ORDER BY routine_name",
        )
        .bind(schema)
        .fetch_all(&self.pool)
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
            "SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = $1 ORDER BY sequence_name",
        )
        .bind(schema)
        .fetch_all(&self.pool)
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

    async fn execute_query(&self, query: &str) -> Result<QueryResult, String> {
        let start_time = std::time::Instant::now();

        let rows = sqlx::query(query)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| e.to_string())?;

        let execution_time_ms = start_time.elapsed().as_millis();
        let rows_affected = rows.len() as u64;

        let (results, columns_info) = decode::decode_rows(&rows);

        Ok(QueryResult {
            rows: results,
            columns: columns_info,
            rows_affected,
            execution_time_ms,
        })
    }

    async fn close(&self) {
        self.pool.close().await;
    }
}
