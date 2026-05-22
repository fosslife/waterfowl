//! CSV exporter following RFC 4180.
//!
//! Quoting rules: a field is wrapped in quotes when it contains the
//! delimiter, a quote character, CR, or LF. Embedded quotes are doubled.
//! Line ending is CRLF (RFC 4180); most consumers accept LF too but CRLF
//! is the safer default for Excel and Windows tooling.

use crate::exporters::Exporter;
use crate::types::ColumnInfo;
use serde::Deserialize;
use serde_json::Value;
use std::io::{self, Write};

/// CSV format options. Deserialized from the frontend's per-format options
/// blob. Defaults match the most common spreadsheet-friendly settings.
#[derive(Deserialize, Debug, Clone)]
pub struct CsvOptions {
    /// Field separator. Only the first byte is used — keep it ASCII.
    #[serde(default = "default_delimiter")]
    pub delimiter: String,
    /// Whether to emit a header row of column names.
    #[serde(default = "default_true")]
    pub include_header: bool,
    /// String to emit for SQL NULL values. Empty by default, which matches
    /// `psql \copy` output but loses the NULL-vs-empty-string distinction.
    #[serde(default)]
    pub null_string: String,
}

impl Default for CsvOptions {
    fn default() -> Self {
        Self {
            delimiter: default_delimiter(),
            include_header: true,
            null_string: String::new(),
        }
    }
}

fn default_delimiter() -> String {
    ",".to_string()
}

fn default_true() -> bool {
    true
}

const CRLF: &[u8] = b"\r\n";

pub struct CsvExporter {
    opts: CsvOptions,
    delim_byte: u8,
    /// Reusable scratch buffer for number formatting and `serde_json::to_string`
    /// so we don't allocate on every cell. Cleared between cells.
    scratch: String,
}

impl CsvExporter {
    pub fn new(opts: CsvOptions) -> Self {
        // Take first byte of the delimiter string; reject empty as a safe default.
        let delim_byte = opts.delimiter.as_bytes().first().copied().unwrap_or(b',');
        Self {
            opts,
            delim_byte,
            scratch: String::new(),
        }
    }

    /// Write `s` as a CSV field to `w`, quoting if required.
    /// Hot path — avoid allocation when no quoting is needed.
    /// Associated fn (not method) so callers can hold a `&mut self.scratch`
    /// borrow simultaneously (see `write_row`).
    fn write_field(s: &str, delim: u8, w: &mut dyn Write) -> io::Result<()> {
        if Self::needs_quoting(s, delim) {
            w.write_all(b"\"")?;
            // Walk bytes, escaping any embedded quote by doubling it.
            // We write contiguous runs between quotes in one call to minimize syscalls.
            let bytes = s.as_bytes();
            let mut start = 0;
            for (i, &b) in bytes.iter().enumerate() {
                if b == b'"' {
                    if start < i {
                        w.write_all(&bytes[start..i])?;
                    }
                    w.write_all(b"\"\"")?;
                    start = i + 1;
                }
            }
            if start < bytes.len() {
                w.write_all(&bytes[start..])?;
            }
            w.write_all(b"\"")?;
        } else {
            w.write_all(s.as_bytes())?;
        }
        Ok(())
    }

    fn needs_quoting(s: &str, delim: u8) -> bool {
        s.bytes()
            .any(|b| b == delim || b == b'"' || b == b'\n' || b == b'\r')
    }

    /// Format a JSON value into `scratch` and return its string slice,
    /// or `None` if the value is null (caller writes `null_string`).
    fn format_value<'a>(&'a mut self, v: &'a Value) -> Option<&'a str> {
        match v {
            Value::Null => None,
            Value::String(s) => Some(s.as_str()),
            Value::Bool(b) => Some(if *b { "true" } else { "false" }),
            Value::Number(n) => {
                self.scratch.clear();
                use std::fmt::Write as _;
                let _ = write!(&mut self.scratch, "{}", n);
                Some(self.scratch.as_str())
            }
            other => {
                // Arrays / objects: emit JSON form so the data survives a
                // CSV round-trip. CSV has no native nested type.
                self.scratch.clear();
                match serde_json::to_string(other) {
                    Ok(s) => self.scratch.push_str(&s),
                    Err(_) => self.scratch.push_str("[unserializable]"),
                }
                Some(self.scratch.as_str())
            }
        }
    }
}

impl Exporter for CsvExporter {
    fn write_header(
        &mut self,
        columns: &[ColumnInfo],
        w: &mut dyn Write,
    ) -> io::Result<()> {
        if !self.opts.include_header {
            return Ok(());
        }
        for (i, col) in columns.iter().enumerate() {
            if i > 0 {
                w.write_all(&[self.delim_byte])?;
            }
            Self::write_field(&col.name, self.delim_byte, w)?;
        }
        w.write_all(CRLF)
    }

    fn write_row(
        &mut self,
        values: &[Value],
        _columns: &[ColumnInfo],
        w: &mut dyn Write,
    ) -> io::Result<()> {
        // Capture into locals so `format_value` can hold a &mut borrow on self
        // without blocking subsequent field reads.
        let delim = self.delim_byte;
        for (i, v) in values.iter().enumerate() {
            if i > 0 {
                w.write_all(&[delim])?;
            }
            // Null handling is value-level, not formatter-level: format_value
            // returns None for Value::Null so we can write null_string without
            // touching the scratch buffer.
            if matches!(v, Value::Null) {
                w.write_all(self.opts.null_string.as_bytes())?;
                continue;
            }
            let s = self.format_value(v).expect("non-null handled above");
            Self::write_field(s, delim, w)?;
        }
        w.write_all(CRLF)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn col(name: &str) -> ColumnInfo {
        ColumnInfo {
            name: name.to_string(),
            data_type: "TEXT".to_string(),
            ordinal_position: None,
        }
    }

    fn export(opts: CsvOptions, columns: &[ColumnInfo], rows: &[Vec<Value>]) -> String {
        let mut exp = CsvExporter::new(opts);
        let mut buf: Vec<u8> = Vec::new();
        exp.write_header(columns, &mut buf).unwrap();
        for row in rows {
            exp.write_row(row, columns, &mut buf).unwrap();
        }
        exp.finalize(&mut buf).unwrap();
        String::from_utf8(buf).unwrap()
    }

    #[test]
    fn basic_row() {
        let out = export(
            CsvOptions::default(),
            &[col("a"), col("b")],
            &[vec![json!("hello"), json!(42)]],
        );
        assert_eq!(out, "a,b\r\nhello,42\r\n");
    }

    #[test]
    fn quotes_when_delimiter_present() {
        let out = export(
            CsvOptions::default(),
            &[col("a")],
            &[vec![json!("x,y")]],
        );
        assert_eq!(out, "a\r\n\"x,y\"\r\n");
    }

    #[test]
    fn doubles_embedded_quotes() {
        let out = export(
            CsvOptions::default(),
            &[col("a")],
            &[vec![json!("she said \"hi\"")]],
        );
        assert_eq!(out, "a\r\n\"she said \"\"hi\"\"\"\r\n");
    }

    #[test]
    fn quotes_when_newline_present() {
        let out = export(
            CsvOptions::default(),
            &[col("a")],
            &[vec![json!("line1\nline2")]],
        );
        assert_eq!(out, "a\r\n\"line1\nline2\"\r\n");
    }

    #[test]
    fn null_renders_as_empty_by_default() {
        let out = export(
            CsvOptions::default(),
            &[col("a"), col("b")],
            &[vec![Value::Null, json!("x")]],
        );
        assert_eq!(out, "a,b\r\n,x\r\n");
    }

    #[test]
    fn custom_null_string() {
        let opts = CsvOptions {
            null_string: "NULL".to_string(),
            ..Default::default()
        };
        let out = export(opts, &[col("a")], &[vec![Value::Null]]);
        assert_eq!(out, "a\r\nNULL\r\n");
    }

    #[test]
    fn header_can_be_disabled() {
        let opts = CsvOptions {
            include_header: false,
            ..Default::default()
        };
        let out = export(opts, &[col("a")], &[vec![json!("x")]]);
        assert_eq!(out, "x\r\n");
    }

    #[test]
    fn custom_delimiter() {
        let opts = CsvOptions {
            delimiter: "|".to_string(),
            ..Default::default()
        };
        let out = export(
            opts,
            &[col("a"), col("b")],
            &[vec![json!("x,y"), json!("z")]],
        );
        // "x,y" no longer needs quoting because delimiter is "|"
        assert_eq!(out, "a|b\r\nx,y|z\r\n");
    }

    #[test]
    fn booleans_and_numbers_are_unquoted() {
        let out = export(
            CsvOptions::default(),
            &[col("a"), col("b"), col("c")],
            &[vec![json!(true), json!(3.14), json!(-7)]],
        );
        assert_eq!(out, "a,b,c\r\ntrue,3.14,-7\r\n");
    }

    #[test]
    fn nested_values_serialize_as_json() {
        let out = export(
            CsvOptions::default(),
            &[col("a")],
            &[vec![json!({"k": 1})]],
        );
        // Object gets JSON-serialized and quoted because it contains a comma.
        assert_eq!(out, "a\r\n\"{\"\"k\"\":1}\"\r\n");
    }

    #[test]
    fn header_with_comma_in_column_name() {
        let out = export(
            CsvOptions::default(),
            &[col("first,last")],
            &[vec![json!("v")]],
        );
        assert_eq!(out, "\"first,last\"\r\nv\r\n");
    }
}
