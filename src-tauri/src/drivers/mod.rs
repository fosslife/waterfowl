//! Database driver abstraction layer.
//!
//! This module provides a unified interface for different database backends.
//! To add support for a new database (e.g., MySQL):
//! 1. Create a new module under `drivers/` (e.g., `drivers/mysql/`)
//! 2. Implement the `DatabaseDriver` trait
//! 3. Add the new driver to `DriverConnection` enum
//! 4. Update `create_driver` to handle the new driver type

pub mod postgres;

use async_trait::async_trait;
use crate::types::{
    ConnectionConfig, DatabaseInfo, FunctionInfo, PaginatedTableData, QueryResult, 
    SchemaObjects, SequenceInfo, TableStructure,
};

/// Trait that all database drivers must implement.
///
/// This abstraction allows the application to work with different databases
/// through a unified interface.
#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    /// Test if a connection can be established with the given config.
    async fn test_connection(config: &ConnectionConfig) -> Result<String, String>
    where
        Self: Sized;

    /// Get list of schemas in the database.
    async fn get_schemas(&self) -> Result<Vec<String>, String>;

    /// Get list of tables in a schema.
    async fn get_tables(&self, schema: &str) -> Result<Vec<String>, String>;

    /// Get paginated data from a table.
    async fn get_table_data(
        &self,
        table: &str,
        schema: &str,
        limit: i64,
        offset: i64,
    ) -> Result<PaginatedTableData, String>;

    /// Get paginated data from a view (read-only).
    async fn get_view_data(
        &self,
        view: &str,
        schema: &str,
        limit: i64,
        offset: i64,
    ) -> Result<PaginatedTableData, String>;

    /// Get high-level database information.
    async fn get_database_info(&self, schema: &str) -> Result<DatabaseInfo, String>;

    /// Get all objects in a schema (tables, views, functions, sequences).
    async fn get_schema_objects(&self, schema: &str) -> Result<SchemaObjects, String>;

    /// Get function definition and metadata.
    async fn get_function_info(&self, function_name: &str, schema: &str) -> Result<FunctionInfo, String>;

    /// Get sequence information.
    async fn get_sequence_info(&self, sequence_name: &str, schema: &str) -> Result<SequenceInfo, String>;

    /// Get table structure (columns, indexes, constraints).
    async fn get_table_structure(&self, table: &str, schema: &str) -> Result<TableStructure, String>;

    /// Execute an arbitrary SQL query.
    async fn execute_query(&self, query: &str) -> Result<QueryResult, String>;

    /// Close the connection.
    async fn close(&self);
}

/// Enum wrapping all supported database connections.
///
/// This allows storing different driver types in the same HashMap.
/// Clone is cheap as the underlying pools are Arc-based.
#[derive(Clone)]
pub enum DriverConnection {
    Postgres(postgres::PostgresDriver),
    // Future: MySQL(mysql::MySqlDriver),
    // Future: SQLite(sqlite::SqliteDriver),
}

impl DriverConnection {
    /// Create a new driver connection based on the config's driver type.
    pub async fn connect(config: &ConnectionConfig) -> Result<Self, String> {
        match config.driver.to_lowercase().as_str() {
            "postgres" | "postgresql" => {
                let driver = postgres::PostgresDriver::connect(config).await?;
                Ok(DriverConnection::Postgres(driver))
            }
            // Future: "mysql" => { ... }
            // Future: "sqlite" => { ... }
            other => Err(format!("Unsupported database driver: {}", other)),
        }
    }

    /// Test connection without establishing a persistent connection.
    pub async fn test(config: &ConnectionConfig) -> Result<String, String> {
        match config.driver.to_lowercase().as_str() {
            "postgres" | "postgresql" => postgres::PostgresDriver::test_connection(config).await,
            other => Err(format!("Unsupported database driver: {}", other)),
        }
    }
}

// Implement DatabaseDriver for DriverConnection by delegating to the inner driver
#[async_trait]
impl DatabaseDriver for DriverConnection {
    async fn test_connection(_config: &ConnectionConfig) -> Result<String, String> {
        // Use DriverConnection::test() instead
        Err("Use DriverConnection::test() for testing connections".to_string())
    }

    async fn get_schemas(&self) -> Result<Vec<String>, String> {
        match self {
            DriverConnection::Postgres(driver) => driver.get_schemas().await,
        }
    }

    async fn get_tables(&self, schema: &str) -> Result<Vec<String>, String> {
        match self {
            DriverConnection::Postgres(driver) => driver.get_tables(schema).await,
        }
    }

    async fn get_table_data(
        &self,
        table: &str,
        schema: &str,
        limit: i64,
        offset: i64,
    ) -> Result<PaginatedTableData, String> {
        match self {
            DriverConnection::Postgres(driver) => {
                driver.get_table_data(table, schema, limit, offset).await
            }
        }
    }

    async fn get_view_data(
        &self,
        view: &str,
        schema: &str,
        limit: i64,
        offset: i64,
    ) -> Result<PaginatedTableData, String> {
        match self {
            DriverConnection::Postgres(driver) => {
                driver.get_view_data(view, schema, limit, offset).await
            }
        }
    }

    async fn get_database_info(&self, schema: &str) -> Result<DatabaseInfo, String> {
        match self {
            DriverConnection::Postgres(driver) => driver.get_database_info(schema).await,
        }
    }

    async fn get_schema_objects(&self, schema: &str) -> Result<SchemaObjects, String> {
        match self {
            DriverConnection::Postgres(driver) => driver.get_schema_objects(schema).await,
        }
    }

    async fn get_function_info(&self, function_name: &str, schema: &str) -> Result<FunctionInfo, String> {
        match self {
            DriverConnection::Postgres(driver) => driver.get_function_info(function_name, schema).await,
        }
    }

    async fn get_sequence_info(&self, sequence_name: &str, schema: &str) -> Result<SequenceInfo, String> {
        match self {
            DriverConnection::Postgres(driver) => driver.get_sequence_info(sequence_name, schema).await,
        }
    }

    async fn get_table_structure(&self, table: &str, schema: &str) -> Result<TableStructure, String> {
        match self {
            DriverConnection::Postgres(driver) => driver.get_table_structure(table, schema).await,
        }
    }

    async fn execute_query(&self, query: &str) -> Result<QueryResult, String> {
        match self {
            DriverConnection::Postgres(driver) => driver.execute_query(query).await,
        }
    }

    async fn close(&self) {
        match self {
            DriverConnection::Postgres(driver) => driver.close().await,
        }
    }
}
