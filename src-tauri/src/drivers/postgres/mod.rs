//! PostgreSQL database driver implementation.

mod decode;

use async_trait::async_trait;
use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::Row;

use crate::drivers::DatabaseDriver;
use crate::types::{
    ConnectionConfig, DatabaseInfo, FunctionInfo, IndexInfo, PaginatedTableData, 
    QueryResult, SchemaObject, SchemaObjects, SequenceInfo, TableColumn, TableStructure,
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

    async fn get_view_data(
        &self,
        view: &str,
        schema: &str,
        limit: i64,
        offset: i64,
    ) -> Result<PaginatedTableData, String> {
        // Sanitize view and schema names
        if !view.chars().all(|c| c.is_alphanumeric() || c == '_') {
            return Err("Invalid view name".to_string());
        }
        if !schema.chars().all(|c| c.is_alphanumeric() || c == '_') {
            return Err("Invalid schema name".to_string());
        }

        // Get total count - for views we try a count but catch errors
        let count_result =
            sqlx::query(&format!("SELECT COUNT(*) FROM \"{}\".\"{}\"", schema, view))
                .fetch_one(&self.pool)
                .await;

        let total_count: i64 = match count_result {
            Ok(row) => row.get(0),
            Err(_) => -1, // Indicate unknown count
        };

        // Fetch paginated data (read-only)
        let rows = sqlx::query(&format!(
            "SELECT * FROM \"{}\".\"{}\" LIMIT {} OFFSET {}",
            schema, view, limit, offset
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

    async fn get_function_info(&self, function_name: &str, schema: &str) -> Result<FunctionInfo, String> {
        let row = sqlx::query(
            r#"
            SELECT 
                p.proname as name,
                n.nspname as schema,
                l.lanname as language,
                pg_get_function_result(p.oid) as return_type,
                pg_get_function_arguments(p.oid) as arguments,
                pg_get_functiondef(p.oid) as definition,
                CASE p.provolatile 
                    WHEN 'i' THEN 'IMMUTABLE'
                    WHEN 's' THEN 'STABLE'
                    WHEN 'v' THEN 'VOLATILE'
                    ELSE 'UNKNOWN'
                END as volatility,
                p.proisstrict as is_strict,
                d.description
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            JOIN pg_language l ON p.prolang = l.oid
            LEFT JOIN pg_description d ON d.objoid = p.oid AND d.classoid = 'pg_proc'::regclass
            WHERE p.proname = $1 AND n.nspname = $2
            LIMIT 1
            "#,
        )
        .bind(function_name)
        .bind(schema)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| format!("Function not found: {}", e))?;

        Ok(FunctionInfo {
            name: row.get("name"),
            schema: row.get("schema"),
            language: row.get("language"),
            return_type: row.get("return_type"),
            arguments: row.get("arguments"),
            definition: row.try_get("definition").unwrap_or_default(),
            volatility: row.get("volatility"),
            is_strict: row.get("is_strict"),
            description: row.try_get("description").ok(),
        })
    }

    async fn get_sequence_info(&self, sequence_name: &str, schema: &str) -> Result<SequenceInfo, String> {
        // Get sequence metadata from information_schema
        let meta_row = sqlx::query(
            r#"
            SELECT 
                sequence_name,
                sequence_schema,
                data_type,
                start_value::bigint,
                minimum_value::bigint as min_value,
                maximum_value::bigint as max_value,
                increment::bigint,
                cycle_option
            FROM information_schema.sequences 
            WHERE sequence_name = $1 AND sequence_schema = $2
            "#,
        )
        .bind(sequence_name)
        .bind(schema)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| format!("Sequence not found: {}", e))?;

        // Get current value using dynamic SQL
        let current_row = sqlx::query(&format!(
            "SELECT last_value FROM \"{}\".\"{}\"",
            schema, sequence_name
        ))
        .fetch_one(&self.pool)
        .await;

        let current_value: i64 = match current_row {
            Ok(row) => row.get(0),
            Err(_) => 0,
        };

        let cycle_option: String = meta_row.get("cycle_option");

        Ok(SequenceInfo {
            name: meta_row.get("sequence_name"),
            schema: meta_row.get("sequence_schema"),
            data_type: meta_row.get("data_type"),
            start_value: meta_row.get("start_value"),
            min_value: meta_row.get("min_value"),
            max_value: meta_row.get("max_value"),
            increment: meta_row.get("increment"),
            cycle: cycle_option == "YES",
            current_value,
        })
    }

    async fn get_table_structure(&self, table: &str, schema: &str) -> Result<TableStructure, String> {
        // Get columns with detailed information
        let column_rows = sqlx::query(
            r#"
            SELECT 
                c.column_name,
                c.data_type,
                c.is_nullable = 'YES' as nullable,
                c.column_default,
                c.character_maximum_length::int,
                c.numeric_precision::int,
                col_description(
                    (quote_ident($2) || '.' || quote_ident($1))::regclass::oid,
                    c.ordinal_position
                ) as description,
                COALESCE(pk.is_pk, false) as is_primary_key,
                COALESCE(uq.is_unique, false) as is_unique,
                fk.foreign_table
            FROM information_schema.columns c
            LEFT JOIN (
                SELECT kcu.column_name, true as is_pk
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu 
                    ON tc.constraint_name = kcu.constraint_name
                    AND tc.table_schema = kcu.table_schema
                WHERE tc.table_schema = $2 AND tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
            ) pk ON c.column_name = pk.column_name
            LEFT JOIN (
                SELECT kcu.column_name, true as is_unique
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu 
                    ON tc.constraint_name = kcu.constraint_name
                    AND tc.table_schema = kcu.table_schema
                WHERE tc.table_schema = $2 AND tc.table_name = $1 AND tc.constraint_type = 'UNIQUE'
            ) uq ON c.column_name = uq.column_name
            LEFT JOIN (
                SELECT 
                    kcu.column_name,
                    ccu.table_schema || '.' || ccu.table_name || '(' || ccu.column_name || ')' as foreign_table
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu 
                    ON tc.constraint_name = kcu.constraint_name
                    AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage ccu 
                    ON tc.constraint_name = ccu.constraint_name
                WHERE tc.table_schema = $2 AND tc.table_name = $1 AND tc.constraint_type = 'FOREIGN KEY'
            ) fk ON c.column_name = fk.column_name
            WHERE c.table_schema = $2 AND c.table_name = $1
            ORDER BY c.ordinal_position
            "#,
        )
        .bind(table)
        .bind(schema)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        let columns: Vec<TableColumn> = column_rows
            .iter()
            .map(|r| TableColumn {
                name: r.get("column_name"),
                data_type: r.get("data_type"),
                nullable: r.get("nullable"),
                default_value: r.try_get("column_default").ok(),
                is_primary_key: r.get("is_primary_key"),
                is_unique: r.get("is_unique"),
                foreign_key: r.try_get("foreign_table").ok(),
                character_maximum_length: r.try_get("character_maximum_length").ok(),
                numeric_precision: r.try_get("numeric_precision").ok(),
                description: r.try_get("description").ok(),
            })
            .collect();

        // Get indexes
        let index_rows = sqlx::query(
            r#"
            SELECT 
                i.relname as index_name,
                array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) as columns,
                ix.indisunique as is_unique,
                ix.indisprimary as is_primary,
                am.amname as index_type
            FROM pg_index ix
            JOIN pg_class i ON i.oid = ix.indexrelid
            JOIN pg_class t ON t.oid = ix.indrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            JOIN pg_am am ON am.oid = i.relam
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
            WHERE t.relname = $1 AND n.nspname = $2
            GROUP BY i.relname, ix.indisunique, ix.indisprimary, am.amname
            "#,
        )
        .bind(table)
        .bind(schema)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        let indexes: Vec<IndexInfo> = index_rows
            .iter()
            .map(|r| {
                let cols: Vec<String> = r.try_get("columns").unwrap_or_default();
                IndexInfo {
                    name: r.get("index_name"),
                    columns: cols,
                    is_unique: r.get("is_unique"),
                    is_primary: r.get("is_primary"),
                    index_type: r.get("index_type"),
                }
            })
            .collect();

        // Get table stats
        let stats_row = sqlx::query(
            r#"
            SELECT 
                pg_size_pretty(pg_total_relation_size((quote_ident($2) || '.' || quote_ident($1))::regclass)) as size,
                (SELECT reltuples::bigint FROM pg_class c 
                 JOIN pg_namespace n ON n.oid = c.relnamespace 
                 WHERE c.relname = $1 AND n.nspname = $2) as row_count,
                obj_description((quote_ident($2) || '.' || quote_ident($1))::regclass, 'pg_class') as description
            "#,
        )
        .bind(table)
        .bind(schema)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        Ok(TableStructure {
            name: table.to_string(),
            schema: schema.to_string(),
            columns,
            indexes,
            row_count: stats_row.try_get::<i64, _>("row_count").unwrap_or(0),
            size: stats_row.try_get("size").unwrap_or_else(|_| "Unknown".to_string()),
            description: stats_row.try_get("description").ok(),
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
