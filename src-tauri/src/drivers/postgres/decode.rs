//! PostgreSQL value decoding utilities.
//!
//! This module handles converting PostgreSQL column values to JSON-compatible types
//! for display in the frontend. It supports all common PostgreSQL data types.

use serde_json::{json, Map, Value};
use sqlx::postgres::{PgRow, PgValueFormat};
use sqlx::{Column, Row, TypeInfo, ValueRef};

use crate::types::ColumnInfo;

/// What the decoded value is for. The two consumers want different things
/// from a large value: a grid cell is unreadable past a certain size and
/// shipping megabytes over IPC to render it is waste, while an export has to
/// carry the value in full or it isn't a copy of the data.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodeMode {
    /// Rendering into the results grid — large values may be abbreviated.
    Display,
    /// Writing to an export file — values must survive a round trip.
    Export,
}

/// Longest `bytea` rendered in full for display before it's abbreviated.
const DISPLAY_BYTEA_LIMIT: usize = 100;

/// Decode a single row into a pre-allocated `Vec<Value>` indexed by the
/// caller-supplied column order. `out` is cleared and refilled — caller can
/// reuse the same buffer across rows to avoid per-row allocation.
///
/// Used by the streaming export path which walks the row cursor one row at
/// a time and serializes each decoded row immediately, so it decodes in
/// `Export` mode.
pub fn decode_pg_row_values(row: &PgRow, columns: &[ColumnInfo], out: &mut Vec<Value>) {
    out.clear();
    out.reserve(columns.len());
    // Decoding by ordinal works because `columns` was built from
    // information_schema.columns in ordinal order and the SELECT * preserves
    // that order.
    for (idx, col) in columns.iter().enumerate() {
        let value_ref = match row.try_get_raw(idx) {
            Ok(v) => v,
            Err(_) => {
                out.push(Value::Null);
                continue;
            }
        };
        if value_ref.is_null() {
            out.push(Value::Null);
            continue;
        }
        // Use the source-of-truth type name from the row's column metadata
        // (it matches what the live decoder uses), not the information_schema
        // udt_name which may differ in casing for builtin types.
        let type_name = row
            .columns()
            .get(idx)
            .map(|c| c.type_info().name())
            .unwrap_or(col.data_type.as_str());
        out.push(decode_pg_value(row, idx, type_name, DecodeMode::Export));
    }
}

/// Decode a vector of PgRows into JSON-compatible maps and extract column info.
/// If `column_order` is provided, columns will be returned in that order.
/// Otherwise, columns are extracted from the result set (may not preserve schema order).
pub fn decode_rows(
    rows: &[PgRow],
    column_order: Option<Vec<ColumnInfo>>,
) -> (Vec<Map<String, Value>>, Vec<ColumnInfo>) {
    let mut results = Vec::new();

    // Use provided column order, or extract from result set
    let columns_info = if let Some(ordered_cols) = column_order {
        ordered_cols
    } else {
        // Extract column metadata from the first row (fallback, may not preserve order)
        if let Some(first_row) = rows.first() {
            first_row
                .columns()
                .iter()
                .map(|col| ColumnInfo {
                    name: col.name().to_string(),
                    data_type: col.type_info().name().to_string(),
                    ordinal_position: None,
                })
                .collect()
        } else {
            Vec::new()
        }
    };

    for row in rows {
        let mut map = Map::new();
        for col in row.columns() {
            let col_name = col.name();

            // A raw read can only fail on an out-of-range ordinal, but treat it
            // as a null cell rather than a panic — same as the streaming path.
            let val = match row.try_get_raw(col.ordinal()) {
                Ok(value_ref) if !value_ref.is_null() => {
                    let type_name = col.type_info().name();
                    decode_pg_value(row, col.ordinal(), type_name, DecodeMode::Display)
                }
                _ => Value::Null,
            };
            map.insert(col_name.to_string(), val);
        }
        results.push(map);
    }

    (results, columns_info)
}

/// Decodes `ordinal` as `T` and maps it through `to_value`, falling back to a
/// raw-text read when the value doesn't match the type we expected.
///
/// `row.get()` panics on a decode failure, which takes the whole Tauri process
/// down — a malformed value or a type the server reports differently than we
/// assume is a user-visible crash rather than one bad cell. Every decode arm
/// goes through here so the worst case is a placeholder string in one cell.
fn try_decode<'r, T>(
    row: &'r PgRow,
    ordinal: usize,
    type_name: &str,
    to_value: impl FnOnce(T) -> Value,
) -> Value
where
    T: sqlx::Decode<'r, sqlx::Postgres> + sqlx::Type<sqlx::Postgres>,
{
    match row.try_get::<T, _>(ordinal) {
        Ok(v) => to_value(v),
        Err(_) => decode_pg_raw_text(row, ordinal, type_name),
    }
}

/// Decodes a PostgreSQL value to a serde_json::Value based on its type.
/// Handles all common PostgreSQL data types.
///
/// `mode` only affects values large enough that the grid would abbreviate
/// them; everything else decodes identically either way.
fn decode_pg_value(row: &PgRow, ordinal: usize, type_name: &str, mode: DecodeMode) -> Value {
    match type_name {
        // ===== Boolean =====
        "BOOL" => try_decode(row, ordinal, type_name, |b: bool| Value::Bool(b)),

        // ===== Integer types =====
        "INT2" | "SMALLINT" | "SMALLSERIAL" => {
            try_decode(row, ordinal, type_name, |i: i16| json!(i))
        }
        "INT4" | "INTEGER" | "SERIAL" => try_decode(row, ordinal, type_name, |i: i32| json!(i)),
        "INT8" | "BIGINT" | "BIGSERIAL" => try_decode(row, ordinal, type_name, |i: i64| json!(i)),
        // OID is internally an i32 in sqlx for Postgres
        "OID" => try_decode(row, ordinal, type_name, |i: i32| json!(i)),

        // ===== Float types =====
        "FLOAT4" | "REAL" => try_decode(row, ordinal, type_name, |f: f32| json!(f)),
        "FLOAT8" | "DOUBLE PRECISION" => try_decode(row, ordinal, type_name, |f: f64| json!(f)),

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
            try_decode(row, ordinal, type_name, Value::String)
        }

        // ===== Binary =====
        // Abbreviated for the grid, written in full for an export — the
        // abbreviated form is `\x...` followed by a byte count, which is not
        // something PostgreSQL will take back on insert.
        "BYTEA" => try_decode(row, ordinal, type_name, |bytes: Vec<u8>| {
            if mode == DecodeMode::Display && bytes.len() > DISPLAY_BYTEA_LIMIT {
                Value::String(format!(
                    "\\x{}... ({} bytes)",
                    hex::encode(&bytes[..50]),
                    bytes.len()
                ))
            } else {
                Value::String(format!("\\x{}", hex::encode(&bytes)))
            }
        }),

        // ===== JSON types =====
        "JSON" | "JSONB" => try_decode(row, ordinal, type_name, |v: Value| v),

        // ===== UUID =====
        "UUID" => try_decode(row, ordinal, type_name, |u: uuid::Uuid| {
            Value::String(u.to_string())
        }),

        // ===== Date/Time types =====
        "DATE" => try_decode(row, ordinal, type_name, |d: chrono::NaiveDate| {
            Value::String(d.to_string())
        }),
        "TIME" => try_decode(row, ordinal, type_name, |t: chrono::NaiveTime| {
            Value::String(t.to_string())
        }),
        "TIMETZ" => {
            // Time with timezone - decode as PgTimeTz
            match row.try_get::<sqlx::postgres::types::PgTimeTz, _>(ordinal) {
                Ok(t) => Value::String(format!("{}{:+}", t.time, t.offset.whole_seconds() / 3600)),
                Err(_) => Value::String("[TIMETZ]".to_string()),
            }
        }
        "TIMESTAMP" => try_decode(row, ordinal, type_name, |ts: chrono::NaiveDateTime| {
            Value::String(ts.to_string())
        }),
        "TIMESTAMPTZ" => try_decode(
            row,
            ordinal,
            type_name,
            |ts: chrono::DateTime<chrono::Utc>| Value::String(ts.to_rfc3339()),
        ),
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
        "_BOOL" | "BOOL[]" => try_decode(row, ordinal, type_name, |arr: Vec<bool>| json!(arr)),
        "_INT2" | "INT2[]" | "SMALLINT[]" => {
            try_decode(row, ordinal, type_name, |arr: Vec<i16>| json!(arr))
        }
        "_INT4" | "INT4[]" | "INTEGER[]" | "INT[]" => {
            try_decode(row, ordinal, type_name, |arr: Vec<i32>| json!(arr))
        }
        "_INT8" | "INT8[]" | "BIGINT[]" => {
            try_decode(row, ordinal, type_name, |arr: Vec<i64>| json!(arr))
        }
        "_FLOAT4" | "FLOAT4[]" | "REAL[]" => {
            try_decode(row, ordinal, type_name, |arr: Vec<f32>| json!(arr))
        }
        "_FLOAT8" | "FLOAT8[]" | "DOUBLE PRECISION[]" => {
            try_decode(row, ordinal, type_name, |arr: Vec<f64>| json!(arr))
        }
        "_TEXT" | "_VARCHAR" | "_BPCHAR" | "_NAME" | "TEXT[]" | "VARCHAR[]" | "BPCHAR[]"
        | "NAME[]" | "CHAR[]" => try_decode(row, ordinal, type_name, |arr: Vec<String>| json!(arr)),
        "_UUID" | "UUID[]" => try_decode(row, ordinal, type_name, |arr: Vec<uuid::Uuid>| {
            let strings: Vec<String> = arr.iter().map(|u| u.to_string()).collect();
            json!(strings)
        }),
        "_JSONB" | "_JSON" | "JSONB[]" | "JSON[]" => {
            try_decode(row, ordinal, type_name, |arr: Vec<Value>| json!(arr))
        }
        "_INET" | "INET[]" => match row.try_get::<Vec<ipnetwork::IpNetwork>, _>(ordinal) {
            Ok(arr) => {
                let strings: Vec<String> = arr.iter().map(|ip| ip.to_string()).collect();
                json!(strings)
            }
            Err(_) => Value::String("[INET[]]".to_string()),
        },
        "_DATE" | "DATE[]" => try_decode(row, ordinal, type_name, |arr: Vec<chrono::NaiveDate>| {
            let strings: Vec<String> = arr.iter().map(|d| d.to_string()).collect();
            json!(strings)
        }),
        "_TIMESTAMP" | "TIMESTAMP[]" => try_decode(
            row,
            ordinal,
            type_name,
            |arr: Vec<chrono::NaiveDateTime>| {
                let strings: Vec<String> = arr.iter().map(|ts| ts.to_string()).collect();
                json!(strings)
            },
        ),
        "_TIMESTAMPTZ" | "TIMESTAMPTZ[]" => try_decode(
            row,
            ordinal,
            type_name,
            |arr: Vec<chrono::DateTime<chrono::Utc>>| {
                let strings: Vec<String> = arr.iter().map(|ts| ts.to_rfc3339()).collect();
                json!(strings)
            },
        ),

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
                    Err(_e) => {
                        // Try raw text decode for array
                        let result = decode_pg_raw_text(row, ordinal, type_name);
                        return result;
                    }
                }
            }

            // For non-array types, try to decode as String (works for ENUMs and many other types)
            match row.try_get::<String, _>(ordinal) {
                Ok(s) => Value::String(s),
                Err(_e) => {
                    // Try raw text decode as last resort
                    decode_pg_raw_text(row, ordinal, type_name)
                }
            }
        }
    }
}

/// Does `s` contain C0 control characters that mark it as packed binary
/// rather than text? Tab, newline and carriage return are excluded — those
/// appear in genuine text values.
fn has_binary_control_chars(s: &str) -> bool {
    s.chars()
        .any(|c| (c as u32) < 0x20 && c != '\t' && c != '\n' && c != '\r')
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
                        // Valid UTF-8 alone isn't enough to call something text:
                        // `bit`, `varbit` and `tsvector` send a length prefix and
                        // packed bytes that often decode "successfully" into
                        // control characters. Those aren't displayable, and a NUL
                        // can't even survive a round trip through a PostgreSQL
                        // text value — an export carrying one is rejected by the
                        // server on replay. Treat them as binary instead.
                        Ok(bytes) => match std::str::from_utf8(bytes) {
                            Ok(s) if !has_binary_control_chars(s) => Value::String(s.to_string()),
                            _ => {
                                // Not text, show hex representation
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
                parts.push(format!(
                    "{:02}:{:02}:{:02}.{:06}",
                    hours, mins, secs, micros
                ));
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

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::postgres::PgPoolOptions;
    use sqlx::PgPool;

    /// Matches the credentials in `dev/compose.yaml` and `dev/seed.ts`.
    const DEV_DATABASE_URL: &str = "postgresql://postgres:postgres@localhost:5432/waterfowl_test";

    /// Connects to the seeded dev database, or returns `None` so the test
    /// reports as passing on machines that haven't brought it up. Run
    /// `podman compose -f dev/compose.yaml up -d && pnpm seed` first for these
    /// to do anything.
    async fn dev_pool() -> Option<PgPool> {
        match PgPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(std::time::Duration::from_secs(3))
            .connect(DEV_DATABASE_URL)
            .await
        {
            Ok(pool) => Some(pool),
            Err(e) => {
                eprintln!("skipping: dev database unreachable ({e})");
                None
            }
        }
    }

    /// Columns of `type_showcase` that still render as a `[TYPE]` placeholder
    /// or a hex dump instead of their real value. All pre-existing gaps, not
    /// decode failures: the geometric and bit-string types have no sqlx
    /// decoder here and fall through to `decode_pg_raw_text`, which can only
    /// produce hex for a binary-format value; `macaddr8` is 8 bytes and the
    /// `MacAddress` decoder wants 6; the three ranges fail `PgRange` decoding
    /// while `int4range`/`int8range`/`daterange` succeed.
    ///
    /// Pinned so the list can only shrink. Remove entries as they get real
    /// decoders.
    const KNOWN_PLACEHOLDER_COLUMNS: &[&str] = &[
        "col_bit",
        "col_circle",
        "col_line",
        "col_lseg",
        "col_macaddr8",
        "col_numrange",
        "col_path",
        "col_polygon",
        "col_tsquery",
        "col_tsrange",
        "col_tstzrange",
        "col_tsvector",
        "col_varbit",
    ];

    /// Every column of `type_showcase` decodes to something, and only the
    /// known-unsupported ones fall through to a `[TYPE]` placeholder.
    #[tokio::test]
    async fn decodes_every_showcase_type() {
        let Some(pool) = dev_pool().await else { return };

        let rows = sqlx::query("SELECT * FROM type_showcase LIMIT 25")
            .fetch_all(&pool)
            .await
            .expect("query type_showcase");
        assert!(!rows.is_empty(), "type_showcase is empty — run `pnpm seed`");

        let (decoded, _columns) = decode_rows(&rows, None);
        assert_eq!(decoded.len(), rows.len());

        let mut placeholders: Vec<String> = Vec::new();
        for row in &decoded {
            for (name, value) in row {
                if let Value::String(s) = value {
                    if s.starts_with('[') && s.ends_with(']') && !placeholders.contains(name) {
                        placeholders.push(name.clone());
                    }
                }
            }
        }
        placeholders.sort();
        assert_eq!(
            placeholders, KNOWN_PLACEHOLDER_COLUMNS,
            "columns rendering as a placeholder changed"
        );
    }

    /// A `bytea` past the display limit is abbreviated for the grid but must
    /// come out whole for an export — the abbreviated form carries a byte
    /// count that PostgreSQL won't accept back, so exporting it would quietly
    /// corrupt the column.
    #[tokio::test]
    async fn large_bytea_is_abbreviated_only_for_display() {
        let Some(pool) = dev_pool().await else { return };

        // 500 bytes of 0xAB — comfortably past DISPLAY_BYTEA_LIMIT.
        let row = sqlx::query("SELECT decode(repeat('ab', 500), 'hex') AS blob")
            .fetch_one(&pool)
            .await
            .expect("query bytea");

        let display = decode_pg_value(&row, 0, "BYTEA", DecodeMode::Display);
        let export = decode_pg_value(&row, 0, "BYTEA", DecodeMode::Export);

        let display = display.as_str().expect("display is a string");
        let export = export.as_str().expect("export is a string");

        assert!(
            display.ends_with("(500 bytes)"),
            "display should be abbreviated: {display}"
        );
        // 500 bytes as hex, plus the leading `\x`.
        assert_eq!(export.len(), 1002, "export should carry every byte");
        assert_eq!(export, format!("\\x{}", "ab".repeat(500)));
    }

    /// The regression this module's `try_decode` exists for: when the type we
    /// believe a column has disagrees with what the server actually sent, the
    /// decoder must degrade to a string instead of panicking and taking the
    /// whole process down. Each of these pairings used to be a `row.get()`
    /// unwind.
    #[tokio::test]
    async fn type_mismatch_degrades_instead_of_panicking() {
        let Some(pool) = dev_pool().await else { return };

        let row = sqlx::query(
            "SELECT col_text, col_integer, col_uuid, col_jsonb, col_timestamptz, \
             col_text_array, col_int_array, col_bytea \
             FROM type_showcase WHERE col_text IS NOT NULL LIMIT 1",
        )
        .fetch_one(&pool)
        .await
        .expect("query type_showcase");

        // Deliberately wrong type names, one per decode family.
        let mismatches = [
            (0, "INT4"),
            (0, "UUID"),
            (0, "TIMESTAMPTZ"),
            (0, "BOOL"),
            (0, "INT8[]"),
            (1, "TEXT[]"),
            (2, "INT2"),
            (3, "DATE"),
            (4, "BYTEA"),
            (5, "FLOAT8[]"),
            (6, "JSONB"),
            (7, "UUID[]"),
        ];

        for (ordinal, claimed_type) in mismatches {
            // Must return rather than unwind.
            let value = decode_pg_value(&row, ordinal, claimed_type, DecodeMode::Display);
            assert!(
                !value.is_null(),
                "ordinal {ordinal} as {claimed_type} decoded to null"
            );
        }
    }
}
