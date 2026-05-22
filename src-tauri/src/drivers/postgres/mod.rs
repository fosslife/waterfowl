//! PostgreSQL database driver implementation.

mod decode;
mod stream;

pub use stream::StreamProgress;

use async_trait::async_trait;
use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::Row;

use crate::drivers::DatabaseDriver;
use crate::types::{
    ColumnFilter, ColumnInfo, ConnectionConfig, DatabaseInfo, EnumValues, FilterOperator,
    FunctionInfo, IndexInfo, PaginatedTableData, QueryResult, SchemaObject, SchemaObjects,
    SequenceInfo, TableColumn, TableStructure,
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

/// Maps a Postgres `udt_name` (uppercased) to the SQL type name suitable for
/// casting a text parameter: `$1::type`. This lets Postgres use B-tree
/// indexes on the column instead of forcing a sequential scan.
///
/// For custom / unknown types (e.g. user-defined enums), the udt_name is
/// returned as-is — Postgres will resolve it correctly.
/// Builds a schema-qualified cast target for user-defined types (enums, domains, composites).
/// Builtin types live in `pg_catalog` and resolve without qualification, so we use the
/// canonical name from `pg_cast_type`. For everything else we must qualify with the
/// schema where the type lives, because the user's `search_path` may not include it.
///
/// `udt_name_original` MUST be the original-case name from `information_schema.columns`
/// — Postgres stores type names case-sensitively, so an enum created as `"EddMethod"`
/// will not resolve as `eddmethod`.
fn pg_cast_target(udt_name_upper: &str, udt_name_original: &str, udt_schema: &str) -> String {
    match udt_name_upper {
        "INT2" | "INT4" | "INT8" | "FLOAT4" | "FLOAT8" | "NUMERIC" | "BOOL" | "UUID" | "DATE"
        | "TIME" | "TIMETZ" | "TIMESTAMP" | "TIMESTAMPTZ" | "INTERVAL" | "INET" | "CIDR"
        | "MACADDR" | "JSON" | "JSONB" | "BYTEA" | "MONEY" | "OID" | "TEXT" | "VARCHAR"
        | "CHAR" | "BPCHAR" | "NAME" | "CITEXT" => pg_cast_type(udt_name_upper),
        // User-defined type — qualify with the schema where the type lives, and use
        // the original-case name so quoted identifiers match.
        _ => format!("\"{}\".\"{}\"", udt_schema, udt_name_original),
    }
}

fn pg_cast_type(udt_name: &str) -> String {
    match udt_name {
        // Integer types
        "INT2" => "smallint".to_string(),
        "INT4" => "integer".to_string(),
        "INT8" => "bigint".to_string(),
        // Floating-point
        "FLOAT4" => "real".to_string(),
        "FLOAT8" => "double precision".to_string(),
        "NUMERIC" => "numeric".to_string(),
        // Boolean
        "BOOL" => "boolean".to_string(),
        // UUID
        "UUID" => "uuid".to_string(),
        // Date/time
        "DATE" => "date".to_string(),
        "TIME" => "time".to_string(),
        "TIMETZ" => "time with time zone".to_string(),
        "TIMESTAMP" => "timestamp".to_string(),
        "TIMESTAMPTZ" => "timestamp with time zone".to_string(),
        "INTERVAL" => "interval".to_string(),
        // Network
        "INET" => "inet".to_string(),
        "CIDR" => "cidr".to_string(),
        "MACADDR" => "macaddr".to_string(),
        // JSON
        "JSON" => "json".to_string(),
        "JSONB" => "jsonb".to_string(),
        // Byte array
        "BYTEA" => "bytea".to_string(),
        // Money
        "MONEY" => "money".to_string(),
        // OID
        "OID" => "oid".to_string(),
        // Fallback: use the type name directly (handles enums, domains, etc.)
        other => other.to_lowercase(),
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

        // Fetch column metadata with ordinal positions (preserves schema order)
        let column_rows = sqlx::query(
            r#"
            SELECT column_name, udt_name, ordinal_position
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

        let ordered_columns: Vec<ColumnInfo> = column_rows
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

        // Get estimated total count from pg_class (O(1) catalog lookup).
        // This avoids a full sequential scan that COUNT(*) would require on
        // large tables due to PostgreSQL's MVCC.
        let count_row = sqlx::query(
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
        let total_count: i64 = count_row
            .try_get::<i64, _>("estimate")
            .unwrap_or(0)
            .max(0);

        // Fetch paginated data
        let rows = sqlx::query(&format!(
            "SELECT * FROM \"{}\".\"{}\" LIMIT {} OFFSET {}",
            schema, table, limit, offset
        ))
        .fetch_all(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        let (results, columns_info) = decode::decode_rows(&rows, Some(ordered_columns));

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

        let functions_row = sqlx::query(
            "SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = $1",
        )
        .bind(schema)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        let total_functions: i64 = functions_row.get(0);

        let sequences_row = sqlx::query(
            "SELECT COUNT(*) FROM information_schema.sequences WHERE sequence_schema = $1",
        )
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

        // Fetch column metadata with ordinal positions (views also have columns in information_schema)
        let column_rows = sqlx::query(
            r#"
            SELECT column_name, udt_name, ordinal_position
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2
            ORDER BY ordinal_position
            "#,
        )
        .bind(schema)
        .bind(view)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        let ordered_columns: Vec<ColumnInfo> = column_rows
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

        // Get total count (may fail for complex views)
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

        let (results, columns_info) = decode::decode_rows(&rows, Some(ordered_columns));

        Ok(PaginatedTableData {
            rows: results,
            total_count,
            columns: columns_info,
        })
    }

    async fn get_function_info(
        &self,
        function_name: &str,
        schema: &str,
    ) -> Result<FunctionInfo, String> {
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

    async fn get_sequence_info(
        &self,
        sequence_name: &str,
        schema: &str,
    ) -> Result<SequenceInfo, String> {
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

    async fn get_table_structure(
        &self,
        table: &str,
        schema: &str,
    ) -> Result<TableStructure, String> {
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
            size: stats_row
                .try_get("size")
                .unwrap_or_else(|_| "Unknown".to_string()),
            description: stats_row.try_get("description").ok(),
        })
    }

    async fn get_filtered_table_data(
        &self,
        table: &str,
        schema: &str,
        limit: i64,
        offset: i64,
        filters: &[ColumnFilter],
    ) -> Result<PaginatedTableData, String> {
        // Sanitize table and schema names
        if !table.chars().all(|c| c.is_alphanumeric() || c == '_') {
            return Err("Invalid table name".to_string());
        }
        if !schema.chars().all(|c| c.is_alphanumeric() || c == '_') {
            return Err("Invalid schema name".to_string());
        }

        // Fetch column metadata. We grab `udt_schema` too so that casts to user-defined
        // types (enums etc.) can be schema-qualified — otherwise Postgres errors with
        // "type \"foo\" does not exist" when the type's schema isn't on search_path.
        let column_rows = sqlx::query(
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

        let ordered_columns: Vec<ColumnInfo> = column_rows
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

        // Build column type lookup: column_name -> udt_name (uppercased)
        let column_type_map: std::collections::HashMap<&str, &str> = ordered_columns
            .iter()
            .map(|c| (c.name.as_str(), c.data_type.as_str()))
            .collect();

        // Parallel map: column_name -> (udt_name_original_case, udt_schema). We need the
        // original-case udt_name because user-defined type names are case-sensitive in
        // pg_type — uppercasing/lowercasing for display would break casts.
        let column_udt_map: std::collections::HashMap<String, (String, String)> = column_rows
            .iter()
            .map(|r| {
                let name: String = r.get("column_name");
                let udt_name: String = r.get("udt_name");
                let udt_schema: String = r.get("udt_schema");
                (name, (udt_name, udt_schema))
            })
            .collect();

        // Build valid column name set for validation
        let valid_columns: std::collections::HashSet<&str> = column_type_map.keys().copied().collect();

        // Build WHERE clause from filters using parameterized queries
        let mut where_clauses: Vec<String> = Vec::new();
        let mut bind_values: Vec<String> = Vec::new();
        let mut param_index: usize = 1; // Parameters start at $1 (schema/table are string-interpolated, not bound)

        for filter in filters {
            // Validate column name against schema
            if !valid_columns.contains(filter.column.as_str()) {
                continue; // Skip invalid column names silently
            }

            let col_quoted = format!("\"{}\"", filter.column);
            let col_type = column_type_map
                .get(filter.column.as_str())
                .copied()
                .unwrap_or("TEXT");
            let is_text_type = matches!(
                col_type,
                "TEXT" | "VARCHAR" | "CHAR" | "BPCHAR" | "NAME" | "CITEXT"
            );

            match filter.operator {
                FilterOperator::IsNull => {
                    where_clauses.push(format!("{} IS NULL", col_quoted));
                }
                FilterOperator::IsNotNull => {
                    where_clauses.push(format!("{} IS NOT NULL", col_quoted));
                }
                // ILIKE operators: always cast column to text (can't use B-tree indexes for
                // pattern matching anyway, and the user explicitly wants string matching)
                FilterOperator::Contains => {
                    if let Some(ref val) = filter.value {
                        where_clauses
                            .push(format!("{}::text ILIKE ${}", col_quoted, param_index));
                        bind_values.push(format!("%{}%", val));
                        param_index += 1;
                    }
                }
                FilterOperator::StartsWith => {
                    if let Some(ref val) = filter.value {
                        where_clauses
                            .push(format!("{}::text ILIKE ${}", col_quoted, param_index));
                        bind_values.push(format!("{}%", val));
                        param_index += 1;
                    }
                }
                FilterOperator::EndsWith => {
                    if let Some(ref val) = filter.value {
                        where_clauses
                            .push(format!("{}::text ILIKE ${}", col_quoted, param_index));
                        bind_values.push(format!("%{}", val));
                        param_index += 1;
                    }
                }
                // Exact / comparison operators: cast the parameter to the column's type
                // so Postgres can use B-tree indexes on the column
                FilterOperator::Equals => {
                    if let Some(ref val) = filter.value {
                        if is_text_type {
                            where_clauses.push(format!("{} = ${}", col_quoted, param_index));
                        } else {
                            let (udt_name_orig, udt_schema) = column_udt_map
                                .get(filter.column.as_str())
                                .map(|(n, s)| (n.as_str(), s.as_str()))
                                .unwrap_or((col_type, "pg_catalog"));
                            let cast = pg_cast_target(col_type, udt_name_orig, udt_schema);
                            where_clauses.push(format!(
                                "{} = ${}::{}",
                                col_quoted, param_index, cast
                            ));
                        }
                        bind_values.push(val.clone());
                        param_index += 1;
                    }
                }
                FilterOperator::NotEquals => {
                    if let Some(ref val) = filter.value {
                        if is_text_type {
                            where_clauses.push(format!("{} != ${}", col_quoted, param_index));
                        } else {
                            let (udt_name_orig, udt_schema) = column_udt_map
                                .get(filter.column.as_str())
                                .map(|(n, s)| (n.as_str(), s.as_str()))
                                .unwrap_or((col_type, "pg_catalog"));
                            let cast = pg_cast_target(col_type, udt_name_orig, udt_schema);
                            where_clauses.push(format!(
                                "{} != ${}::{}",
                                col_quoted, param_index, cast
                            ));
                        }
                        bind_values.push(val.clone());
                        param_index += 1;
                    }
                }
                FilterOperator::GreaterThan => {
                    if let Some(ref val) = filter.value {
                        if is_text_type {
                            where_clauses.push(format!("{} > ${}", col_quoted, param_index));
                        } else {
                            let (udt_name_orig, udt_schema) = column_udt_map
                                .get(filter.column.as_str())
                                .map(|(n, s)| (n.as_str(), s.as_str()))
                                .unwrap_or((col_type, "pg_catalog"));
                            let cast = pg_cast_target(col_type, udt_name_orig, udt_schema);
                            where_clauses.push(format!(
                                "{} > ${}::{}",
                                col_quoted, param_index, cast
                            ));
                        }
                        bind_values.push(val.clone());
                        param_index += 1;
                    }
                }
                FilterOperator::LessThan => {
                    if let Some(ref val) = filter.value {
                        if is_text_type {
                            where_clauses.push(format!("{} < ${}", col_quoted, param_index));
                        } else {
                            let (udt_name_orig, udt_schema) = column_udt_map
                                .get(filter.column.as_str())
                                .map(|(n, s)| (n.as_str(), s.as_str()))
                                .unwrap_or((col_type, "pg_catalog"));
                            let cast = pg_cast_target(col_type, udt_name_orig, udt_schema);
                            where_clauses.push(format!(
                                "{} < ${}::{}",
                                col_quoted, param_index, cast
                            ));
                        }
                        bind_values.push(val.clone());
                        param_index += 1;
                    }
                }
                FilterOperator::GreaterThanOrEqual => {
                    if let Some(ref val) = filter.value {
                        if is_text_type {
                            where_clauses.push(format!("{} >= ${}", col_quoted, param_index));
                        } else {
                            let (udt_name_orig, udt_schema) = column_udt_map
                                .get(filter.column.as_str())
                                .map(|(n, s)| (n.as_str(), s.as_str()))
                                .unwrap_or((col_type, "pg_catalog"));
                            let cast = pg_cast_target(col_type, udt_name_orig, udt_schema);
                            where_clauses.push(format!(
                                "{} >= ${}::{}",
                                col_quoted, param_index, cast
                            ));
                        }
                        bind_values.push(val.clone());
                        param_index += 1;
                    }
                }
                FilterOperator::LessThanOrEqual => {
                    if let Some(ref val) = filter.value {
                        if is_text_type {
                            where_clauses.push(format!("{} <= ${}", col_quoted, param_index));
                        } else {
                            let (udt_name_orig, udt_schema) = column_udt_map
                                .get(filter.column.as_str())
                                .map(|(n, s)| (n.as_str(), s.as_str()))
                                .unwrap_or((col_type, "pg_catalog"));
                            let cast = pg_cast_target(col_type, udt_name_orig, udt_schema);
                            where_clauses.push(format!(
                                "{} <= ${}::{}",
                                col_quoted, param_index, cast
                            ));
                        }
                        bind_values.push(val.clone());
                        param_index += 1;
                    }
                }
            }
        }

        let where_sql = if where_clauses.is_empty() {
            String::new()
        } else {
            format!(" WHERE {}", where_clauses.join(" AND "))
        };

        let qualified_table = format!("\"{}\".\"{}\"", schema, table);

        // When no filters are active, use the fast pg_class.reltuples estimate
        // instead of COUNT(*) which requires a full table scan.
        let total_count: i64 = if where_clauses.is_empty() {
            let count_row = sqlx::query(
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
            count_row
                .try_get::<i64, _>("estimate")
                .unwrap_or(0)
                .max(0)
        } else {
            // Filters applied — exact count is needed
            let count_sql = format!("SELECT COUNT(*) FROM {}{}", qualified_table, where_sql);
            let mut count_query = sqlx::query(&count_sql);
            for val in &bind_values {
                count_query = count_query.bind(val);
            }
            let count_row = count_query
                .fetch_one(&self.pool)
                .await
                .map_err(|e| e.to_string())?;
            count_row.get(0)
        };

        // Fetch filtered paginated data
        let data_sql = format!(
            "SELECT * FROM {}{} LIMIT {} OFFSET {}",
            qualified_table, where_sql, limit, offset
        );
        eprintln!(
            "[get_filtered_table_data] SQL: {} | binds: {:?}",
            data_sql, bind_values
        );
        let mut data_query = sqlx::query(&data_sql);
        for val in &bind_values {
            data_query = data_query.bind(val);
        }
        let rows = data_query
            .fetch_all(&self.pool)
            .await
            .map_err(|e| {
                eprintln!("[get_filtered_table_data] error: {}", e);
                e.to_string()
            })?;

        let (results, columns_info) = decode::decode_rows(&rows, Some(ordered_columns));

        Ok(PaginatedTableData {
            rows: results,
            total_count,
            columns: columns_info,
        })
    }

    async fn get_enum_values(
        &self,
        table: &str,
        column: &str,
        schema: &str,
    ) -> Result<EnumValues, String> {
        // Query pg_enum to get enum labels for the type used by this column
        let rows = sqlx::query(
            r#"
            SELECT e.enumlabel
            FROM pg_enum e
            JOIN pg_type t ON e.enumtypid = t.oid
            JOIN pg_attribute a ON a.atttypid = t.oid
            JOIN pg_class c ON a.attrelid = c.oid
            JOIN pg_namespace n ON c.relnamespace = n.oid
            WHERE c.relname = $1 AND a.attname = $2 AND n.nspname = $3
            ORDER BY e.enumsortorder
            "#,
        )
        .bind(table)
        .bind(column)
        .bind(schema)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        let values: Vec<String> = rows.iter().map(|r| r.get("enumlabel")).collect();

        Ok(EnumValues { values })
    }

    async fn execute_query(&self, query: &str) -> Result<QueryResult, String> {
        let start_time = std::time::Instant::now();

        let rows = sqlx::query(query)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| e.to_string())?;

        let execution_time_ms = start_time.elapsed().as_millis();
        let rows_affected = rows.len() as u64;

        let (results, columns_info) = decode::decode_rows(&rows, None);

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
