import type { ExportColumn, ExportFormat } from "./types";

/** CSV-specific options. Mirrors `CsvOptions` in `src-tauri/src/exporters/csv.rs`. */
export interface CsvOptions {
  /** Field separator. Only the first character is used. */
  delimiter: string;
  /** Whether to emit a header row of column names. */
  include_header: boolean;
  /**
   * String emitted for null/undefined values. Empty by default — matches
   * `psql \copy` but loses the NULL-vs-empty-string distinction.
   */
  null_string: string;
}

export const DEFAULT_CSV_OPTIONS: CsvOptions = {
  delimiter: ",",
  include_header: true,
  null_string: "",
};

const CRLF = "\r\n";

/**
 * Format a single JS value as the body of a CSV cell. Does NOT add quoting —
 * the caller decides whether quoting is needed. Returns `null` for nulls so
 * the caller can substitute the configured null_string.
 */
function formatCell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  // Arrays, objects, bigints, etc. — JSON-serialize so they round-trip.
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

/** Does `s` need to be wrapped in quotes per RFC 4180? */
function needsQuoting(s: string, delim: string): boolean {
  // Hot path — single pass, no regex (regex compilation per cell would be wasteful).
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (
      c === delim.charCodeAt(0) ||
      c === 34 /* " */ ||
      c === 10 /* \n */ ||
      c === 13 /* \r */
    ) {
      return true;
    }
  }
  return false;
}

/** Wrap `s` in quotes, doubling any embedded quote. */
function quoteField(s: string): string {
  // Cheap fast-path: no embedded quote means no escaping needed.
  if (s.indexOf('"') === -1) return `"${s}"`;
  return `"${s.replace(/"/g, '""')}"`;
}

function writeField(s: string, delim: string, parts: string[]): void {
  parts.push(needsQuoting(s, delim) ? quoteField(s) : s);
}

/**
 * Render rows to a CSV Blob.
 *
 * Build strategy: push field strings into an array and join at the end. This
 * avoids the quadratic cost of repeated string concatenation and lets V8
 * keep individual cell strings in their original allocation.
 *
 * For very large in-memory exports (hundreds of MB) the array itself can be
 * a memory issue — but those exports should use the Rust streaming path, not
 * this function. Current-page scope is capped at one page (≤ a few hundred
 * KB typical) so the simple approach is fine.
 */
export function exportCsvBlob(
  rows: Record<string, unknown>[],
  columns: ExportColumn[],
  opts: CsvOptions,
): Blob {
  const delim = opts.delimiter.length > 0 ? opts.delimiter[0] : ",";
  const parts: string[] = [];

  if (opts.include_header) {
    for (let i = 0; i < columns.length; i++) {
      if (i > 0) parts.push(delim);
      writeField(columns[i].name, delim, parts);
    }
    parts.push(CRLF);
  }

  for (const row of rows) {
    for (let i = 0; i < columns.length; i++) {
      if (i > 0) parts.push(delim);
      const value = row[columns[i].name];
      const formatted = formatCell(value);
      if (formatted === null) {
        parts.push(opts.null_string);
      } else {
        writeField(formatted, delim, parts);
      }
    }
    parts.push(CRLF);
  }

  return new Blob(parts, { type: "text/csv;charset=utf-8" });
}

export const csvFormat: ExportFormat<CsvOptions> = {
  id: "csv",
  label: "CSV",
  extension: ".csv",
  mime: "text/csv",
  defaultOptions: DEFAULT_CSV_OPTIONS,
  exportInMemory: (rows, columns, opts) => exportCsvBlob(rows, columns, opts),
};
