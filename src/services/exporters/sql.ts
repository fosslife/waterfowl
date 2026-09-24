import type { ExportColumn, ExportFormat } from "./types";

/**
 * SQL-specific options. Mirrors `SqlOptions` in
 * `src-tauri/src/exporters/sql.rs`.
 *
 * `table` / `schema` are filled in by the export dialog from the object
 * being exported. The streamed path overwrites them server-side from the
 * same source, so the two paths can't disagree.
 */
export interface SqlOptions {
  table: string;
  schema: string;
  /** Qualify the table with its schema. */
  include_schema: boolean;
  /** Rows per INSERT statement. 1 is one statement per row. */
  rows_per_statement: number;
  /** Wrap the script in BEGIN; / COMMIT;. */
  transaction: boolean;
  /** Append ON CONFLICT DO NOTHING to each statement. */
  on_conflict_do_nothing: boolean;
}

export const DEFAULT_SQL_OPTIONS: SqlOptions = {
  table: "",
  schema: "public",
  include_schema: true,
  rows_per_statement: 1,
  transaction: false,
  on_conflict_do_nothing: false,
};

/** Quote a SQL identifier, doubling any embedded quote. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Quote a SQL string literal, doubling any embedded single quote. */
function quoteLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Is `pgType` a PostgreSQL array? `udt_name` spells these `_text`; the live
 * row metadata spells them `TEXT[]`.
 */
function isArrayType(pgType: string | undefined): boolean {
  if (!pgType) return false;
  return pgType.startsWith("_") || pgType.endsWith("[]");
}

/**
 * Render `items` in PostgreSQL's array-literal syntax, `{a,b,c}`. The result
 * still has to go through `quoteLiteral` to become a SQL literal.
 */
function arrayLiteral(items: unknown[]): string {
  const parts = items.map((item) => {
    // Bare NULL is the null element; the quoted form is the string "NULL".
    if (item === null || item === undefined) return "NULL";
    if (Array.isArray(item)) return arrayLiteral(item);
    if (typeof item === "boolean") return item ? "true" : "false";
    if (typeof item === "number") return String(item);
    if (typeof item === "string") return arrayElement(item);
    try {
      return arrayElement(JSON.stringify(item));
    } catch {
      return "NULL";
    }
  });
  return `{${parts.join(",")}}`;
}

/**
 * One array element, quoted when the bare form would be misparsed. Inside
 * quotes `"` and `\` are backslash-escaped — the array-literal grammar,
 * separate from the single-quote doubling applied to the whole literal after.
 */
function arrayElement(s: string): string {
  const needsQuotes =
    s === "" || s.toLowerCase() === "null" || /[{},"\\\s]/.test(s);
  if (!needsQuotes) return s;
  return `"${s.replace(/([\\"])/g, "\\$1")}"`;
}

/**
 * Render one value as a SQL literal.
 *
 * Mostly driven by the JS value — PostgreSQL casts a quoted literal to the
 * target column's type on insert, so a numeric that arrived as a string still
 * lands correctly. `pgType` settles the one case the value can't: the decoder
 * renders both `text[]` and `jsonb` as a JS array, but PostgreSQL wants
 * `'{a,b}'` for the first and `'["a","b"]'` for the second.
 *
 * Assumes `standard_conforming_strings` (the default since 9.1), where a
 * backslash is literal and only the single quote needs escaping.
 */
export function formatSqlLiteral(value: unknown, pgType?: string): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return quoteLiteral(value);
  if (Array.isArray(value) && isArrayType(pgType)) {
    return quoteLiteral(arrayLiteral(value));
  }
  // Anything else nested came from a json/jsonb column — hand it back as a
  // quoted JSON string for PostgreSQL to cast.
  try {
    return quoteLiteral(JSON.stringify(value));
  } catch {
    return "NULL";
  }
}

/**
 * Render rows to a SQL Blob of INSERT statements, byte-for-byte matching the
 * Rust exporter.
 */
export function exportSqlBlob(
  rows: Record<string, unknown>[],
  columns: ExportColumn[],
  opts: SqlOptions,
): Blob {
  const parts: string[] = [];
  // A zero from a mis-set option would mean "never close the statement".
  const batchSize = Math.max(1, Math.floor(opts.rows_per_statement) || 1);

  if (opts.transaction) parts.push("BEGIN;\n");

  const target = opts.include_schema
    ? `${quoteIdent(opts.schema)}.${quoteIdent(opts.table)}`
    : quoteIdent(opts.table);
  const columnList = columns.map((c) => quoteIdent(c.name)).join(", ");
  const insertPrefix = `INSERT INTO ${target} (${columnList}) VALUES`;
  const terminator = opts.on_conflict_do_nothing
    ? " ON CONFLICT DO NOTHING;\n"
    : ";\n";

  let rowsInBatch = 0;
  for (const row of rows) {
    if (rowsInBatch === 0) {
      parts.push(insertPrefix);
      // One-row statements read better on a single line; batches get one row
      // per line so the output stays diffable.
      parts.push(batchSize === 1 ? " " : "\n  ");
    } else {
      parts.push(",\n  ");
    }

    // Iterate columns, not row keys: the column list fixes the arity, so a
    // missing key pads with NULL rather than shifting the tuple.
    const values = columns.map((c) => formatSqlLiteral(row[c.name], c.pgType));
    parts.push(`(${values.join(", ")})`);

    rowsInBatch++;
    if (rowsInBatch >= batchSize) {
      parts.push(terminator);
      rowsInBatch = 0;
    }
  }
  // A partially filled batch is still owed its terminator.
  if (rowsInBatch > 0) parts.push(terminator);

  if (opts.transaction) parts.push("COMMIT;\n");

  return new Blob(parts, { type: "application/sql;charset=utf-8" });
}

export const sqlFormat: ExportFormat<SqlOptions> = {
  id: "sql",
  label: "SQL (INSERT)",
  extension: ".sql",
  mime: "application/sql",
  defaultOptions: DEFAULT_SQL_OPTIONS,
  exportInMemory: (rows, columns, opts) => exportSqlBlob(rows, columns, opts),
};
