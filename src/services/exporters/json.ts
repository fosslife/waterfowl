import type { ExportColumn, ExportFormat } from "./types";

/**
 * JSON-specific options. Mirrors `JsonOptions` in
 * `src-tauri/src/exporters/json.rs`.
 */
export interface JsonOptions {
  /**
   * `array` emits one `[...]` document; `ndjson` emits one object per line
   * with no wrapper, for consumers that stream rather than parse in full.
   */
  layout: "array" | "ndjson";
  /** Indent objects across multiple lines. Ignored for ndjson. */
  pretty: boolean;
  /** Emit `"col": null` for nulls, rather than omitting the key. */
  include_nulls: boolean;
}

export const DEFAULT_JSON_OPTIONS: JsonOptions = {
  layout: "array",
  pretty: false,
  include_nulls: true,
};

/** Matches the indent `serde_json`'s pretty printer uses. */
const INDENT = "  ";

/**
 * Build the object for one row, in column order. Keys are inserted in the
 * order the columns are displayed so the output matches the Rust exporter.
 *
 * (A column whose name is an integer-like string — "1", "07" — will be
 * reordered by the JS engine's own key ordering rules. Rare enough in real
 * schemas to leave alone; the Rust streaming path is unaffected.)
 */
function buildRowObject(
  row: Record<string, unknown>,
  columns: ExportColumn[],
  includeNulls: boolean,
): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const col of columns) {
    const value = row[col.name];
    const normalized = value === undefined ? null : value;
    if (normalized === null && !includeNulls) continue;
    obj[col.name] = normalized;
  }
  return obj;
}

/** Prefix every line of `s` with the array's base indent. */
function indentBlock(s: string): string {
  return s
    .split("\n")
    .map((line) => INDENT + line)
    .join("\n");
}

function renderObject(obj: Record<string, unknown>, pretty: boolean): string {
  return pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);
}

/**
 * Render rows to a JSON Blob, byte-for-byte matching the Rust exporter for
 * the values the decoder produces.
 *
 * One known divergence: a float that happens to be integral prints as `1.0`
 * from Rust's streamed path and `1` here, because `JSON.stringify` drops the
 * trailing `.0`. Both are valid JSON for the same number.
 */
export function exportJsonBlob(
  rows: Record<string, unknown>[],
  columns: ExportColumn[],
  opts: JsonOptions,
): Blob {
  const parts: string[] = [];

  if (opts.layout === "ndjson") {
    for (const row of rows) {
      const obj = buildRowObject(row, columns, opts.include_nulls);
      parts.push(renderObject(obj, opts.pretty));
      parts.push("\n");
    }
    return new Blob(parts, { type: "application/x-ndjson;charset=utf-8" });
  }

  // Array layout. An empty result is `[]`, not `[\n]`.
  if (rows.length === 0) {
    return new Blob(["[]\n"], { type: "application/json;charset=utf-8" });
  }

  parts.push(opts.pretty ? "[\n" : "[");
  for (let i = 0; i < rows.length; i++) {
    if (i > 0) parts.push(opts.pretty ? ",\n" : ",");
    const obj = buildRowObject(rows[i], columns, opts.include_nulls);
    const rendered = renderObject(obj, opts.pretty);
    parts.push(opts.pretty ? indentBlock(rendered) : rendered);
  }
  parts.push(opts.pretty ? "\n]\n" : "]\n");

  return new Blob(parts, { type: "application/json;charset=utf-8" });
}

export const jsonFormat: ExportFormat<JsonOptions> = {
  id: "json",
  label: "JSON",
  extension: ".json",
  mime: "application/json",
  defaultOptions: DEFAULT_JSON_OPTIONS,
  exportInMemory: (rows, columns, opts) => exportJsonBlob(rows, columns, opts),
};
