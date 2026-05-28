import {
  useMemo,
  useRef,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";
import { createPortal } from "react-dom";
import {
  Loader2,
  Database,
  ArrowUp,
  ArrowDown,
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
  type VisibilityState,
  type ColumnPinningState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import styles from "./DataTable.module.css";
import { TableRow } from "./TableRow";
import { useToast } from "@context/ToastContext";
import {
  formatAsSqlLiteral,
  formatValue,
  inferType,
  isNumericColumn,
} from "@utils/sql";
import { SelectionSidebarPanel } from "./SelectionSidebar";
import { PaginationControls } from "./Pagination";
import { CellSidebarPanel } from "./CellSidebarPanel";
import { ContextMenu } from "./ContextMenu";
import {
  FilterCell,
  FilterBar,
  useColumnFilters,
  type ColumnFilter,
} from "./ColumnFilter";
import filterStyles from "./ColumnFilter/ColumnFilter.module.css";
import {
  ColumnVisibilityMenu,
  useColumnVisibility,
  useColumnPinning,
} from "./ColumnVisibility";
import {
  ExportDialog,
  type ExportDialogSource,
} from "@components/export/ExportDialog";
import { Download, RefreshCw } from "lucide-react";

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

export interface FilterActions {
  onFiltersChange: (filters: ColumnFilter[]) => void;
  enumValues?: Record<string, string[]>;
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
  filterActions?: FilterActions;
  /**
   * When set, column visibility is persisted in localStorage under this key.
   * When omitted, visibility is in-memory only.
   */
  columnVisibilityKey?: string;
  /**
   * When provided, an "Export" button is shown in the footer and
   * "Export Rows" is added to the selection sidebar. Omit to disable
   * export entirely (e.g. for ad-hoc query results we can't address by
   * table name).
   */
  exportConfig?: {
    source: ExportDialogSource;
    /** Active filters used by the "filtered" scope. Defaults to []. */
    activeFilters?: ColumnFilter[];
    /** Total row count of the table/view (label only). */
    totalCount?: number;
    /** Total matching rows when filters are active (label only). */
    filteredCount?: number;
  };
  /** When provided, a refresh button is shown in the footer. */
  onRefresh?: () => void;
}

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
  filterActions,
  columnVisibilityKey,
  exportConfig,
  onRefresh,
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
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [columnVisibility, setColumnVisibility] =
    useColumnVisibility(columnVisibilityKey);
  const [columnPinning, setColumnPinning] =
    useColumnPinning(columnVisibilityKey);
  // null when the dialog is closed; "full" for the footer button and
  // "selection" when invoked from the selection sidebar (locks scope and
  // hides the page/filtered/all picker).
  const [exportMode, setExportMode] = useState<"full" | "selection" | null>(
    null,
  );
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const {
    filterInputs,
    setFilterValue,
    setFilterOperator,
    clearFilter,
    clearAllFilters,
    activeFilterCount,
  } = useColumnFilters({
    onFiltersChange: filterActions?.onFiltersChange ?? (() => {}),
    debounceMs: 300,
  });

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
    // Prefer columnInfo if available
    if (columnInfo && columnInfo.length > 0) {
      const keys = columnInfo.map((col) => col.name);
      return keys.map((key) => {
        const type = columnTypeMap[key];
        return {
          accessorKey: key,
          header: key,
          cell: ({ getValue }) => {
            const value = getValue();
            return formatValue(value);
          },
          size: 150, // Default column width
          minSize: 50,
          maxSize: 500,
          meta: { type: type || "unknown" }, // Pass original PG type down
        };
      });
    }

    // Fall back to inferring from data
    if (data.length === 0) return [];
    const keys = Object.keys(data[0]);

    return keys.map((key) => {
      const type = inferType(data, key);
      return {
        accessorKey: key,
        header: key,
        cell: ({ getValue }) => {
          const value = getValue();
          return formatValue(value);
        },
        size: 150, // Default column width
        minSize: 50,
        maxSize: 500,
        meta: { type }, // Store inferred type in meta
      };
    });
  }, [data, columnInfo, columnTypeMap]);

  // All column ids in their declaration order. Used by the visibility menu.
  const allColumnIds = useMemo(
    () => columns.map((col) => (col as { accessorKey: string }).accessorKey),
    [columns],
  );

  // Only visible column ids, in render order: left-pinned, center, then
  // right-pinned — matching TanStack's getVisibleLeafColumns ordering when
  // pinning is enabled. Drives layout (CSS widths, sticky offsets, filter
  // row), keyboard navigation, and copy/clipboard operations.
  const columnIds = useMemo(() => {
    const visible = allColumnIds.filter((id) => columnVisibility[id] !== false);
    const leftSet = new Set(columnPinning.left);
    const rightSet = new Set(columnPinning.right);
    const left = columnPinning.left.filter((id) => visible.includes(id));
    const right = columnPinning.right.filter((id) => visible.includes(id));
    const center = visible.filter(
      (id) => !leftSet.has(id) && !rightSet.has(id),
    );
    return [...left, ...center, ...right];
  }, [allColumnIds, columnVisibility, columnPinning]);

  // Live column-resize is handled by us via CSS variables (see resize handler
  // below). TanStack's built-in resize is disabled because it routes every
  // mousemove through React state, which re-renders all visible rows.
  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnSizing,
      columnVisibility: columnVisibility as VisibilityState,
      columnPinning: columnPinning as ColumnPinningState,
    },
    onSortingChange: setSorting,
    onColumnSizingChange: setColumnSizing,
    onColumnVisibilityChange: (updater) => {
      setColumnVisibility((prev) =>
        typeof updater === "function"
          ? (updater as (old: VisibilityState) => VisibilityState)(
              prev as VisibilityState,
            )
          : updater,
      );
    },
    onColumnPinningChange: (updater) => {
      setColumnPinning((prev) => {
        const next =
          typeof updater === "function"
            ? (updater as (old: ColumnPinningState) => ColumnPinningState)(
                prev as ColumnPinningState,
              )
            : updater;
        return { left: next.left ?? [], right: next.right ?? [] };
      });
    },
    enableColumnPinning: true,
    enableColumnResizing: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const { rows } = table.getRowModel();

  // --- Column-width state via CSS variables --------------------------------
  // Each column has a CSS var `--dt-w-<i>` on the wrapper. The total table
  // width is `--dt-table-w`. During drag we mutate these vars directly on the
  // wrapper DOM node — no React state churn until mouseup.
  const DEFAULT_COL_W = 150;
  const MIN_COL_W = 50;
  const MAX_COL_W = 500;
  const CHECKBOX_W = 40;
  const ROW_INDEX_W = 60; // matches .rowIndex width in CSS
  const FIXED_PREFIX_W = (selectable ? CHECKBOX_W : 0) + ROW_INDEX_W;

  // Per-column inline styles keyed by columnId. Width is a CSS var (mutated on
  // resize without re-render); pinned columns also carry a sticky left/right
  // offset var and a pin class so the cell sticks to the frozen edge.
  const { colCellStyles, colPinClass } = useMemo(() => {
    const styleMap: Record<string, React.CSSProperties> = {};
    const classMap: Record<string, string> = {};
    const leftSet = new Set(columnPinning.left);
    const rightSet = new Set(columnPinning.right);
    for (let i = 0; i < columnIds.length; i++) {
      const id = columnIds[i];
      if (leftSet.has(id)) {
        styleMap[id] = {
          width: `var(--dt-w-${i})`,
          left: `var(--dt-pin-left-${i})`,
        };
        classMap[id] = styles.pinnedLeft;
      } else if (rightSet.has(id)) {
        styleMap[id] = {
          width: `var(--dt-w-${i})`,
          right: `var(--dt-pin-right-${i})`,
        };
        classMap[id] = styles.pinnedRight;
      } else {
        styleMap[id] = { width: `var(--dt-w-${i})` };
        classMap[id] = "";
      }
    }
    return { colCellStyles: styleMap, colPinClass: classMap };
  }, [columnIds, columnPinning]);

  // Mirror columnSizing in a ref so the resize handler can read current widths
  // without re-binding listeners.
  const sizingRef = useRef<Record<string, number>>({});

  useLayoutEffect(() => {
    const el = tableContainerRef.current;
    if (!el) return;
    // Left offset for the sticky row-index cell (sits after the checkbox).
    el.style.setProperty("--dt-checkbox-w", `${selectable ? CHECKBOX_W : 0}px`);

    const widths: number[] = [];
    let total = FIXED_PREFIX_W;
    for (let i = 0; i < columnIds.length; i++) {
      const id = columnIds[i];
      const w = columnSizing[id] ?? DEFAULT_COL_W;
      sizingRef.current[id] = w;
      widths[i] = w;
      el.style.setProperty(`--dt-w-${i}`, `${w}px`);
      total += w;
    }
    el.style.setProperty("--dt-table-w", `${total}px`);

    // Sticky offsets for pinned columns. Left-pinned stack rightward from the
    // frozen prefix; right-pinned stack leftward from the right edge.
    const leftSet = new Set(columnPinning.left);
    const rightSet = new Set(columnPinning.right);
    let leftAcc = FIXED_PREFIX_W;
    for (let i = 0; i < columnIds.length; i++) {
      if (leftSet.has(columnIds[i])) {
        el.style.setProperty(`--dt-pin-left-${i}`, `${leftAcc}px`);
        leftAcc += widths[i];
      }
    }
    let rightAcc = 0;
    for (let i = columnIds.length - 1; i >= 0; i--) {
      if (rightSet.has(columnIds[i])) {
        el.style.setProperty(`--dt-pin-right-${i}`, `${rightAcc}px`);
        rightAcc += widths[i];
      }
    }
  }, [columnIds, columnSizing, FIXED_PREFIX_W, selectable, columnPinning]);

  const handleResizeStart = useCallback(
    (colId: string, colIdx: number, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const el = tableContainerRef.current;
      if (!el) return;
      const startX = e.clientX;
      const startW = sizingRef.current[colId] ?? DEFAULT_COL_W;

      // Snapshot the total minus the dragged column so we can recompute it
      // cheaply on every mousemove (just one addition).
      let totalRest = FIXED_PREFIX_W;
      for (const id of columnIds) {
        if (id !== colId) totalRest += sizingRef.current[id] ?? DEFAULT_COL_W;
      }

      const cssVar = `--dt-w-${colIdx}`;
      document.documentElement.classList.add("is-col-resizing");

      let lastWidth = startW;
      const onMove = (ev: MouseEvent) => {
        const next = Math.max(
          MIN_COL_W,
          Math.min(MAX_COL_W, startW + (ev.clientX - startX)),
        );
        if (next === lastWidth) return;
        lastWidth = next;
        el.style.setProperty(cssVar, `${next}px`);
        el.style.setProperty("--dt-table-w", `${totalRest + next}px`);
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.documentElement.classList.remove("is-col-resizing");
        sizingRef.current[colId] = lastWidth;
        // Commit final width to React state so it persists across renders.
        // Only one state update for the whole drag.
        setColumnSizing((prev) => ({ ...prev, [colId]: lastWidth }));
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [columnIds, FIXED_PREFIX_W],
  );

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

  if (isLoading && data.length === 0) {
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

  const virtualRows = rowVirtualizer.getVirtualItems();

  return (
    <div className={styles.container}>
      <div className={styles.mainArea}>
        <div
          className={styles.wrapper}
          ref={tableContainerRef}
          tabIndex={-1}
          onKeyDown={handleTableKeyDown}
        >
          <table className={styles.table}>
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
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
                  {headerGroup.headers.map((header, headerIdx) => {
                    const sortDirection = header.column.getIsSorted();
                    const columnMeta = header.column.columnDef.meta as
                      | { type: string }
                      | undefined;
                    const isNumericType = isNumericColumn(columnMeta?.type);
                    const colId = header.column.id;

                    return (
                      <th
                        key={header.id}
                        className={`${styles.sortableHeader} ${
                          isNumericType ? styles.headerRight : ""
                        } ${colPinClass[colId] ?? ""}`}
                        style={colCellStyles[colId]}
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
                        {/* Column resize handle — custom handler mutates CSS
                            variables directly to avoid per-pixel re-renders. */}
                        <div
                          onMouseDown={(ev) =>
                            handleResizeStart(colId, headerIdx, ev)
                          }
                          className={styles.resizer}
                        />
                      </th>
                    );
                  })}
                </tr>
              ))}
              {filtersVisible && filterActions && (
                <tr>
                  {selectable && (
                    <th className={filterStyles.filterRowPlaceholder} />
                  )}
                  <th className={filterStyles.filterRowPlaceholder} />
                  {table.getHeaderGroups()[0]?.headers.map((header) => {
                    const columnMeta = header.column.columnDef.meta as
                      | { type: string }
                      | undefined;
                    const pgType = columnMeta?.type ?? "unknown";
                    const colId = (
                      header.column.columnDef as { accessorKey: string }
                    ).accessorKey;
                    const filterInput = filterInputs[colId];

                    return (
                      <th
                        key={`filter-${header.id}`}
                        className={`${filterStyles.filterCell} ${colPinClass[colId] ?? ""}`}
                        style={colCellStyles[colId]}
                      >
                        <FilterCell
                          column={colId}
                          pgType={pgType}
                          value={filterInput?.value}
                          operator={filterInput?.operator}
                          onValueChange={setFilterValue}
                          onOperatorChange={setFilterOperator}
                          onClear={clearFilter}
                          enumValues={filterActions.enumValues?.[colId]}
                        />
                      </th>
                    );
                  })}
                </tr>
              )}
            </thead>
            <tbody
              style={{
                height:
                  data.length === 0
                    ? "100%"
                    : `${rowVirtualizer.getTotalSize()}px`,
                position: "relative",
              }}
            >
              {data.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length + (selectable ? 1 : 0) + 1}
                    style={{ padding: "40px" }}
                  >
                    <div className={styles.emptyState}>
                      <Database size={32} className={styles.emptyIcon} />
                      <span className={styles.emptyText}>{emptyMessage}</span>
                    </div>
                  </td>
                </tr>
              ) : (
                virtualRows.map((virtualRow) => {
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
                      colCellStyles={colCellStyles}
                      colPinClass={colPinClass}
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
                })
              )}
            </tbody>
          </table>
        </div>
        <div className={styles.tableFooter}>
          {allColumnIds.length > 0 && (
            <ColumnVisibilityMenu
              columns={allColumnIds.map((id) => ({ id, label: id }))}
              visibility={columnVisibility}
              onChange={setColumnVisibility}
              pinning={columnPinning}
              onPinChange={setColumnPinning}
            />
          )}
          {filterActions && (
            <FilterBar
              visible={filtersVisible}
              activeCount={activeFilterCount}
              onToggle={() => setFiltersVisible((v) => !v)}
              onClearAll={clearAllFilters}
            />
          )}
          {onRefresh && (
            <button
              type="button"
              className={styles.footerBtn}
              onClick={onRefresh}
              disabled={isLoading}
              title="Refresh data"
              aria-label="Refresh"
            >
              <RefreshCw
                size={13}
                className={isLoading ? styles.spin : undefined}
              />
              <span>Refresh</span>
            </button>
          )}
          {exportConfig && (
            <button
              type="button"
              className={styles.footerBtn}
              onClick={() => setExportMode("full")}
              title="Export"
            >
              <Download size={13} />
              <span>Export</span>
            </button>
          )}
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
              onExport={
                exportConfig ? () => setExportMode("selection") : undefined
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

      {exportConfig && exportMode !== null && (
        <ExportDialog
          isOpen
          onClose={() => setExportMode(null)}
          source={exportConfig.source}
          columns={columnIds.map((id) => ({
            name: id,
            pgType: columnTypeMap[id],
          }))}
          pageRows={data}
          activeFilters={exportConfig.activeFilters ?? []}
          totalCount={exportConfig.totalCount}
          filteredCount={exportConfig.filteredCount}
          selectedRows={
            exportMode === "selection" ? getSelectedRows() : undefined
          }
        />
      )}
    </div>
  );
}
