//! SQL `INSERT` exporter.
//!
//! Emits a replayable script for the exported table:
//!
//! ```sql
//! INSERT INTO "public"."users" ("id", "name") VALUES (1, 'Ada');
//! ```
//!
//! Literals are chosen from the JSON value, not the declared column type.
//! That works because PostgreSQL casts a quoted literal to the target
//! column's type on insert, so a `numeric` arriving as the string `"1.5"`
//! (our decoder renders `BigDecimal` as text) still lands correctly as
//! `'1.5'`. It also means the exporter doesn't need a second, parallel
//! notion of the type system.
//!
//! String escaping assumes `standard_conforming_strings` is on, which has
//! been the PostgreSQL default since 9.1: backslashes are literal, and only
//! the single quote needs doubling.

use crate::exporters::Exporter;
use crate::types::ColumnInfo;
use serde::Deserialize;
use serde_json::Value;
use std::io::{self, Write};

/// SQL format options. Deserialized from the frontend's per-format options
/// blob.
#[derive(Deserialize, Debug, Clone)]
pub struct SqlOptions {
    /// Table the generated statements insert into. The streaming command
    /// overwrites this from the object actually being exported, so a client
    /// can't make the script target the wrong table.
    #[serde(default)]
    pub table: String,
    #[serde(default = "default_schema")]
    pub schema: String,
    /// Qualify the table with its schema. Off produces a script that can be
    /// replayed into whatever schema is first on the target's search_path.
    #[serde(default = "default_true")]
    pub include_schema: bool,
    /// Rows per `INSERT`. 1 gives one statement per row, which is easiest to
    /// diff and to recover from a partial failure; larger batches replay far
    /// faster. Clamped to at least 1.
    #[serde(default = "default_rows_per_statement")]
    pub rows_per_statement: usize,
    /// Wrap the script in `BEGIN;` / `COMMIT;` so a failure rolls the whole
    /// load back.
    #[serde(default)]
    pub transaction: bool,
    /// Append `ON CONFLICT DO NOTHING`, making the script re-runnable against
    /// a table that already holds some of the rows.
    #[serde(default)]
    pub on_conflict_do_nothing: bool,
}

impl Default for SqlOptions {
    fn default() -> Self {
        Self {
            table: String::new(),
            schema: default_schema(),
            include_schema: true,
            rows_per_statement: default_rows_per_statement(),
            transaction: false,
            on_conflict_do_nothing: false,
        }
    }
}

fn default_schema() -> String {
    "public".to_string()
}

fn default_true() -> bool {
    true
}

fn default_rows_per_statement() -> usize {
    1
}

/// Quote a SQL identifier, doubling any embedded quote. Always quoting keeps
/// mixed-case and reserved-word identifiers working without a keyword list.
fn quote_ident(name: &str, out: &mut String) {
    out.push('"');
    for ch in name.chars() {
        if ch == '"' {
            out.push('"');
        }
        out.push(ch);
    }
    out.push('"');
}

/// Is `pg_type` a PostgreSQL array? `information_schema.udt_name` spells these
/// `_text`; the live row metadata spells them `TEXT[]`.
fn is_array_type(pg_type: &str) -> bool {
    pg_type.starts_with('_') || pg_type.ends_with("[]")
}

/// Append `v` as a SQL literal. `pg_type` disambiguates the one case the JSON
/// value can't: our decoder renders both `text[]` and `jsonb` as a JSON array,
/// but PostgreSQL wants `'{a,b}'` for the first and `'["a","b"]'` for the
/// second.
pub(crate) fn write_literal(v: &Value, pg_type: &str, out: &mut String) {
    match v {
        Value::Null => out.push_str("NULL"),
        Value::Bool(b) => out.push_str(if *b { "TRUE" } else { "FALSE" }),
        Value::Number(n) => out.push_str(&n.to_string()),
        Value::String(s) => quote_literal(s, out),
        Value::Array(items) if is_array_type(pg_type) => {
            let mut literal = String::new();
            write_array_literal(items, &mut literal);
            quote_literal(&literal, out);
        }
        // Anything else nested came from a json/jsonb column. Rendering it as
        // a quoted JSON string lets PostgreSQL cast it back on insert.
        other => {
            let rendered = serde_json::to_string(other).unwrap_or_else(|_| "null".to_string());
            quote_literal(&rendered, out);
        }
    }
}

/// Render `items` in PostgreSQL's array-literal syntax, `{a,b,c}`. The result
/// still has to go through `quote_literal` to become a SQL literal.
fn write_array_literal(items: &[Value], out: &mut String) {
    out.push('{');
    for (i, item) in items.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        match item {
            // Bare NULL is the null element; the quoted form is the four-
            // character string "NULL", which is why the element quoting rules
            // below have to treat that spelling as special.
            Value::Null => out.push_str("NULL"),
            Value::Array(nested) => write_array_literal(nested, out),
            Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            Value::Number(n) => out.push_str(&n.to_string()),
            Value::String(s) => write_array_element(s, out),
            other => {
                let rendered = serde_json::to_string(other).unwrap_or_else(|_| "null".to_string());
                write_array_element(&rendered, out);
            }
        }
    }
    out.push('}');
}

/// Append one array element, quoting it when the bare form would be
/// misparsed. Inside quotes, `"` and `\` are backslash-escaped — that's the
/// array-literal grammar, and is separate from the single-quote doubling that
/// `quote_literal` applies to the whole thing afterwards.
fn write_array_element(s: &str, out: &mut String) {
    let needs_quotes = s.is_empty()
        || s.eq_ignore_ascii_case("null")
        || s.chars()
            .any(|c| matches!(c, '{' | '}' | ',' | '"' | '\\') || c.is_whitespace());

    if !needs_quotes {
        out.push_str(s);
        return;
    }
    out.push('"');
    for ch in s.chars() {
        if ch == '"' || ch == '\\' {
            out.push('\\');
        }
        out.push(ch);
    }
    out.push('"');
}

/// Append `s` as a single-quoted SQL string literal.
fn quote_literal(s: &str, out: &mut String) {
    out.push('\'');
    for ch in s.chars() {
        if ch == '\'' {
            out.push('\'');
        }
        out.push(ch);
    }
    out.push('\'');
}

pub struct SqlExporter {
    opts: SqlOptions,
    /// `INSERT INTO "schema"."table" ("a", "b") VALUES`, built once from the
    /// first row's columns and reused for every statement.
    insert_prefix: Option<String>,
    /// Rows written into the statement currently open. 0 means no open
    /// statement, so the next row starts a fresh one.
    rows_in_batch: usize,
    /// Reusable line buffer so a row costs one allocation's worth of growth,
    /// not one per cell.
    scratch: String,
}

impl SqlExporter {
    pub fn new(opts: SqlOptions) -> Self {
        Self {
            opts,
            insert_prefix: None,
            rows_in_batch: 0,
            scratch: String::new(),
        }
    }

    /// Rows per statement, floored at 1 — a zero from the client would
    /// otherwise mean "never close the statement".
    fn batch_size(&self) -> usize {
        self.opts.rows_per_statement.max(1)
    }

    fn build_insert_prefix(&self, columns: &[ColumnInfo]) -> String {
        let mut s = String::from("INSERT INTO ");
        if self.opts.include_schema {
            quote_ident(&self.opts.schema, &mut s);
            s.push('.');
        }
        quote_ident(&self.opts.table, &mut s);
        s.push_str(" (");
        for (i, col) in columns.iter().enumerate() {
            if i > 0 {
                s.push_str(", ");
            }
            quote_ident(&col.name, &mut s);
        }
        s.push_str(") VALUES");
        s
    }

    /// Close the statement currently open, if any.
    fn close_statement(&mut self, w: &mut dyn Write) -> io::Result<()> {
        if self.rows_in_batch == 0 {
            return Ok(());
        }
        if self.opts.on_conflict_do_nothing {
            w.write_all(b" ON CONFLICT DO NOTHING")?;
        }
        w.write_all(b";\n")?;
        self.rows_in_batch = 0;
        Ok(())
    }
}

impl Exporter for SqlExporter {
    fn write_header(&mut self, _columns: &[ColumnInfo], w: &mut dyn Write) -> io::Result<()> {
        // The column list belongs to the INSERT prefix, which is built on the
        // first row. Only the transaction wrapper is header-level.
        if self.opts.transaction {
            w.write_all(b"BEGIN;\n")?;
        }
        Ok(())
    }

    fn write_row(
        &mut self,
        values: &[Value],
        columns: &[ColumnInfo],
        w: &mut dyn Write,
    ) -> io::Result<()> {
        if self.insert_prefix.is_none() {
            self.insert_prefix = Some(self.build_insert_prefix(columns));
        }
        let batch_size = self.batch_size();

        // Start a new statement when nothing is open, otherwise continue the
        // current one with a comma.
        if self.rows_in_batch == 0 {
            let prefix = self.insert_prefix.as_deref().unwrap_or_default();
            w.write_all(prefix.as_bytes())?;
            // A one-row statement reads better on a single line; batches get
            // one row per line so the output stays diffable.
            w.write_all(if batch_size == 1 { b" " } else { b"\n  " })?;
        } else {
            w.write_all(b",\n  ")?;
        }

        // Iterate columns, not values: the column list in the INSERT prefix
        // fixes the arity, so a short row has to pad with NULL rather than
        // emit a tuple the statement won't accept.
        self.scratch.clear();
        self.scratch.push('(');
        for (i, col) in columns.iter().enumerate() {
            if i > 0 {
                self.scratch.push_str(", ");
            }
            write_literal(
                values.get(i).unwrap_or(&Value::Null),
                &col.data_type,
                &mut self.scratch,
            );
        }
        self.scratch.push(')');
        w.write_all(self.scratch.as_bytes())?;

        self.rows_in_batch += 1;
        if self.rows_in_batch >= batch_size {
            self.close_statement(w)?;
        }
        Ok(())
    }

    fn finalize(&mut self, w: &mut dyn Write) -> io::Result<()> {
        // A partially filled batch is still owed its terminator.
        self.close_statement(w)?;
        if self.opts.transaction {
            w.write_all(b"COMMIT;\n")?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn col(name: &str) -> ColumnInfo {
        typed_col(name, "TEXT")
    }

    fn typed_col(name: &str, data_type: &str) -> ColumnInfo {
        ColumnInfo {
            name: name.to_string(),
            data_type: data_type.to_string(),
            ordinal_position: None,
        }
    }

    fn opts() -> SqlOptions {
        SqlOptions {
            table: "users".to_string(),
            ..Default::default()
        }
    }

    fn export(opts: SqlOptions, columns: &[ColumnInfo], rows: &[Vec<Value>]) -> String {
        let mut exp = SqlExporter::new(opts);
        let mut buf: Vec<u8> = Vec::new();
        exp.write_header(columns, &mut buf).unwrap();
        for row in rows {
            exp.write_row(row, columns, &mut buf).unwrap();
        }
        exp.finalize(&mut buf).unwrap();
        String::from_utf8(buf).unwrap()
    }

    #[test]
    fn one_statement_per_row_by_default() {
        let out = export(
            opts(),
            &[col("id"), col("name")],
            &[vec![json!(1), json!("Ada")], vec![json!(2), json!("Bob")]],
        );
        assert_eq!(
            out,
            "INSERT INTO \"public\".\"users\" (\"id\", \"name\") VALUES (1, 'Ada');\n\
             INSERT INTO \"public\".\"users\" (\"id\", \"name\") VALUES (2, 'Bob');\n"
        );
    }

    #[test]
    fn embedded_quote_is_doubled() {
        let out = export(opts(), &[col("name")], &[vec![json!("O'Brien")]]);
        assert!(out.contains("('O''Brien')"), "{out}");
    }

    #[test]
    fn backslash_is_left_alone() {
        // standard_conforming_strings is on: a backslash is just a backslash.
        let out = export(opts(), &[col("p")], &[vec![json!("C:\\tmp")]]);
        assert!(out.contains("('C:\\tmp')"), "{out}");
    }

    #[test]
    fn nulls_and_booleans_are_unquoted_keywords() {
        let out = export(
            opts(),
            &[col("a"), col("b"), col("c")],
            &[vec![Value::Null, json!(true), json!(false)]],
        );
        assert!(out.contains("(NULL, TRUE, FALSE)"), "{out}");
    }

    #[test]
    fn nested_values_become_quoted_json() {
        let out = export(opts(), &[col("meta")], &[vec![json!({"k": 1})]]);
        assert!(out.contains("('{\"k\":1}')"), "{out}");
    }

    #[test]
    fn quote_in_json_is_escaped_for_sql() {
        let out = export(opts(), &[col("meta")], &[vec![json!({"k": "it's"})]]);
        assert!(out.contains("('{\"k\":\"it''s\"}')"), "{out}");
    }

    #[test]
    fn array_columns_use_array_literal_syntax() {
        // The decoder hands us a JSON array for both `text[]` and `jsonb`;
        // only the column type says which literal PostgreSQL will accept.
        let out = export(
            opts(),
            &[typed_col("tags", "_text")],
            &[vec![json!(["vip", "premium"])]],
        );
        assert!(out.contains("('{vip,premium}')"), "{out}");
    }

    #[test]
    fn json_columns_keep_json_syntax() {
        let out = export(
            opts(),
            &[typed_col("meta", "jsonb")],
            &[vec![json!(["vip", "premium"])]],
        );
        assert!(out.contains("('[\"vip\",\"premium\"]')"), "{out}");
    }

    #[test]
    fn array_elements_are_quoted_when_ambiguous() {
        let out = export(
            opts(),
            &[typed_col("tags", "TEXT[]")],
            &[vec![json!(["a b", "c,d", "", "NULL", "plain"])]],
        );
        assert!(
            out.contains(r#"('{"a b","c,d","","NULL",plain}')"#),
            "{out}"
        );
    }

    #[test]
    fn array_elements_escape_quotes_and_backslashes() {
        let out = export(
            opts(),
            &[typed_col("tags", "_text")],
            &[vec![json!(["say \"hi\"", "back\\slash"])]],
        );
        // Backslash-escaped for the array grammar; the surrounding SQL literal
        // needs no further escaping since there's no single quote.
        assert!(out.contains(r#"('{"say \"hi\"","back\\slash"}')"#), "{out}");
    }

    #[test]
    fn null_array_element_stays_unquoted() {
        let out = export(
            opts(),
            &[typed_col("tags", "_text")],
            &[vec![json!(["a", null])]],
        );
        assert!(out.contains("('{a,NULL}')"), "{out}");
    }

    #[test]
    fn quote_inside_array_element_is_doubled_for_sql() {
        let out = export(
            opts(),
            &[typed_col("tags", "_text")],
            &[vec![json!(["it's"])]],
        );
        assert!(out.contains("('{it''s}')"), "{out}");
    }

    #[test]
    fn empty_array_is_empty_braces() {
        let out = export(opts(), &[typed_col("tags", "_text")], &[vec![json!([])]]);
        assert!(out.contains("('{}')"), "{out}");
    }

    #[test]
    fn identifiers_with_quotes_are_escaped() {
        let o = SqlOptions {
            table: "we\"ird".to_string(),
            ..opts()
        };
        let out = export(o, &[col("c\"ol")], &[vec![json!(1)]]);
        assert!(out.contains("\"we\"\"ird\" (\"c\"\"ol\")"), "{out}");
    }

    #[test]
    fn schema_can_be_omitted() {
        let o = SqlOptions {
            include_schema: false,
            ..opts()
        };
        let out = export(o, &[col("id")], &[vec![json!(1)]]);
        assert_eq!(out, "INSERT INTO \"users\" (\"id\") VALUES (1);\n");
    }

    #[test]
    fn batches_rows_into_one_statement() {
        let o = SqlOptions {
            rows_per_statement: 2,
            ..opts()
        };
        let out = export(
            o,
            &[col("id")],
            &[vec![json!(1)], vec![json!(2)], vec![json!(3)]],
        );
        // Three rows at two per statement: one full batch, one partial that
        // finalize has to close.
        assert_eq!(
            out,
            "INSERT INTO \"public\".\"users\" (\"id\") VALUES\n  (1),\n  (2);\n\
             INSERT INTO \"public\".\"users\" (\"id\") VALUES\n  (3);\n"
        );
    }

    #[test]
    fn zero_batch_size_is_treated_as_one() {
        let o = SqlOptions {
            rows_per_statement: 0,
            ..opts()
        };
        let out = export(o, &[col("id")], &[vec![json!(1)], vec![json!(2)]]);
        assert_eq!(out.matches("INSERT INTO").count(), 2, "{out}");
    }

    #[test]
    fn transaction_wraps_the_script() {
        let o = SqlOptions {
            transaction: true,
            ..opts()
        };
        let out = export(o, &[col("id")], &[vec![json!(1)]]);
        assert_eq!(
            out,
            "BEGIN;\nINSERT INTO \"public\".\"users\" (\"id\") VALUES (1);\nCOMMIT;\n"
        );
    }

    #[test]
    fn empty_result_still_produces_a_valid_script() {
        let o = SqlOptions {
            transaction: true,
            ..opts()
        };
        let out = export(o, &[col("id")], &[]);
        assert_eq!(out, "BEGIN;\nCOMMIT;\n");
    }

    #[test]
    fn on_conflict_applies_to_every_statement() {
        let o = SqlOptions {
            on_conflict_do_nothing: true,
            ..opts()
        };
        let out = export(o, &[col("id")], &[vec![json!(1)], vec![json!(2)]]);
        assert_eq!(out.matches("ON CONFLICT DO NOTHING;").count(), 2, "{out}");
    }
}
