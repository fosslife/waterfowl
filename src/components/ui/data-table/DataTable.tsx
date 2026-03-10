import { useMemo, useRef, useState, useCallback, useEffect, memo } from "react";
import { createPortal } from "react-dom";
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
  Pencil,
  Ban,
  Code2,
  ClipboardList,
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
import { useToast } from "@context/ToastContext";

export interface PaginationState {
  page: number;
  pageSize: number;
  totalCount: number;
}

export interface SelectionActions {
  onCopyRows?: (rows: Record<string, any>[]) => void;
  onDeleteRows?: (rows: Record<string, any>[]) => void;
}

export interface CellPosition {
  rowIndex: number;
  columnId: string;
}

export interface CellActions {
  onCellUpdate?: (
    row: Record<string, any>,
    columnId: string,
    newValue: string | null,
  ) => Promise<void>;
}

export interface ColumnInfo {
  name: string;
  pg_type: string;
  ordinal_position?: number;
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
  cellActions?: CellActions;
  tableName?: string;
  schemaName?: string;
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
  cellActions,
  tableName,
  schemaName,
}: DataTableProps) {
  const toastContext = useToast();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(
    new Set(),
  );
  const [selectedCell, setSelectedCell] = useState<CellPosition | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    rowIndex: number;
    columnId: string;
  } | null>(null);
  const [editingCell, setEditingCell] = useState<{
    rowIndex: number;
    columnId: string;
    value: string;
  } | null>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedIndices(new Set());
    setSelectedCell(null);
    setEditingCell(null);
    setContextMenu(null);
  }, [data]);

  useEffect(() => {
    setSelectedCell(null);
    setEditingCell(null);
  }, [sorting]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const wrapper = tableContainerRef.current;
    wrapper?.addEventListener("scroll", close);
    return () => wrapper?.removeEventListener("scroll", close);
  }, [contextMenu]);

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
    [data.length, selectedIndices.size],
  );
  const isSomeSelected = useMemo(
    () => selectedIndices.size > 0 && selectedIndices.size < data.length,
    [data.length, selectedIndices.size],
  );

  const handleCellClick = useCallback((rowIndex: number, columnId: string) => {
    setSelectedCell({ rowIndex, columnId });
    tableContainerRef.current?.focus();
  }, []);

  const clearCellSelection = useCallback(() => {
    setSelectedCell(null);
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, rowIndex: number, columnId: string) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, rowIndex, columnId });
      setSelectedCell({ rowIndex, columnId });
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

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

  // Generate columns dynamically - use columnInfo order if available (pre-sorted by ordinal_position)
  const columns = useMemo<ColumnDef<Record<string, any>>[]>(() => {
    if (data.length === 0) return [];

    // Use columnInfo order if available, otherwise fall back to Object.keys
    const keys =
      columnInfo && columnInfo.length > 0
        ? columnInfo.map((col) => col.name)
        : Object.keys(data[0]);

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
  }, [data, columnInfo, columnTypeMap]);

  const columnIds = useMemo(
    () => columns.map((col) => (col as { accessorKey: string }).accessorKey),
    [columns],
  );

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnSizing,
    },
    onSortingChange: setSorting,
    onColumnSizingChange: setColumnSizing,
    columnResizeMode: "onChange", // Better perf: only update state when drag ends
    enableColumnResizing: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const { rows } = table.getRowModel();

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 36,
    overscan: 10,
  });

  const selectedCellInfo = useMemo(() => {
    if (!selectedCell) return null;
    const row = rows[selectedCell.rowIndex];
    if (!row) return null;
    const value = row.original[selectedCell.columnId];
    const type =
      columnTypeMap[selectedCell.columnId] ||
      inferType(data, selectedCell.columnId);
    return {
      columnName: selectedCell.columnId,
      columnType: type,
      formattedValue: formatValue(value),
    };
  }, [selectedCell, rows, columnTypeMap, data]);

  const handleCopyCell = useCallback(() => {
    if (selectedCellInfo) {
      navigator.clipboard.writeText(selectedCellInfo.formattedValue);
      toastContext.success("Cell value copied to clipboard");
    }
  }, [selectedCellInfo, toastContext]);

  const startEditing = useCallback(
    (rowIndex: number, columnId: string) => {
      if (!cellActions?.onCellUpdate) return;
      const row = rows[rowIndex];
      if (!row) return;
      const value = row.original[columnId];
      setEditingCell({
        rowIndex,
        columnId,
        value: value === null || value === undefined ? "" : String(value),
      });
    },
    [cellActions, rows],
  );

  const handleEditChange = useCallback((value: string) => {
    setEditingCell((prev) => (prev ? { ...prev, value } : null));
  }, []);

  const handleEditConfirm = useCallback(async () => {
    const cell = editingCell;
    setEditingCell(null);
    if (!cell || !cellActions?.onCellUpdate) return;
    const row = rows[cell.rowIndex];
    if (!row) return;
    const originalFormatted = formatValue(row.original[cell.columnId]);
    if (cell.value === originalFormatted) return;
    try {
      await cellActions.onCellUpdate(row.original, cell.columnId, cell.value);
      toastContext.success("Cell updated successfully");
    } catch {
      toastContext.error("Failed to update cell");
      // Parent handles additional error display
    }
  }, [editingCell, cellActions, rows, toastContext]);

  const handleEditCancel = useCallback(() => {
    setEditingCell(null);
  }, []);

  const handleSetNull = useCallback(
    async (rowIndex: number, columnId: string) => {
      if (!cellActions?.onCellUpdate) return;
      const row = rows[rowIndex];
      if (!row) return;
      try {
        await cellActions.onCellUpdate(row.original, columnId, null);
        toastContext.success("Cell set to NULL");
      } catch {
        toastContext.error("Failed to set cell to NULL");
        // Parent handles error display
      }
    },
    [cellActions, rows, toastContext],
  );

  const handleCellDoubleClick = useCallback(
    (rowIndex: number, columnId: string) => {
      startEditing(rowIndex, columnId);
    },
    [startEditing],
  );

  const copyRow = useCallback(
    (rowIndex: number) => {
      const row = rows[rowIndex];
      if (!row) return;
      const values = columnIds.map((h) => {
        const val = row.original[h];
        if (val === null || val === undefined) return "";
        if (typeof val === "object") return JSON.stringify(val);
        return String(val);
      });
      navigator.clipboard.writeText(
        [columnIds.join("\t"), values.join("\t")].join("\n"),
      );
      toastContext.success("Row copied to clipboard");
    },
    [rows, columnIds, toastContext],
  );

  const copyAsInsert = useCallback(
    (rowIndex: number) => {
      const row = rows[rowIndex];
      if (!row || !tableName) return;
      const values = columnIds.map((col) =>
        formatAsSqlLiteral(row.original[col]),
      );
      const qualified = schemaName
        ? `"${schemaName}"."${tableName}"`
        : `"${tableName}"`;
      const sql = `INSERT INTO ${qualified} (${columnIds.map((c) => `"${c}"`).join(", ")}) VALUES (${values.join(", ")});`;
      navigator.clipboard.writeText(sql);
      toastContext.success("INSERT statement copied to clipboard");
    },
    [rows, tableName, schemaName, columnIds, toastContext],
  );

  const handleTableKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (editingCell) return;
      if (!selectedCell) return;

      const colIdx = columnIds.indexOf(selectedCell.columnId);

      switch (e.key) {
        case "Enter":
        case "F2":
          if (cellActions?.onCellUpdate) {
            e.preventDefault();
            startEditing(selectedCell.rowIndex, selectedCell.columnId);
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          if (selectedCell.rowIndex > 0) {
            const idx = selectedCell.rowIndex - 1;
            setSelectedCell({ rowIndex: idx, columnId: selectedCell.columnId });
            rowVirtualizer.scrollToIndex(idx);
          }
          break;
        case "ArrowDown":
          e.preventDefault();
          if (selectedCell.rowIndex < rows.length - 1) {
            const idx = selectedCell.rowIndex + 1;
            setSelectedCell({ rowIndex: idx, columnId: selectedCell.columnId });
            rowVirtualizer.scrollToIndex(idx);
          }
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (colIdx > 0) {
            setSelectedCell({
              ...selectedCell,
              columnId: columnIds[colIdx - 1],
            });
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          if (colIdx < columnIds.length - 1) {
            setSelectedCell({
              ...selectedCell,
              columnId: columnIds[colIdx + 1],
            });
          }
          break;
        case "Tab":
          e.preventDefault();
          if (e.shiftKey) {
            if (colIdx > 0) {
              setSelectedCell({
                ...selectedCell,
                columnId: columnIds[colIdx - 1],
              });
            } else if (selectedCell.rowIndex > 0) {
              const idx = selectedCell.rowIndex - 1;
              setSelectedCell({
                rowIndex: idx,
                columnId: columnIds[columnIds.length - 1],
              });
              rowVirtualizer.scrollToIndex(idx);
            }
          } else {
            if (colIdx < columnIds.length - 1) {
              setSelectedCell({
                ...selectedCell,
                columnId: columnIds[colIdx + 1],
              });
            } else if (selectedCell.rowIndex < rows.length - 1) {
              const idx = selectedCell.rowIndex + 1;
              setSelectedCell({ rowIndex: idx, columnId: columnIds[0] });
              rowVirtualizer.scrollToIndex(idx);
            }
          }
          break;
        case "Escape":
          setSelectedCell(null);
          break;
        case "c":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            handleCopyCell();
          }
          break;
      }
    },
    [
      editingCell,
      selectedCell,
      columnIds,
      rows.length,
      rowVirtualizer,
      handleCopyCell,
      cellActions,
      startEditing,
    ],
  );

  useEffect(() => {
    if (!selectedCell) return;
    const timer = setTimeout(() => {
      const cellEl = tableContainerRef.current?.querySelector(
        `[data-cell-row="${selectedCell.rowIndex}"][data-cell-col="${selectedCell.columnId}"]`,
      ) as HTMLElement;
      if (cellEl) {
        cellEl.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [selectedCell]);

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
      <div className={styles.mainArea}>
        <div
          className={styles.wrapper}
          ref={tableContainerRef}
          tabIndex={-1}
          onKeyDown={handleTableKeyDown}
        >
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
                                header.getContext(),
                              )}
                            </span>
                            <span className={styles.columnType}>
                              {columnMeta?.type || "unknown"}
                            </span>
                          </div>
                          <span className={styles.sortIcon}>
                            {sortDirection === "asc" && <ArrowUp size={12} />}
                            {sortDirection === "desc" && (
                              <ArrowDown size={12} />
                            )}
                          </span>
                        </div>
                        {/* Column resize handle */}
                        <div
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          className={`${styles.resizer} ${
                            header.column.getIsResizing()
                              ? styles.isResizing
                              : ""
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
                    selectedCellColumnId={
                      selectedCell?.rowIndex === virtualRow.index
                        ? selectedCell.columnId
                        : null
                    }
                    onCellClick={handleCellClick}
                    onCellDoubleClick={handleCellDoubleClick}
                    onContextMenu={handleContextMenu}
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

      {((selectable && selectedIndices.size > 0) ||
        (selectedCellInfo && selectedCell)) && (
        <div className={styles.sidebar}>
          {selectable && selectedIndices.size > 0 && (
            <SelectionSidebarPanel
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

          {selectedCellInfo && selectedCell && (
            <CellSidebarPanel
              columnName={selectedCellInfo.columnName}
              columnType={selectedCellInfo.columnType}
              value={selectedCellInfo.formattedValue}
              onCopy={handleCopyCell}
              onClear={clearCellSelection}
              onEdit={
                cellActions?.onCellUpdate
                  ? () =>
                      startEditing(selectedCell.rowIndex, selectedCell.columnId)
                  : undefined
              }
              onSetNull={
                cellActions?.onCellUpdate
                  ? () =>
                      handleSetNull(
                        selectedCell.rowIndex,
                        selectedCell.columnId,
                      )
                  : undefined
              }
              onCopyAsInsert={
                tableName
                  ? () => copyAsInsert(selectedCell.rowIndex)
                  : undefined
              }
              isEditing={
                editingCell?.rowIndex === selectedCell.rowIndex &&
                editingCell?.columnId === selectedCell.columnId
              }
              editValue={
                editingCell?.rowIndex === selectedCell.rowIndex &&
                editingCell?.columnId === selectedCell.columnId
                  ? editingCell?.value
                  : undefined
              }
              onEditChange={handleEditChange}
              onEditConfirm={handleEditConfirm}
              onEditCancel={handleEditCancel}
            />
          )}
        </div>
      )}

      {contextMenu &&
        createPortal(
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onCopyCell={() => {
              const row = rows[contextMenu.rowIndex];
              if (row) {
                navigator.clipboard.writeText(
                  formatValue(row.original[contextMenu.columnId]),
                );
              }
              closeContextMenu();
            }}
            onCopyRow={() => {
              copyRow(contextMenu.rowIndex);
              closeContextMenu();
            }}
            onCopyAsInsert={
              tableName
                ? () => {
                    copyAsInsert(contextMenu.rowIndex);
                    closeContextMenu();
                  }
                : undefined
            }
            onEdit={
              cellActions?.onCellUpdate
                ? () => {
                    startEditing(contextMenu.rowIndex, contextMenu.columnId);
                    closeContextMenu();
                  }
                : undefined
            }
            onSetNull={
              cellActions?.onCellUpdate
                ? () => {
                    handleSetNull(contextMenu.rowIndex, contextMenu.columnId);
                    closeContextMenu();
                  }
                : undefined
            }
            onClose={closeContextMenu}
          />,
          document.body,
        )}
    </div>
  );
}

const SelectionSidebarPanel = memo(function SelectionSidebarPanel({
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
    <div className={styles.sidebarSection}>
      <div className={styles.sidebarSectionHeader}>
        <div className={styles.sidebarSectionTitle}>
          <span className={styles.sidebarCount}>{selectedCount}</span>
          <span className={styles.sidebarLabel}>
            row{selectedCount !== 1 ? "s" : ""} selected
          </span>
        </div>
        <button
          className={styles.sidebarCloseBtn}
          onClick={onClear}
          title="Clear selection"
        >
          <X size={14} />
        </button>
      </div>

      <div className={styles.sidebarActions}>
        {onCopy && (
          <button
            className={styles.sidebarBtn}
            onClick={onCopy}
            title="Copy selected rows"
          >
            <Copy size={16} />
            <span>Copy Rows</span>
          </button>
        )}
        {onDelete && (
          <button
            className={`${styles.sidebarBtn} ${styles.sidebarBtnDanger}`}
            onClick={onDelete}
            title="Delete selected rows"
          >
            <Trash2 size={16} />
            <span>Delete Rows</span>
          </button>
        )}
      </div>
    </div>
  );
});

const CellSidebarPanel = memo(function CellSidebarPanel({
  columnName,
  columnType,
  value,
  onCopy,
  onClear,
  onEdit,
  onSetNull,
  onCopyAsInsert,
  isEditing,
  editValue,
  onEditChange,
  onEditConfirm,
  onEditCancel,
}: {
  columnName: string;
  columnType: string;
  value: string;
  onCopy: () => void;
  onClear: () => void;
  onEdit?: () => void;
  onSetNull?: () => void;
  onCopyAsInsert?: () => void;
  isEditing?: boolean;
  editValue?: string;
  onEditChange?: (val: string) => void;
  onEditConfirm?: () => void;
  onEditCancel?: () => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.setSelectionRange(
        inputRef.current.value.length,
        inputRef.current.value.length,
      );
    }
  }, [isEditing]);

  // Format long strings nicely
  let displayValue = value;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null) {
      displayValue = JSON.stringify(parsed, null, 2);
    }
  } catch (e) {
    // not JSON, keep as is
  }

  return (
    <div className={styles.sidebarSection}>
      <div className={styles.sidebarSectionHeader}>
        <div className={styles.sidebarSectionTitle}>
          <span className={styles.sidebarColumnName}>{columnName}</span>
          <span className={styles.sidebarColumnType}>{columnType}</span>
        </div>
        <button
          className={styles.sidebarCloseBtn}
          onClick={onClear}
          title="Clear selection (Esc)"
        >
          <X size={14} />
        </button>
      </div>

      <div className={styles.sidebarValueContainer}>
        {isEditing && editValue !== undefined ? (
          <textarea
            ref={inputRef}
            className={styles.sidebarEditorInput}
            value={editValue}
            onChange={(e) => onEditChange?.(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onEditConfirm?.();
              }
              if (e.key === "Escape") onEditCancel?.();
            }}
          />
        ) : (
          <pre className={styles.sidebarPreValue}>{displayValue}</pre>
        )}
      </div>

      <div className={styles.sidebarActions}>
        {isEditing ? (
          <>
            <button
              className={styles.sidebarBtn}
              onClick={onEditConfirm}
              title="Save changes (Enter)"
            >
              <Check size={16} />
              <span>Save Value</span>
            </button>
            <button
              className={styles.sidebarBtn}
              onClick={onEditCancel}
              title="Cancel editing (Esc)"
            >
              <X size={16} />
              <span>Cancel Edit</span>
            </button>
          </>
        ) : (
          <>
            <button
              className={styles.sidebarBtn}
              onClick={onCopy}
              title="Copy cell value (Ctrl+C)"
            >
              <Copy size={16} />
              <span>Copy Value</span>
            </button>
            {onCopyAsInsert && (
              <button
                className={styles.sidebarBtn}
                onClick={onCopyAsInsert}
                title="Copy row as INSERT statement"
              >
                <Code2 size={16} />
                <span>Copy as INSERT</span>
              </button>
            )}
            {onEdit && (
              <button
                className={styles.sidebarBtn}
                onClick={onEdit}
                title="Edit cell value (Enter)"
              >
                <Pencil size={16} />
                <span>Edit Value</span>
              </button>
            )}
            {onSetNull && (
              <button
                className={`${styles.sidebarBtn} ${styles.sidebarBtnDanger}`}
                onClick={onSetNull}
                title="Set cell value to NULL"
              >
                <Ban size={16} />
                <span>Set to NULL</span>
              </button>
            )}
          </>
        )}
      </div>
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

const ContextMenu = memo(function ContextMenu({
  x,
  y,
  onCopyCell,
  onCopyRow,
  onCopyAsInsert,
  onEdit,
  onSetNull,
  onClose,
}: {
  x: number;
  y: number;
  onCopyCell: () => void;
  onCopyRow: () => void;
  onCopyAsInsert?: () => void;
  onEdit?: () => void;
  onSetNull?: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Keep menu within viewport bounds
  const adjustedX = Math.min(x, window.innerWidth - 220);
  const adjustedY = Math.min(y, window.innerHeight - 240);

  return (
    <div
      ref={menuRef}
      className={styles.contextMenu}
      style={{ left: adjustedX, top: adjustedY }}
    >
      <button className={styles.contextMenuItem} onClick={onCopyCell}>
        <Copy size={14} />
        <span>Copy Cell Value</span>
        <span className={styles.contextMenuShortcut}>Ctrl+C</span>
      </button>
      <button className={styles.contextMenuItem} onClick={onCopyRow}>
        <ClipboardList size={14} />
        <span>Copy Row</span>
      </button>
      {onCopyAsInsert && (
        <button className={styles.contextMenuItem} onClick={onCopyAsInsert}>
          <Code2 size={14} />
          <span>Copy as INSERT</span>
        </button>
      )}
      {(onEdit || onSetNull) && <div className={styles.contextMenuDivider} />}
      {onEdit && (
        <button className={styles.contextMenuItem} onClick={onEdit}>
          <Pencil size={14} />
          <span>Edit Value</span>
          <span className={styles.contextMenuShortcut}>Enter</span>
        </button>
      )}
      {onSetNull && (
        <button
          className={styles.contextMenuItem}
          data-variant="danger"
          onClick={onSetNull}
        >
          <Ban size={14} />
          <span>Set NULL</span>
        </button>
      )}
    </div>
  );
});

export function formatAsSqlLiteral(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return String(val);
  if (Array.isArray(val)) {
    return `ARRAY[${val.map((v) => formatAsSqlLiteral(v)).join(", ")}]`;
  }
  if (typeof val === "object") {
    return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(val).replace(/'/g, "''")}'`;
}

function inferType(data: Record<string, any>[], col: string): string {
  const sample = data.find(
    (row) => row[col] !== null && row[col] !== undefined,
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
  if (Array.isArray(val)) {
    // Display arrays as comma-separated values
    return val.map((v) => (v === null ? "NULL" : String(v))).join(", ");
  }
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}
