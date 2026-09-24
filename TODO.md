~~Cell selection & copy — Click a cell to select, Ctrl+C to copy value~~
Row selection — bulk export
~~Context menu — Right-click for Copy, Copy Row, Copy as INSERT, etc.~~
~~Column resizing — Drag column borders to resize~~
~~Cell expansion — Click/hover to see full content for truncated text/JSON~~
~~Keyboard navigation — Arrow keys to move between cells~~
Medium Priority:
~~Filtering — Per-column filters (especially useful for VARCHAR/text)~~
Global search — Ctrl+F style find within results
~~Column visibility toggle — Hide columns you don't need~~
~~Inline editing — Double-click to edit cell values~~
~~Export options — CSV, JSON, SQL INSERT statements~~
Server-side pagination — For queries returning 100k+ rows
Nice to Have:
Column pinning — Freeze ID/key columns on the left
Column reordering — Drag columns to rearrange
Foreign key navigation — Click FK values to jump to related table
Aggregations in footer — SUM/AVG/COUNT for numeric columns
Date formatting options — Locale-aware display
NULL vs empty string — Visual distinction (currently both show as empty or NULL)

Apply migration through rust

---

## Testing

Vitest is set up (`pnpm test`, `pnpm test:watch`). Coverage so far is one file:
`src/utils/sqlStatements.test.ts`, 21 cases over statement splitting and
cursor-to-statement resolution.

**A dedicated session should build this out.** What's missing, roughly in the
order it has already cost us:

- **Component tests — nothing exists, and no runner for them.** Needs `jsdom` +
  `@testing-library/react` on top of vitest. The bug that motivated this note:
  `DataTable` renders 10k `<tr>` when its parent is a block instead of a flex
  column, because the virtualizer measures a viewport as tall as the whole
  result set. A test asserting the rendered row count stays bounded for a large
  `data` prop would have caught it, and would catch the next parent that gets
  the layout wrong. Every `DataTable` mount point deserves one.
- **SQL editor behaviour.** Cursor movement drives the active-statement
  highlight, selection overrides it, Execute and Ctrl+Enter resolve to the same
  statement. These are the parts a user notices immediately when wrong.
- **Session lifecycle.** Reattaching on remount (switching tabs must not drop a
  transaction), closing on tab close, closing when the connection closes.
- **Script runs.** Stop at the first error; stop when a statement resets the
  session; the log's per-statement outcomes.
- **Rust side is barely covered.** The exporters have unit tests, and
  `drivers/postgres/decode.rs` and `exporters/mod.rs` have tests that run
  against the seeded dev database (`dev/compose.yaml`) and skip themselves
  when it isn't up — the pattern to copy for the rest. Most remaining driver
  code is I/O against a live server. Worth covering: `rows_affected` from the
  command tag for writes without `RETURNING`, the row cap and its `truncated`
  flag, and that a truncated query doesn't stall the next one.
- `cargo clippy --all-targets` is clean of errors. Three warnings remain, all
  pre-existing: two `too_many_arguments` in the driver and one
  `manual implementation of .is_multiple_of()`.
- Pure logic that is testable today with no infrastructure: `formatAsSqlLiteral`
  and `inferType` in `src/utils/sql.ts`, and the export CSV writer.

---

### 1. 🚨 Critical Performance Issues

- **Index Bypass via Text Casting (CRITICAL):** In `drivers/postgres/mod.rs` (`get_filtered_table_data`), when translating frontend filters, the code does:
  `where_clauses.push(format!("{}::text = ${}", col_quoted, param_index));`
  By explicitly casting a Postgres column to text before the comparison, **you disable all B-tree indexes** on that column (like INT, UUID, Dates). Filtering an ID or date will force a slow full sequential scan of the entire table. _Fix: Instead of casting the column (`col::text = '1'`), you should cast the parameter to the column's type or let Postgres infer it._
- **Slow `COUNT(*)` Pagination:** In `get_table_data` and `get_filtered_table_data`, you use `SELECT COUNT(*) FROM "schema"."table"` to get pagination totals. Because of PostgreSQL's MVCC, `COUNT(*)` requires a complete table scan and is notoriously sluggish on multi-million-row tables. _Fix: You should use `pg_class.reltuples` for estimating the count limits (which the AI brilliantly already did in `get_schema_objects`!), and only run `COUNT(_)` when specific filters are applied.\*

### 2. 🛡️ Security & Robustness Issues

- ~~**Binary values leaking into text as control characters.**~~ Fixed:
  `decode_pg_raw_text` accepted any binary payload that happened to be valid
  UTF-8 as text, so `bit`, `varbit` and `tsvector` decoded to their packed
  wire format — a 100-row export of `type_showcase` carried 3039 control
  characters, and the NULs among them made PostgreSQL reject the SQL export
  outright (`08P01 invalid message format`). Binary payloads containing C0
  control characters now render as hex like any other undecodable value.
- ~~**Crashing on Decoding Panics:** In `decode.rs`, the code uses `row.get(ordinal)` for extracting primitive arrays and number types (e.g., `let arr: Vec<uuid::Uuid> = row.get(ordinal);`). If there is a schema mismatch or malformed database data, `row.get()` will literally **panic and crash** the Tauri rust process.~~ Fixed: every arm goes through a `try_decode` helper that falls back to `decode_pg_raw_text`, and `decode_rows` no longer unwraps its raw read. Covered by `type_mismatch_degrades_instead_of_panicking`.
- ~~**Incorrect `rows_affected` Metric:** In `execute_query`: `let rows_affected = rows.len() as u64;`. If the user runs `UPDATE`, `DELETE`, or `INSERT` without a `RETURNING` clause, `fetch_all` simply returns an empty array. This means `rows_affected` will report `0` back to the frontend even if thousands of rows were changed.~~ Fixed: `execute_query` reads the command tag via `fetch_many`.
- **Overly Restrictive Sanitization:** In `get_table_data`, you validate identifiers via `!table.chars().all(|c| c.is_alphanumeric() || c == '_')`. This completely breaks functionality if a developer tries to inspect a perfectly valid Postgres table that has spaces or dashes in its name. Since the code already safely wraps SQL identifiers in double quotes (`format!("\"{}\".\"{}\"")`), this check is unnecessarily strict.
- ~~**OOM Risk on Arbitrary Queries:** `execute_query` fetches absolutely everything from the database into RAM (`fetch_all`). If the user types `SELECT * FROM massive_log_table`, the Rust backend will buffer millions of rows, likely resulting in an Out of Memory application crash. _Fix: Clamp this with a hard-coded maximum limit when inspecting, or handle it with an async stream._~~ Fixed: rows stream through a `MAX_QUERY_ROWS` cap and the result carries a `truncated` flag.

- **13 types render as junk instead of their value.** Found by
  `decodes_every_showcase_type`, which pins the current list. The geometric
  (`line`, `lseg`, `path`, `polygon`, `circle`), bit-string (`bit`, `varbit`)
  and text-search (`tsvector`, `tsquery`) types have no sqlx decoder in
  `decode.rs` and fall through to `decode_pg_raw_text`, which can only emit a
  hex dump for a binary-format value — a user sees `[CIRCLE: \x40575ccc...]`
  in the cell. `macaddr8` is 8 bytes and the `MacAddress` decoder wants 6.
  `numrange`, `tsrange` and `tstzrange` fail `PgRange` decoding even though
  `int4range`, `int8range` and `daterange` succeed. Each needs a real decoder;
  the pinned list in the test shrinks as they land, and
  `streamed_sql_replays_into_postgres` can move to a richer table once it's
  empty.
- ~~**Large `bytea` values are truncated by the decoder, and exports inherit
  it.**~~ Fixed: `decode_pg_value` takes a `DecodeMode`. The grid still
  abbreviates anything over 100 bytes to `\x<first 50>... (N bytes)`, but the
  streaming export path decodes in `Export` mode and writes every byte.
  Covered by `large_bytea_is_abbreviated_only_for_display` and
  `streamed_export_carries_full_bytea`.

### 3. 🧹 "Vibe Coded" Junk & Code Smells (Duplicate Logic)

- **Useless Fallback Match:** In `types.rs`, `ConnectionConfig::to_connection_url()` checks for `"postgres"` and returns a formatted URL, and then the default catch-all `_` arm falls back and literally returns the identical `"postgres"` formatted string anyway. This is definitively "AI filler space."
- **Redundant Table Querying:** `get_table_data` and `get_filtered_table_data` are ~95% identical block-for-block (around 100 lines duplicated). `get_table_data` shouldn't even exist as a separate implementation; it should either just call `get_filtered_table_data` passing an empty `[]` filter array, or both should share a common helper.
- **Duplicate Column Extraction SQL:** The exact same large 15-line SQL query asking `information_schema.columns` for `udt_name` and `ordinal_position` is copied verbatim three times across `get_table_data`, `get_filtered_table_data`, and `get_view_data`. This should absolutely be abstracted into a private `get_column_metadata` method.
- **Repeated Default Unwraps:** In `commands/queries.rs`, the line `let schema_name = schema.unwrap_or_else(|| "public".to_string());` is copy-pasted identically 10 times across 10 commands.
- **Leaky Trait Implementations:** In `drivers/mod.rs`, `DriverConnection` implements `DatabaseDriver`. However, for `test_connection()`, it explicitly defines an `Err` implementation telling the developer: _"Use DriverConnection::test() instead"_. If a trait configuration doesn't logically apply to the wrapper enum, the abstraction footprint should be updated rather than purposefully building dead ends.
