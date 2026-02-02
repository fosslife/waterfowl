//! PostgreSQL value decoding utilities.
//!
//! This module handles converting PostgreSQL column values to JSON-compatible types
//! for display in the frontend. It supports all common PostgreSQL data types.

use serde_json::{json, Map, Value};
use sqlx::postgres::{PgRow, PgValueFormat};
use sqlx::{Column, Row, TypeInfo, ValueRef};

use crate::types::ColumnInfo;

/// Decode a vector of PgRows into JSON-compatible maps and extract column info.
pub fn decode_rows(rows: &[PgRow]) -> (Vec<Map<String, Value>>, Vec<ColumnInfo>) {
    let mut results = Vec::new();
    let mut columns_info = Vec::new();

    // Extract column metadata from the first row
    if let Some(first_row) = rows.first() {
        for col in first_row.columns() {
            columns_info.push(ColumnInfo {
                name: col.name().to_string(),
                data_type: col.type_info().name().to_string(),
            });
        }
    }

    for row in rows {
        let mut map = Map::new();
        for col in row.columns() {
            let col_name = col.name();
            let value_ref = row.try_get_raw(col.ordinal()).unwrap();

            let val = if value_ref.is_null() {
                Value::Null
            } else {
                let type_name = col.type_info().name();
                decode_pg_value(row, col.ordinal(), type_name)
            };
            map.insert(col_name.to_string(), val);
        }
        results.push(map);
    }

    (results, columns_info)
}

/// Decodes a PostgreSQL value to a serde_json::Value based on its type.
/// Handles all common PostgreSQL data types for display in the UI.
fn decode_pg_value(row: &PgRow, ordinal: usize, type_name: &str) -> Value {

    
    match type_name {
        // ===== Boolean =====
        "BOOL" => {
            let b: bool = row.get(ordinal);
            Value::Bool(b)
        }

        // ===== Integer types =====
        "INT2" | "SMALLINT" | "SMALLSERIAL" => {
            let i: i16 = row.get(ordinal);
            json!(i)
        }
        "INT4" | "INTEGER" | "SERIAL" => {
            let i: i32 = row.get(ordinal);
            json!(i)
        }
        "INT8" | "BIGINT" | "BIGSERIAL" => {
            let i: i64 = row.get(ordinal);
            json!(i)
        }
        "OID" => {
            // OID is internally an i32 in sqlx for Postgres
            let i: i32 = row.get(ordinal);
            json!(i)
        }

        // ===== Float types =====
        "FLOAT4" | "REAL" => {
            let f: f32 = row.get(ordinal);
            json!(f)
        }
        "FLOAT8" | "DOUBLE PRECISION" => {
            let f: f64 = row.get(ordinal);
            json!(f)
        }

        // ===== Numeric/Decimal =====
        "NUMERIC" | "DECIMAL" => match row.try_get::<sqlx::types::BigDecimal, _>(ordinal) {
            Ok(d) => Value::String(d.to_string()),
            Err(_) => Value::String("[NUMERIC]".to_string()),
        },

        // ===== Money =====
        "MONEY" => {
            // Money is stored as i64 cents, we decode via PgMoney
            match row.try_get::<sqlx::postgres::types::PgMoney, _>(ordinal) {
                Ok(m) => Value::String(format!("${:.2}", m.0 as f64 / 100.0)),
                Err(_) => Value::String("[MONEY]".to_string()),
            }
        }

        // ===== Text types =====
        "TEXT" | "VARCHAR" | "CHAR" | "BPCHAR" | "NAME" | "UNKNOWN" => {
            let s: String = row.get(ordinal);
            Value::String(s)
        }

        // ===== Binary =====
        "BYTEA" => {
            let bytes: Vec<u8> = row.get(ordinal);
            if bytes.len() > 100 {
                Value::String(format!(
                    "\\x{}... ({} bytes)",
                    hex::encode(&bytes[..50]),
                    bytes.len()
                ))
            } else {
                Value::String(format!("\\x{}", hex::encode(&bytes)))
            }
        }

        // ===== JSON types =====
        "JSON" | "JSONB" => {
            let v: Value = row.get(ordinal);
            v
        }

        // ===== UUID =====
        "UUID" => {
            let u: uuid::Uuid = row.get(ordinal);
            Value::String(u.to_string())
        }

        // ===== Date/Time types =====
        "DATE" => {
            let d: chrono::NaiveDate = row.get(ordinal);
            Value::String(d.to_string())
        }
        "TIME" => {
            let t: chrono::NaiveTime = row.get(ordinal);
            Value::String(t.to_string())
        }
        "TIMETZ" => {
            // Time with timezone - decode as PgTimeTz
            match row.try_get::<sqlx::postgres::types::PgTimeTz, _>(ordinal) {
                Ok(t) => {
                    Value::String(format!("{}{:+}", t.time, t.offset.local_minus_utc() / 3600))
                }
                Err(_) => Value::String("[TIMETZ]".to_string()),
            }
        }
        "TIMESTAMP" => {
            let ts: chrono::NaiveDateTime = row.get(ordinal);
            Value::String(ts.to_string())
        }
        "TIMESTAMPTZ" => {
            let ts: chrono::DateTime<chrono::Utc> = row.get(ordinal);
            Value::String(ts.to_rfc3339())
        }
        "INTERVAL" => match row.try_get::<sqlx::postgres::types::PgInterval, _>(ordinal) {
            Ok(interval) => format_interval(&interval),
            Err(_) => Value::String("[INTERVAL]".to_string()),
        },

        // ===== Network types =====
        "INET" => match row.try_get::<ipnetwork::IpNetwork, _>(ordinal) {
            Ok(ip) => Value::String(ip.to_string()),
            Err(_) => Value::String("[INET]".to_string()),
        },
        "CIDR" => match row.try_get::<ipnetwork::IpNetwork, _>(ordinal) {
            Ok(ip) => Value::String(ip.to_string()),
            Err(_) => Value::String("[CIDR]".to_string()),
        },
        "MACADDR" => match row.try_get::<mac_address::MacAddress, _>(ordinal) {
            Ok(mac) => Value::String(mac.to_string()),
            Err(_) => Value::String("[MACADDR]".to_string()),
        },
        "MACADDR8" => {
            // MACADDR8 might not have direct support, try as bytes
            match row.try_get::<mac_address::MacAddress, _>(ordinal) {
                Ok(mac) => Value::String(mac.to_string()),
                Err(_) => Value::String("[MACADDR8]".to_string()),
            }
        }

        // ===== Geometric types =====
        "POINT" => match row.try_get::<sqlx::postgres::types::PgPoint, _>(ordinal) {
            Ok(p) => Value::String(format!("({},{})", p.x, p.y)),
            Err(_) => Value::String("[POINT]".to_string()),
        },
        "LINE" => {
            // LINE is stored as {A,B,C} representing Ax + By + C = 0
            // sqlx doesn't have a built-in type, decode raw
            decode_pg_raw_text(row, ordinal, "LINE")
        }
        "LSEG" => decode_pg_raw_text(row, ordinal, "LSEG"),
        "BOX" => match row.try_get::<sqlx::postgres::types::PgBox, _>(ordinal) {
            Ok(b) => Value::String(format!(
                "(({},{}),({},{}))",
                b.upper_right_x, b.upper_right_y, b.lower_left_x, b.lower_left_y
            )),
            Err(_) => decode_pg_raw_text(row, ordinal, "BOX"),
        },
        "PATH" => decode_pg_raw_text(row, ordinal, "PATH"),
        "POLYGON" => decode_pg_raw_text(row, ordinal, "POLYGON"),
        "CIRCLE" => decode_pg_raw_text(row, ordinal, "CIRCLE"),

        // ===== Range types =====
        "INT4RANGE" => match row.try_get::<sqlx::postgres::types::PgRange<i32>, _>(ordinal) {
            Ok(r) => format_pg_range(&r),
            Err(_) => Value::String("[INT4RANGE]".to_string()),
        },
        "INT8RANGE" => match row.try_get::<sqlx::postgres::types::PgRange<i64>, _>(ordinal) {
            Ok(r) => format_pg_range(&r),
            Err(_) => Value::String("[INT8RANGE]".to_string()),
        },
        "NUMRANGE" => {
            match row.try_get::<sqlx::postgres::types::PgRange<sqlx::types::BigDecimal>, _>(ordinal)
            {
                Ok(r) => format_pg_range_decimal(&r),
                Err(_) => Value::String("[NUMRANGE]".to_string()),
            }
        }
        "DATERANGE" => {
            match row.try_get::<sqlx::postgres::types::PgRange<chrono::NaiveDate>, _>(ordinal) {
                Ok(r) => format_pg_range(&r),
                Err(_) => Value::String("[DATERANGE]".to_string()),
            }
        }
        "TSRANGE" => {
            match row.try_get::<sqlx::postgres::types::PgRange<chrono::NaiveDateTime>, _>(ordinal) {
                Ok(r) => format_pg_range(&r),
                Err(_) => Value::String("[TSRANGE]".to_string()),
            }
        }
        "TSTZRANGE" => {
            match row.try_get::<sqlx::postgres::types::PgRange<chrono::DateTime<chrono::Utc>>, _>(
                ordinal,
            ) {
                Ok(r) => format_pg_range(&r),
                Err(_) => Value::String("[TSTZRANGE]".to_string()),
            }
        }

        // ===== Bit string types =====
        "BIT" | "VARBIT" => {
            // BitVec requires the "bit-vec" feature, use raw text decode instead
            decode_pg_raw_text(row, ordinal, type_name)
        }

        // ===== Text search types =====
        "TSVECTOR" => decode_pg_raw_text(row, ordinal, "TSVECTOR"),
        "TSQUERY" => decode_pg_raw_text(row, ordinal, "TSQUERY"),

        // ===== XML =====
        "XML" => match row.try_get::<String, _>(ordinal) {
            Ok(s) => Value::String(s),
            Err(_) => Value::String("[XML]".to_string()),
        },

        // ===== Array types =====
        // Note: sqlx returns type names like "TEXT[]", "VARCHAR[]" (with [] suffix)
        "_BOOL" | "BOOL[]" => {
            let arr: Vec<bool> = row.get(ordinal);
            json!(arr)
        }
        "_INT2" | "INT2[]" | "SMALLINT[]" => {
            let arr: Vec<i16> = row.get(ordinal);
            json!(arr)
        }
        "_INT4" | "INT4[]" | "INTEGER[]" | "INT[]" => {
            let arr: Vec<i32> = row.get(ordinal);
            json!(arr)
        }
        "_INT8" | "INT8[]" | "BIGINT[]" => {
            let arr: Vec<i64> = row.get(ordinal);
            json!(arr)
        }
        "_FLOAT4" | "FLOAT4[]" | "REAL[]" => {
            let arr: Vec<f32> = row.get(ordinal);
            json!(arr)
        }
        "_FLOAT8" | "FLOAT8[]" | "DOUBLE PRECISION[]" => {
            let arr: Vec<f64> = row.get(ordinal);
            json!(arr)
        }
        "_TEXT" | "_VARCHAR" | "_BPCHAR" | "_NAME" | "TEXT[]" | "VARCHAR[]" | "BPCHAR[]" | "NAME[]" | "CHAR[]" => {
            let arr: Vec<String> = row.get(ordinal);
            json!(arr)
        }
        "_UUID" | "UUID[]" => {
            let arr: Vec<uuid::Uuid> = row.get(ordinal);
            let strings: Vec<String> = arr.iter().map(|u| u.to_string()).collect();
            json!(strings)
        }
        "_JSONB" | "_JSON" | "JSONB[]" | "JSON[]" => {
            let arr: Vec<Value> = row.get(ordinal);
            json!(arr)
        }
        "_INET" | "INET[]" => match row.try_get::<Vec<ipnetwork::IpNetwork>, _>(ordinal) {
            Ok(arr) => {
                let strings: Vec<String> = arr.iter().map(|ip| ip.to_string()).collect();
                json!(strings)
            }
            Err(_) => Value::String("[INET[]]".to_string()),
        },
        "_DATE" | "DATE[]" => {
            let arr: Vec<chrono::NaiveDate> = row.get(ordinal);
            let strings: Vec<String> = arr.iter().map(|d| d.to_string()).collect();
            json!(strings)
        }
        "_TIMESTAMP" | "TIMESTAMP[]" => {
            let arr: Vec<chrono::NaiveDateTime> = row.get(ordinal);
            let strings: Vec<String> = arr.iter().map(|ts| ts.to_string()).collect();
            json!(strings)
        }
        "_TIMESTAMPTZ" | "TIMESTAMPTZ[]" => {
            let arr: Vec<chrono::DateTime<chrono::Utc>> = row.get(ordinal);
            let strings: Vec<String> = arr.iter().map(|ts| ts.to_rfc3339()).collect();
            json!(strings)
        }

        // ===== Custom ENUMs, arrays, and unknown types =====
        _ => {
            
            // Check if this is an array type (ends with "[]" or starts with "_")
            let is_array = type_name.ends_with("[]") || type_name.starts_with('_');
            
            if is_array {
                // Try to decode as Vec<String> - works for enum arrays, custom type arrays, etc.
                match row.try_get::<Vec<String>, _>(ordinal) {
                    Ok(arr) => {
                        return json!(arr);
                    }
                    Err(e) => {
                        // Try raw text decode for array
                        let result = decode_pg_raw_text(row, ordinal, type_name);
                        return result;
                    }
                }
            }

            // For non-array types, try to decode as String (works for ENUMs and many other types)
            match row.try_get::<String, _>(ordinal) {
                Ok(s) => {
                    Value::String(s)
                }
                Err(e) => {
                    // Try raw text decode as last resort
                    decode_pg_raw_text(row, ordinal, type_name)
                }
            }
        }
    }
}

/// Attempts to decode a PostgreSQL value by getting its raw bytes.
/// For binary format, tries to interpret as UTF-8 first (works for enums and many text-like types).
fn decode_pg_raw_text(row: &PgRow, ordinal: usize, type_name: &str) -> Value {
    match row.try_get_raw(ordinal) {
        Ok(value_ref) => {
            // Check if we can get the raw bytes
            match value_ref.format() {
                PgValueFormat::Text => {
                    // Text format - we can convert directly to string
                    match value_ref.as_bytes() {
                        Ok(bytes) => match std::str::from_utf8(bytes) {
                            Ok(s) => Value::String(s.to_string()),
                            Err(_) => Value::String(format!("[{} - invalid UTF-8]", type_name)),
                        },
                        Err(_) => Value::String(format!("[{}]", type_name)),
                    }
                }
                PgValueFormat::Binary => {
                    // Binary format - try to interpret as UTF-8 first.
                    // This works for PostgreSQL ENUMs (which are stored as their text labels)
                    // and other text-like types that sqlx doesn't have native support for.
                    match value_ref.as_bytes() {
                        Ok(bytes) => match std::str::from_utf8(bytes) {
                            Ok(s) => Value::String(s.to_string()),
                            Err(_) => {
                                // Not valid UTF-8, show hex representation
                                if bytes.len() <= 100 {
                                    Value::String(format!(
                                        "[{}: \\x{}]",
                                        type_name,
                                        hex::encode(bytes)
                                    ))
                                } else {
                                    Value::String(format!("[{}: {} bytes]", type_name, bytes.len()))
                                }
                            }
                        },
                        Err(_) => Value::String(format!("[{}]", type_name)),
                    }
                }
            }
        }
        Err(_) => Value::String(format!("[{}]", type_name)),
    }
}

/// Formats a PgInterval into a human-readable string.
fn format_interval(interval: &sqlx::postgres::types::PgInterval) -> Value {
    let mut parts = Vec::new();
    if interval.months != 0 {
        let years = interval.months / 12;
        let months = interval.months % 12;
        if years != 0 {
            parts.push(format!(
                "{} year{}",
                years,
                if years.abs() != 1 { "s" } else { "" }
            ));
        }
        if months != 0 {
            parts.push(format!(
                "{} mon{}",
                months,
                if months.abs() != 1 { "s" } else { "" }
            ));
        }
    }
    if interval.days != 0 {
        parts.push(format!(
            "{} day{}",
            interval.days,
            if interval.days.abs() != 1 { "s" } else { "" }
        ));
    }
    if interval.microseconds != 0 {
        let total_secs = interval.microseconds / 1_000_000;
        let hours = total_secs / 3600;
        let mins = (total_secs % 3600) / 60;
        let secs = total_secs % 60;
        let micros = interval.microseconds % 1_000_000;
        if hours != 0 || mins != 0 || secs != 0 || micros != 0 {
            if micros != 0 {
                parts.push(format!("{:02}:{:02}:{:02}.{:06}", hours, mins, secs, micros));
            } else {
                parts.push(format!("{:02}:{:02}:{:02}", hours, mins, secs));
            }
        }
    }
    if parts.is_empty() {
        Value::String("00:00:00".to_string())
    } else {
        Value::String(parts.join(" "))
    }
}

/// Formats a PgRange into a human-readable string.
fn format_pg_range<T: std::fmt::Display>(range: &sqlx::postgres::types::PgRange<T>) -> Value {
    use std::ops::Bound;

    let start = match &range.start {
        Bound::Included(v) => format!("[{}", v),
        Bound::Excluded(v) => format!("({}", v),
        Bound::Unbounded => "(".to_string(),
    };

    let end = match &range.end {
        Bound::Included(v) => format!("{}]", v),
        Bound::Excluded(v) => format!("{})", v),
        Bound::Unbounded => ")".to_string(),
    };

    Value::String(format!("{},{}", start, end))
}

/// Formats a PgRange of BigDecimal.
fn format_pg_range_decimal(
    range: &sqlx::postgres::types::PgRange<sqlx::types::BigDecimal>,
) -> Value {
    use std::ops::Bound;

    let start = match &range.start {
        Bound::Included(v) => format!("[{}", v),
        Bound::Excluded(v) => format!("({}", v),
        Bound::Unbounded => "(".to_string(),
    };

    let end = match &range.end {
        Bound::Included(v) => format!("{}]", v),
        Bound::Excluded(v) => format!("{})", v),
        Bound::Unbounded => ")".to_string(),
    };

    Value::String(format!("{},{}", start, end))
}
