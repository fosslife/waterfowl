/**
 * Pluggable export format definitions. The registry decouples the export
 * dialog from any specific format — adding e.g. JSON in the future is a new
 * file in this folder plus a single entry in the EXPORT_FORMATS array.
 *
 * Two execution paths share these definitions:
 *   - Current-page scope: rows live in JS memory → `exportInMemory` produces
 *     a Blob written via the save dialog.
 *   - Filtered / full-table scope: Rust streams to disk via the
 *     `export_table_streaming` command, keyed by `id`. Frontend just passes
 *     options through; semantics must stay in sync with the Rust impl.
 */

export interface ExportColumn {
  name: string;
  /** PostgreSQL type, mirroring `ColumnInfo.pg_type`. Not used by CSV today. */
  pgType?: string;
}

export interface ExportFormat<TOpts = unknown> {
  /** Must match the Rust `format_id` for streamed exports. */
  id: string;
  /** Shown in the format selector. */
  label: string;
  /** Extension including the dot, used by the save dialog filter. */
  extension: string;
  /** MIME type, used when creating the Blob for in-memory exports. */
  mime: string;
  /** Defaults — also serve as the option type's source of truth. */
  defaultOptions: TOpts;
  /**
   * Render rows already loaded in memory to a Blob. Used for the
   * current-page scope. Implementations must mirror the Rust exporter's
   * output byte-for-byte so users see consistent results across scopes.
   */
  exportInMemory(
    rows: Record<string, unknown>[],
    columns: ExportColumn[],
    opts: TOpts,
  ): Blob;
}
