//! JSON exporter.
//!
//! Two layouts, because they serve different consumers:
//! - `array`: one JSON document, `[{...},{...}]`. Anything that parses JSON
//!   will read it, but the consumer has to hold the whole thing in memory.
//! - `ndjson`: one object per line, no wrapper. Streams into jq, BigQuery,
//!   ClickHouse and friends without a full parse.
//!
//! Both write row-at-a-time. The array layout only needs its brackets from
//! the first row and `finalize`, so memory stays constant either way.

use crate::exporters::Exporter;
use crate::types::ColumnInfo;
use serde::Deserialize;
use serde_json::{Map, Value};
use std::io::{self, Write};

#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum JsonLayout {
    /// A single `[...]` document.
    #[default]
    Array,
    /// Newline-delimited objects.
    Ndjson,
}

/// JSON format options. Deserialized from the frontend's per-format options
/// blob.
#[derive(Deserialize, Debug, Clone)]
pub struct JsonOptions {
    #[serde(default)]
    pub layout: JsonLayout,
    /// Indent objects across multiple lines. Ignored for ndjson, where one
    /// object per line is the whole point.
    #[serde(default)]
    pub pretty: bool,
    /// Emit `"col": null` for SQL NULLs. Turning this off omits the key
    /// instead, which makes sparse tables noticeably smaller.
    #[serde(default = "default_true")]
    pub include_nulls: bool,
}

impl Default for JsonOptions {
    fn default() -> Self {
        Self {
            layout: JsonLayout::default(),
            pretty: false,
            include_nulls: true,
        }
    }
}

fn default_true() -> bool {
    true
}

/// Indent applied to each object in a pretty-printed array, and the step
/// `serde_json`'s pretty printer uses internally.
const INDENT: &str = "  ";

pub struct JsonExporter {
    opts: JsonOptions,
    /// Whether any row has been written. Drives the opening `[` (written
    /// lazily on the first row) and the separator between elements, and lets
    /// `finalize` emit a bare `[]` for an empty result.
    wrote_any: bool,
    /// Reusable object buffer so we don't allocate a fresh `Map` per row.
    scratch: Map<String, Value>,
}

impl JsonExporter {
    pub fn new(opts: JsonOptions) -> Self {
        Self {
            opts,
            wrote_any: false,
            scratch: Map::new(),
        }
    }

    /// Serialize the current scratch object, applying the array layout's base
    /// indent to every line when pretty-printing.
    fn serialize_scratch(&self) -> io::Result<String> {
        let rendered = if self.opts.pretty {
            serde_json::to_string_pretty(&self.scratch)
        } else {
            serde_json::to_string(&self.scratch)
        }
        .map_err(io::Error::other)?;

        // `to_string_pretty` has no notion of a base indent, so nest the
        // object under the array by hand.
        if self.opts.pretty && self.opts.layout == JsonLayout::Array {
            let mut out = String::with_capacity(rendered.len() + rendered.len() / 8);
            for (i, line) in rendered.lines().enumerate() {
                if i > 0 {
                    out.push('\n');
                }
                out.push_str(INDENT);
                out.push_str(line);
            }
            return Ok(out);
        }
        Ok(rendered)
    }
}

impl Exporter for JsonExporter {
    /// No-op: the opening bracket is written with the first row so that an
    /// empty result set can still come out as `[]` rather than `[\n]`.
    fn write_header(&mut self, _columns: &[ColumnInfo], _w: &mut dyn Write) -> io::Result<()> {
        Ok(())
    }

    fn write_row(
        &mut self,
        values: &[Value],
        columns: &[ColumnInfo],
        w: &mut dyn Write,
    ) -> io::Result<()> {
        self.scratch.clear();
        for (i, col) in columns.iter().enumerate() {
            let value = values.get(i).unwrap_or(&Value::Null);
            if value.is_null() && !self.opts.include_nulls {
                continue;
            }
            self.scratch.insert(col.name.clone(), value.clone());
        }

        match self.opts.layout {
            JsonLayout::Ndjson => {
                let rendered = self.serialize_scratch()?;
                w.write_all(rendered.as_bytes())?;
                w.write_all(b"\n")?;
            }
            JsonLayout::Array => {
                if self.wrote_any {
                    w.write_all(if self.opts.pretty { b",\n" } else { b"," })?;
                } else {
                    w.write_all(if self.opts.pretty { b"[\n" } else { b"[" })?;
                }
                let rendered = self.serialize_scratch()?;
                w.write_all(rendered.as_bytes())?;
            }
        }
        self.wrote_any = true;
        Ok(())
    }

    fn finalize(&mut self, w: &mut dyn Write) -> io::Result<()> {
        // ndjson has no wrapper to close.
        if self.opts.layout == JsonLayout::Ndjson {
            return Ok(());
        }
        if !self.wrote_any {
            return w.write_all(b"[]\n");
        }
        if self.opts.pretty {
            w.write_all(b"\n]\n")
        } else {
            w.write_all(b"]\n")
        }
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

    fn export(opts: JsonOptions, columns: &[ColumnInfo], rows: &[Vec<Value>]) -> String {
        let mut exp = JsonExporter::new(opts);
        let mut buf: Vec<u8> = Vec::new();
        exp.write_header(columns, &mut buf).unwrap();
        for row in rows {
            exp.write_row(row, columns, &mut buf).unwrap();
        }
        exp.finalize(&mut buf).unwrap();
        String::from_utf8(buf).unwrap()
    }

    #[test]
    fn array_layout_is_a_single_document() {
        let out = export(
            JsonOptions::default(),
            &[col("a"), col("b")],
            &[vec![json!(1), json!("x")], vec![json!(2), json!("y")]],
        );
        assert_eq!(out, "[{\"a\":1,\"b\":\"x\"},{\"a\":2,\"b\":\"y\"}]\n");
    }

    #[test]
    fn empty_result_is_an_empty_array() {
        let out = export(JsonOptions::default(), &[col("a")], &[]);
        assert_eq!(out, "[]\n");
    }

    #[test]
    fn ndjson_layout_has_no_wrapper() {
        let opts = JsonOptions {
            layout: JsonLayout::Ndjson,
            ..Default::default()
        };
        let out = export(
            opts,
            &[col("a")],
            &[vec![json!(1)], vec![json!(2)], vec![json!(3)]],
        );
        assert_eq!(out, "{\"a\":1}\n{\"a\":2}\n{\"a\":3}\n");
    }

    #[test]
    fn ndjson_empty_result_is_empty_output() {
        let opts = JsonOptions {
            layout: JsonLayout::Ndjson,
            ..Default::default()
        };
        let out = export(opts, &[col("a")], &[]);
        assert_eq!(out, "");
    }

    #[test]
    fn nulls_are_included_by_default() {
        let out = export(
            JsonOptions::default(),
            &[col("a"), col("b")],
            &[vec![Value::Null, json!(1)]],
        );
        assert_eq!(out, "[{\"a\":null,\"b\":1}]\n");
    }

    #[test]
    fn nulls_can_be_omitted() {
        let opts = JsonOptions {
            include_nulls: false,
            ..Default::default()
        };
        let out = export(opts, &[col("a"), col("b")], &[vec![Value::Null, json!(1)]]);
        assert_eq!(out, "[{\"b\":1}]\n");
    }

    #[test]
    fn pretty_array_indents_each_object() {
        let opts = JsonOptions {
            pretty: true,
            ..Default::default()
        };
        let out = export(
            opts,
            &[col("a"), col("b")],
            &[vec![json!(1), json!("x")], vec![json!(2), json!("y")]],
        );
        assert_eq!(
            out,
            "[\n  {\n    \"a\": 1,\n    \"b\": \"x\"\n  },\n  {\n    \"a\": 2,\n    \"b\": \"y\"\n  }\n]\n"
        );
    }

    #[test]
    fn nested_values_pass_through_unchanged() {
        let out = export(
            JsonOptions::default(),
            &[col("a")],
            &[vec![json!({"k": [1, 2]})]],
        );
        assert_eq!(out, "[{\"a\":{\"k\":[1,2]}}]\n");
    }

    #[test]
    fn missing_trailing_value_becomes_null() {
        // Shorter `values` than `columns` shouldn't panic or shift keys.
        let out = export(
            JsonOptions::default(),
            &[col("a"), col("b")],
            &[vec![json!(1)]],
        );
        assert_eq!(out, "[{\"a\":1,\"b\":null}]\n");
    }
}
