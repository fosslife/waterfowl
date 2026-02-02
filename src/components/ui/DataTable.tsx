import { useMemo, useRef, useState, useCallback, useEffect, memo } from "react";
import {
  Loader2,
  Database,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Trash2,
  X,
  Check,
  Minus,
} from "lucide-react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnSizingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import styles from "./DataTable.module.css";
import { TableRow } from "./TableRow";

export interface PaginationState {
  page: number;
  pageSize: number;
  totalCount: number;
}

export interface SelectionActions {
  onCopyRows?: (rows: Record<string, any>[]) => void;
  onDeleteRows?: (rows: Record<string, any>[]) => void;
}

export interface ColumnInfo {
  name: string;
  pg_type: string;
}

interface DataTableProps {
  data: Record<string, any>[];
  columnInfo?: ColumnInfo[];
  isLoading?: boolean;
  emptyMessage?: string;
  pagination?: PaginationState;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  selectable?: boolean;
  selectionActions?: SelectionActions;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500];

export function DataTable({
  data,
  columnInfo,
  isLoading,
  emptyMessage = "No data found",
  pagination,
  onPageChange,
  onPageSizeChange,
  selectable = false,
  selectionActions,
}: DataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(
    new Set()
  );
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Clear selection when data changes (e.g., page change)
  useEffect(() => {
    setSelectedIndices(new Set());
  }, [data]);

  const toggleRowSelection = useCallback((index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const toggleAllSelection = useCallback(() => {
    if (selectedIndices.size === data.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(data.map((_, i) => i)));
    }
  }, [data, selectedIndices.size]);

  const clearSelection = useCallback(() => {
    setSelectedIndices(new Set());
  }, []);

  const getSelectedRows = useCallback(() => {
    return Array.from(selectedIndices).map((i) => data[i]);
  }, [selectedIndices, data]);

  const isAllSelected = useMemo(
    () => data.length > 0 && selectedIndices.size === data.length,
    [data.length, selectedIndices.size]
  );
  const isSomeSelected = useMemo(
    () => selectedIndices.size > 0 && selectedIndices.size < data.length,
    [data.length, selectedIndices.size]
  );

  // Build a lookup map for column types from columnInfo
  const columnTypeMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (columnInfo) {
      for (const col of columnInfo) {
        map[col.name] = col.pg_type;
      }
    }
    return map;
  }, [columnInfo]);

  // Generate columns dynamically from data
  const columns = useMemo<ColumnDef<Record<string, any>>[]>(() => {
    if (data.length === 0) return [];

    const keys = Object.keys(data[0]);
    return keys.map((key) => ({
      accessorKey: key,
      header: key,
      cell: ({ getValue }) => {
        const value = getValue();
        return formatValue(value);
      },
      size: 150, // Default column width
      minSize: 50,
      maxSize: 500,
      meta: {
        // Use PostgreSQL type from metadata if available, otherwise infer
        type: columnTypeMap[key] || inferType(data, key),
      },
    }));
  }, [data, columnTypeMap]);

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnSizing,
    },
    onSortingChange: setSorting,
    onColumnSizingChange: setColumnSizing,
    columnResizeMode: "onEnd", // Better perf: only update state when drag ends
    enableColumnResizing: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const { rows } = table.getRowModel();

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 36, // Estimated row height
    overscan: 10,
  });

  if (isLoading) {
    return (
      <div className={styles.loadingState}>
        <div className={styles.loadingSpinner}>
          <Loader2 className={styles.spinnerIcon} size={24} />
          <div className={styles.scanLine} />
        </div>
        <span className={styles.loadingText}>Fetching records...</span>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={styles.emptyState}>
        <Database size={32} className={styles.emptyIcon} />
        <span className={styles.emptyText}>{emptyMessage}</span>
      </div>
    );
  }

  const virtualRows = rowVirtualizer.getVirtualItems();

  // Calculate total table width: fixed columns + resizable columns
  const fixedColumnsWidth = (selectable ? 40 : 0) + 50; // checkbox (40) + row index (50)
  const totalTableWidth = fixedColumnsWidth + table.getTotalSize();

  return (
    <div className={styles.container}>
      {/* Selection Toolbar */}
      {selectable && selectedIndices.size > 0 && (
        <SelectionToolbar
          selectedCount={selectedIndices.size}
          onClear={clearSelection}
          onCopy={
            selectionActions?.onCopyRows
              ? () => selectionActions.onCopyRows?.(getSelectedRows())
              : undefined
          }
          onDelete={
            selectionActions?.onDeleteRows
              ? () => selectionActions.onDeleteRows?.(getSelectedRows())
              : undefined
          }
        />
      )}

      <div className={styles.wrapper} ref={tableContainerRef}>
        <table className={styles.table} style={{ width: totalTableWidth }}>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} style={{ width: totalTableWidth }}>
                {selectable && (
                  <th className={styles.checkboxCell}>
                    <label className={styles.checkbox}>
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = isSomeSelected;
                        }}
                        onChange={toggleAllSelection}
                      />
                      <span className={styles.checkboxIndicator}>
                        {isAllSelected ? (
                          <Check size={12} />
                        ) : isSomeSelected ? (
                          <Minus size={12} />
                        ) : null}
                      </span>
                    </label>
                  </th>
                )}
                <th className={styles.rowIndex}>#</th>
                {headerGroup.headers.map((header) => {
                  const sortDirection = header.column.getIsSorted();
                  const columnMeta = header.column.columnDef.meta as
                    | { type: string }
                    | undefined;
                  const isNumericType = isNumericColumn(columnMeta?.type);

                  return (
                    <th
                      key={header.id}
                      className={`${styles.sortableHeader} ${
                        isNumericType ? styles.headerRight : ""
                      }`}
                      style={{ width: header.getSize() }}
                    >
                      <div
                        className={styles.headerContent}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <div>
                          <span className={styles.columnName}>
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                          </span>
                          <span className={styles.columnType}>
                            {columnMeta?.type || "unknown"}
                          </span>
                        </div>
                        <span className={styles.sortIcon}>
                          {sortDirection === "asc" && <ArrowUp size={12} />}
                          {sortDirection === "desc" && <ArrowDown size={12} />}
                        </span>
                      </div>
                      {/* Column resize handle */}
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        className={`${styles.resizer} ${
                          header.column.getIsResizing() ? styles.isResizing : ""
                        }`}
                      />
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              position: "relative",
            }}
          >
            {virtualRows.map((virtualRow) => {
              const row = rows[virtualRow.index];
              return (
                <TableRow
                  key={row.id}
                  row={row}
                  virtualRow={virtualRow}
                  isSelected={selectedIndices.has(virtualRow.index)}
                  isOdd={virtualRow.index % 2 === 1}
                  selectable={selectable}
                  pagination={pagination}
                  totalTableWidth={totalTableWidth}
                  onToggleSelection={toggleRowSelection}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={styles.tableFooter}>
        {pagination ? (
          <PaginationControls
            pagination={pagination}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
          />
        ) : (
          <span className={styles.rowCount}>{data.length} rows</span>
        )}
      </div>
    </div>
  );
}

const SelectionToolbar = memo(function SelectionToolbar({
  selectedCount,
  onClear,
  onCopy,
  onDelete,
}: {
  selectedCount: number;
  onClear: () => void;
  onCopy?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className={styles.selectionToolbar}>
      <div className={styles.selectionInfo}>
        <span className={styles.selectionCount}>{selectedCount}</span>
        <span className={styles.selectionLabel}>
          row{selectedCount !== 1 ? "s" : ""} selected
        </span>
      </div>

      <div className={styles.selectionActions}>
        {onCopy && (
          <button
            className={styles.selectionBtn}
            onClick={onCopy}
            title="Copy selected rows"
          >
            <Copy size={14} />
            <span>Copy</span>
          </button>
        )}
        {onDelete && (
          <button
            className={styles.selectionBtn}
            data-variant="danger"
            onClick={onDelete}
            title="Delete selected rows"
          >
            <Trash2 size={14} />
            <span>Delete</span>
          </button>
        )}
      </div>

      <button
        className={styles.selectionClearBtn}
        onClick={onClear}
        title="Clear selection"
      >
        <X size={14} />
      </button>
    </div>
  );
});

const PaginationControls = memo(function PaginationControls({
  pagination,
  onPageChange,
  onPageSizeChange,
}: {
  pagination: PaginationState;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}) {
  const { page, pageSize, totalCount } = pagination;
  const totalPages = Math.ceil(totalCount / pageSize);
  const startRow = page * pageSize + 1;
  const endRow = Math.min((page + 1) * pageSize, totalCount);

  const canGoPrev = page > 0;
  const canGoNext = page < totalPages - 1;

  return (
    <div className={styles.pagination}>
      {/* Page size selector */}
      <div className={styles.pageSizeSelector}>
        <span className={styles.pageSizeLabel}>Rows:</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange?.(Number(e.target.value))}
          className={styles.pageSizeSelect}
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>

      {/* Navigation controls */}
      <div className={styles.pageNav}>
        <button
          onClick={() => onPageChange?.(0)}
          disabled={!canGoPrev}
          className={styles.pageBtn}
          title="First page"
        >
          <ChevronsLeft size={14} />
        </button>
        <button
          onClick={() => onPageChange?.(page - 1)}
          disabled={!canGoPrev}
          className={styles.pageBtn}
          title="Previous page"
        >
          <ChevronLeft size={14} />
        </button>

        <span className={styles.pageInfo}>
          Page {page + 1} of {totalPages || 1}
        </span>

        <button
          onClick={() => onPageChange?.(page + 1)}
          disabled={!canGoNext}
          className={styles.pageBtn}
          title="Next page"
        >
          <ChevronRight size={14} />
        </button>
        <button
          onClick={() => onPageChange?.(totalPages - 1)}
          disabled={!canGoNext}
          className={styles.pageBtn}
          title="Last page"
        >
          <ChevronsRight size={14} />
        </button>
      </div>

      {/* Row range */}
      <span className={styles.rowCount}>
        {totalCount > 0
          ? `${startRow}-${endRow} of ${totalCount.toLocaleString()}`
          : "0 rows"}
      </span>
    </div>
  );
});

function inferType(data: Record<string, any>[], col: string): string {
  const sample = data.find(
    (row) => row[col] !== null && row[col] !== undefined
  )?.[col];
  if (sample === undefined) return "unknown";
  if (typeof sample === "number")
    return Number.isInteger(sample) ? "int" : "float";
  if (typeof sample === "boolean") return "bool";
  if (typeof sample === "string") {
    if (/^\d{4}-\d{2}-\d{2}/.test(sample)) return "date";
    if (sample.length > 100) return "text";
    return "varchar";
  }
  if (typeof sample === "object") return "json";
  return "unknown";
}

/** Check if column type is numeric (for right-alignment) */
function isNumericColumn(type: string | undefined): boolean {
  if (!type) return false;
  const numericTypes = [
    "int",
    "float",
    "int2",
    "int4",
    "int8",
    "smallint",
    "integer",
    "bigint",
    "serial",
    "smallserial",
    "bigserial",
    "float4",
    "float8",
    "real",
    "double precision",
    "numeric",
    "decimal",
    "money",
    "oid",
  ];
  return numericTypes.includes(type.toLowerCase());
}

function formatValue(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}
