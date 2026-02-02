use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Configuration for a database connection.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ConnectionConfig {
    pub id: Option<String>,
    pub name: String,
    pub host: String,
    pub port: String,
    pub user: String,
    pub password: Option<String>,
    pub database: String,
    pub driver: String,
    #[serde(default = "default_schema")]
    pub default_schema: String,
}

fn default_schema() -> String {
    "public".to_string()
}

impl ConnectionConfig {
    /// Builds a connection URL for the database.
    pub fn to_connection_url(&self) -> String {
        let password = self.password.clone().unwrap_or_default();
        match self.driver.as_str() {
            "postgres" | "postgresql" => {
                format!(
                    "postgres://{}:{}@{}:{}/{}",
                    self.user, password, self.host, self.port, self.database
                )
            }
            // Future: Add MySQL, SQLite, etc.
            _ => format!(
                "postgres://{}:{}@{}:{}/{}",
                self.user, password, self.host, self.port, self.database
            ),
        }
    }
}

/// High-level database statistics.
#[derive(Serialize)]
pub struct DatabaseInfo {
    pub version: String,
    pub database_name: String,
    pub database_size: String,
    pub total_tables: i64,
    pub total_views: i64,
    pub total_functions: i64,
    pub total_sequences: i64,
}

/// Represents a database object (table, view, function, sequence).
#[derive(Serialize)]
pub struct SchemaObject {
    pub name: String,
    pub object_type: String,
    pub row_count: Option<i64>,
    pub size: Option<String>,
}

/// Collection of schema objects grouped by type.
#[derive(Serialize)]
pub struct SchemaObjects {
    pub tables: Vec<SchemaObject>,
    pub views: Vec<SchemaObject>,
    pub functions: Vec<SchemaObject>,
    pub sequences: Vec<SchemaObject>,
}

/// Column metadata.
#[derive(Serialize, Clone)]
pub struct ColumnInfo {
    pub name: String,
    /// PostgreSQL type name (e.g., "TEXT", "INT4", "user_role" for enums)
    #[serde(rename = "pg_type")]
    pub data_type: String,
}

/// Result of a paginated table data query.
#[derive(Serialize)]
pub struct PaginatedTableData {
    pub rows: Vec<Map<String, Value>>,
    pub total_count: i64,
    pub columns: Vec<ColumnInfo>,
}

/// Result of executing a SQL query.
#[derive(Serialize)]
pub struct QueryResult {
    pub rows: Vec<Map<String, Value>>,
    pub columns: Vec<ColumnInfo>,
    pub rows_affected: u64,
    pub execution_time_ms: u128,
}
