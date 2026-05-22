import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, X } from "lucide-react";
import { Button } from "@components/ui/button/Button";
import { useToast } from "@context/ToastContext";
import {
  EXPORT_FORMATS,
  getExportFormat,
  type ExportColumn,
  type ExportFormat,
} from "@services/exporters";
import { type CsvOptions, DEFAULT_CSV_OPTIONS } from "@services/exporters/csv";
import type { ColumnFilter } from "@components/ui/data-table/ColumnFilter/types";
import styles from "./ExportDialog.module.css";

/**
 * `Page`: only the rows the DataTable currently has in memory.
 * `Filtered`: re-run the active filter and stream every matching row.
 * `All`: stream every row in the table/view.
 * `Selection`: only the user-selected rows (from the row-selection sidebar).
 */
export type ExportScope = "page" | "filtered" | "all" | "selection";

export interface ExportDialogSource {
  connectionId: string;
  objectType: "table" | "view";
  name: string;
  schema: string;
}

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  source: ExportDialogSource;
  /** Columns to export, in display order. */
  columns: ExportColumn[];
  /** Rows currently loaded in the table (used for "page" scope). */
  pageRows: Record<string, unknown>[];
  /** Active column filters (used by "filtered" scope). */
  activeFilters: ColumnFilter[];
  /** Total row count of the table/view (for "all" scope label). */
  totalCount?: number;
  /**
   * Total rows matching active filters. If undefined, the filtered scope
   * option is hidden.
   */
  filteredCount?: number;
  /**
   * Pre-selected rows (used only by "selection" scope). When provided, the
   * dialog locks the scope to "selection" and hides the other options.
   */
  selectedRows?: Record<string, unknown>[];
}

type RunState =
  | { kind: "idle" }
  | { kind: "running"; exportId: string; rowsWritten: number; total: number | null }
  | {
      kind: "done";
      rowsWritten: number;
      bytesWritten: number;
      durationMs: number;
      cancelled: boolean;
      path: string;
    }
  | { kind: "error"; message: string };

interface ProgressEvent {
  export_id: string;
  rows_written: number;
  total_estimate: number | null;
}

interface ExportSummaryRust {
  rows_written: number;
  bytes_written: number;
  duration_ms: number;
  cancelled: boolean;
}

function generateExportId(): string {
  return (
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function defaultFileStem(source: ExportDialogSource, scope: ExportScope): string {
  const base = `${source.schema}.${source.name}`;
  switch (scope) {
    case "page":
      return `${base}-page`;
    case "filtered":
      return `${base}-filtered`;
    case "selection":
      return `${base}-selection`;
    case "all":
      return base;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function ExportDialog({
  isOpen,
  onClose,
  source,
  columns,
  pageRows,
  activeFilters,
  totalCount,
  filteredCount,
  selectedRows,
}: ExportDialogProps) {
  const toast = useToast();
  const isSelectionMode = selectedRows !== undefined;

  // Form state. Resets each time the dialog opens.
  const [scope, setScope] = useState<ExportScope>(
    isSelectionMode ? "selection" : "page",
  );
  const [formatId, setFormatId] = useState<string>(EXPORT_FORMATS[0].id);
  const [csvOpts, setCsvOpts] = useState<CsvOptions>(DEFAULT_CSV_OPTIONS);
  const [run, setRun] = useState<RunState>({ kind: "idle" });

  // Track the latest export id so the cancel button knows what to abort.
  const activeExportIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setScope(isSelectionMode ? "selection" : "page");
    setFormatId(EXPORT_FORMATS[0].id);
    setCsvOpts(DEFAULT_CSV_OPTIONS);
    setRun({ kind: "idle" });
  }, [isOpen, isSelectionMode]);

  const format = useMemo<ExportFormat | undefined>(
    () => getExportFormat(formatId),
    [formatId],
  );

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Don't close mid-export — user needs to cancel explicitly so they
      // don't lose track of a still-running streamed write.
      if (run.kind === "running") return;
      onClose();
    },
    [onClose, run.kind],
  );

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, handleEscape]);

  // In-memory export (page or selection scope): build Blob → ask for path →
  // write via the Rust write_text_file command (a Blob → text round-trip is
  // fine for CSV; for binary formats later this becomes write_bytes).
  const runInMemoryExport = useCallback(
    async (rows: Record<string, unknown>[]) => {
      if (!format) return;
      const blob = format.exportInMemory(rows, columns, getOptionsFor(formatId));
      const stem = defaultFileStem(source, scope);
      const path = await save({
        defaultPath: `${stem}${format.extension}`,
        filters: [
          { name: format.label, extensions: [format.extension.replace(/^\./, "")] },
        ],
      });
      if (!path) return; // user cancelled save dialog
      const text = await blob.text();
      const start = performance.now();
      try {
        await invoke("write_text_file", { path, contents: text });
        const durationMs = Math.round(performance.now() - start);
        setRun({
          kind: "done",
          rowsWritten: rows.length,
          bytesWritten: blob.size,
          durationMs,
          cancelled: false,
          path,
        });
        toast.success(`Exported ${rows.length} rows to ${path}`);
      } catch (e) {
        const msg = String(e);
        setRun({ kind: "error", message: msg });
        toast.error(`Export failed: ${msg}`);
      }
    },
    [format, formatId, columns, source, scope, csvOpts, toast],
  );

  // Read the per-format option blob to pass to the format implementation
  // and to forward to the Rust streamer. Centralised so adding a new
  // format only needs a new branch here.
  function getOptionsFor(id: string): any {
    if (id === "csv") return csvOpts;
    return {};
  }

  // Streamed export (filtered or full-table scope). Subscribes to progress
  // events tagged by exportId before invoking, so the first tick isn't lost.
  const runStreamedExport = useCallback(
    async (useFilters: boolean) => {
      if (!format) return;
      const stem = defaultFileStem(source, scope);
      const destPath = await save({
        defaultPath: `${stem}${format.extension}`,
        filters: [
          { name: format.label, extensions: [format.extension.replace(/^\./, "")] },
        ],
      });
      if (!destPath) return;

      const exportId = generateExportId();
      activeExportIdRef.current = exportId;
      setRun({ kind: "running", exportId, rowsWritten: 0, total: null });

      let unlisten: UnlistenFn | null = null;
      try {
        unlisten = await listen<ProgressEvent>(
          `export-progress:${exportId}`,
          (event) => {
            // Discard events from prior exports (cancel/restart race).
            if (activeExportIdRef.current !== exportId) return;
            const p = event.payload;
            setRun({
              kind: "running",
              exportId,
              rowsWritten: p.rows_written,
              total: p.total_estimate,
            });
          },
        );

        const summary = await invoke<ExportSummaryRust>("export_table_streaming", {
          exportId,
          connectionId: source.connectionId,
          objectType: source.objectType,
          name: source.name,
          schema: source.schema,
          filters: useFilters ? activeFilters : [],
          formatId,
          formatOptions: getOptionsFor(formatId),
          destPath,
        });

        if (activeExportIdRef.current !== exportId) return;
        setRun({
          kind: "done",
          rowsWritten: summary.rows_written,
          bytesWritten: summary.bytes_written,
          durationMs: summary.duration_ms,
          cancelled: summary.cancelled,
          path: destPath,
        });
        if (summary.cancelled) {
          toast.info(`Export cancelled — partial file saved to ${destPath}`);
        } else {
          toast.success(
            `Exported ${formatNumber(summary.rows_written)} rows to ${destPath}`,
          );
        }
      } catch (e) {
        if (activeExportIdRef.current !== exportId) return;
        const msg = String(e);
        setRun({ kind: "error", message: msg });
        toast.error(`Export failed: ${msg}`);
      } finally {
        if (unlisten) unlisten();
      }
    },
    [format, formatId, source, scope, activeFilters, csvOpts, toast],
  );

  const handleExport = useCallback(() => {
    if (!format) return;
    switch (scope) {
      case "page":
        runInMemoryExport(pageRows);
        return;
      case "selection":
        runInMemoryExport(selectedRows ?? []);
        return;
      case "filtered":
        runStreamedExport(true);
        return;
      case "all":
        runStreamedExport(false);
        return;
    }
  }, [
    format,
    scope,
    pageRows,
    selectedRows,
    runInMemoryExport,
    runStreamedExport,
  ]);

  const handleCancel = useCallback(() => {
    if (run.kind !== "running") return;
    invoke("cancel_export", { exportId: run.exportId }).catch(() => {
      // Even if signalling fails, the user intent is recorded — drop ref so
      // any late summary doesn't reset our state.
    });
    activeExportIdRef.current = null;
  }, [run]);

  if (!isOpen) return null;

  const busy = run.kind === "running";

  return createPortal(
    <div
      className={styles.overlay}
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="export-title"
      >
        <div className={styles.header}>
          <div className={styles.headerIcon}>
            <Download size={16} />
          </div>
          <div className={styles.titleGroup}>
            <h2 id="export-title" className={styles.title}>
              Export {source.objectType === "view" ? "View" : "Table"}
            </h2>
            <p className={styles.subtitle}>
              {source.schema}.{source.name}
            </p>
          </div>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            disabled={busy}
            title="Close"
            type="button"
          >
            <X size={16} />
          </button>
        </div>

        <div className={styles.body}>
          {/* Scope */}
          {!isSelectionMode && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>Scope</div>
              <div className={styles.scopeList}>
                <ScopeRadio
                  selected={scope === "page"}
                  disabled={busy}
                  name="Current page"
                  meta={`${pageRows.length} row${pageRows.length === 1 ? "" : "s"} (in memory)`}
                  onSelect={() => setScope("page")}
                />
                {filteredCount !== undefined && activeFilters.length > 0 && (
                  <ScopeRadio
                    selected={scope === "filtered"}
                    disabled={busy}
                    name="Filtered rows"
                    meta={`${formatNumber(filteredCount)} matching row${filteredCount === 1 ? "" : "s"} (streamed)`}
                    onSelect={() => setScope("filtered")}
                  />
                )}
                <ScopeRadio
                  selected={scope === "all"}
                  disabled={busy}
                  name={
                    source.objectType === "view"
                      ? "Entire view"
                      : "Entire table"
                  }
                  meta={
                    totalCount !== undefined
                      ? `~${formatNumber(totalCount)} row${totalCount === 1 ? "" : "s"} (streamed)`
                      : "streamed"
                  }
                  onSelect={() => setScope("all")}
                />
              </div>
            </div>
          )}

          {isSelectionMode && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>Scope</div>
              <div className={styles.scopeList}>
                <ScopeRadio
                  selected
                  disabled={busy}
                  name="Selected rows"
                  meta={`${selectedRows?.length ?? 0} row${(selectedRows?.length ?? 0) === 1 ? "" : "s"}`}
                  onSelect={() => {}}
                />
              </div>
            </div>
          )}

          {/* Format */}
          <div className={styles.section}>
            <div className={styles.sectionLabel}>Format</div>
            <div className={styles.formatRow}>
              <select
                className={styles.select}
                value={formatId}
                onChange={(e) => setFormatId(e.target.value)}
                disabled={busy}
              >
                {EXPORT_FORMATS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Per-format options */}
          {formatId === "csv" && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>CSV Options</div>
              <div className={styles.optionsGrid}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="csv-delim">
                    Delimiter
                  </label>
                  <select
                    id="csv-delim"
                    className={styles.select}
                    value={csvOpts.delimiter}
                    onChange={(e) =>
                      setCsvOpts((o) => ({ ...o, delimiter: e.target.value }))
                    }
                    disabled={busy}
                  >
                    <option value=",">, (comma)</option>
                    <option value=";">; (semicolon)</option>
                    <option value="\t">↹ (tab)</option>
                    <option value="|">| (pipe)</option>
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="csv-null">
                    Null value
                  </label>
                  <input
                    id="csv-null"
                    className={styles.select}
                    value={csvOpts.null_string}
                    onChange={(e) =>
                      setCsvOpts((o) => ({ ...o, null_string: e.target.value }))
                    }
                    placeholder="(empty)"
                    disabled={busy}
                  />
                </div>
                <label className={styles.checkboxField}>
                  <input
                    type="checkbox"
                    checked={csvOpts.include_header}
                    onChange={(e) =>
                      setCsvOpts((o) => ({
                        ...o,
                        include_header: e.target.checked,
                      }))
                    }
                    disabled={busy}
                  />
                  Include header row
                </label>
              </div>
            </div>
          )}

          {/* Progress */}
          {run.kind === "running" && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>Exporting</div>
              <div className={styles.progressSection}>
                <div className={styles.progressBarOuter}>
                  {run.total && run.total > 0 ? (
                    <div
                      className={styles.progressBarInner}
                      style={{
                        width: `${Math.min(100, (run.rowsWritten / run.total) * 100)}%`,
                      }}
                    />
                  ) : (
                    <div className={styles.progressBarIndeterminate} />
                  )}
                </div>
                <div className={styles.progressMeta}>
                  <span>{formatNumber(run.rowsWritten)} rows written</span>
                  {run.total !== null && (
                    <span>of ~{formatNumber(run.total)}</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Summary */}
          {run.kind === "done" && (
            <div
              className={styles.summary}
              data-cancelled={run.cancelled ? "true" : "false"}
            >
              <div>
                <strong>
                  {run.cancelled ? "Cancelled" : "Export complete"}
                </strong>
                {" — "}
                {formatNumber(run.rowsWritten)} rows,{" "}
                {formatBytes(run.bytesWritten)} in {run.durationMs} ms
              </div>
              <div className={styles.scopeMeta}>{run.path}</div>
            </div>
          )}

          {run.kind === "error" && (
            <div className={styles.error}>
              <strong>Export failed</strong>
              <div>{run.message}</div>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          {run.kind === "running" ? (
            <>
              <Button variant="ghost" onClick={handleCancel} type="button">
                Cancel export
              </Button>
            </>
          ) : run.kind === "done" || run.kind === "error" ? (
            <Button onClick={onClose} type="button">
              Close
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose} type="button">
                Cancel
              </Button>
              <Button onClick={handleExport} type="button" disabled={!format}>
                <Download size={14} />
                Export
              </Button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface ScopeRadioProps {
  selected: boolean;
  disabled: boolean;
  name: string;
  meta: string;
  onSelect: () => void;
}

function ScopeRadio({
  selected,
  disabled,
  name,
  meta,
  onSelect,
}: ScopeRadioProps) {
  return (
    <label
      className={`${styles.scopeOption} ${selected ? styles.scopeOptionSelected : ""} ${
        disabled ? styles.scopeOptionDisabled : ""
      }`}
    >
      <input
        type="radio"
        name="export-scope"
        checked={selected}
        onChange={onSelect}
        disabled={disabled}
      />
      <div className={styles.scopeLabel}>
        <span className={styles.scopeName}>{name}</span>
        <span className={styles.scopeMeta}>{meta}</span>
      </div>
    </label>
  );
}
