import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DataTable,
  PaginationState,
  SelectionActions,
  CellActions,
  FilterActions,
} from "@components/ui/data-table/DataTable";
import type { ColumnFilter } from "@components/ui/data-table/ColumnFilter/types";
import { getFilterCategory } from "@components/ui/data-table/ColumnFilter/types";
import { ConfirmDialog } from "@components/ui/dialog/ConfirmDialog";
import { useToast } from "@context/ToastContext";
import { TableTab } from "@context/TabContext";
import { formatAsSqlLiteral } from "@utils/sql";

export interface ColumnInfo {
  name: string;
  pg_type: string;
}

export interface PaginatedTableData {
  rows: Record<string, any>[];
  total_count: number;
  columns: ColumnInfo[];
}

export interface TableColumn {
  name: string;
  data_type: string;
  is_nullable: boolean;
  default_value: string | null;
  is_primary_key: boolean;
  is_unique: boolean;
  foreign_key: string | null;
}

export interface TableStructure {
  name: string;
  schema: string;
  columns: TableColumn[];
  indexes: any[];
  row_count: number;
  size: string;
  description: string | null;
}

interface EnumValues {
  values: string[];
}

const DEFAULT_PAGE_SIZE = 100;

interface TablePanelProps {
  connectionId: string;
  tab: TableTab;
}

export function TablePanel({ connectionId, tab }: TablePanelProps) {
  const toast = useToast();
  const [tableData, setTableData] = useState<any[]>([]);
  const [columnInfo, setColumnInfo] = useState<ColumnInfo[]>([]);
  const [primaryKeyColumns, setPrimaryKeyColumns] = useState<string[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [pagination, setPagination] = useState<PaginationState>({
    page: 0,
    pageSize: DEFAULT_PAGE_SIZE,
    totalCount: 0,
  });

  // Filter state
  const [activeFilters, setActiveFilters] = useState<ColumnFilter[]>([]);
  const [enumValuesMap, setEnumValuesMap] = useState<Record<string, string[]>>(
    {},
  );
  const fetchIdRef = useRef(0); // Track latest fetch to discard stale results

  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    rows: Record<string, any>[];
  }>({ isOpen: false, rows: [] });

  // Fetch enum values for columns that look like enums
  const fetchEnumValues = useCallback(
    async (columns: ColumnInfo[]) => {
      const enumColumns = columns.filter(
        (col) => getFilterCategory(col.pg_type) === "enum",
      );

      if (enumColumns.length === 0) return;

      const results: Record<string, string[]> = {};

      // Fetch in parallel but with concurrency — limit to avoid overwhelming
      await Promise.all(
        enumColumns.map(async (col) => {
          try {
            const result = await invoke<EnumValues>("get_enum_values", {
              id: connectionId,
              table: tab.tableName,
              column: col.name,
              schema: tab.schema,
            });
            if (result.values.length > 0) {
              results[col.name] = result.values;
            }
          } catch {
            // Silently skip — column will fall back to generic filter
          }
        }),
      );

      setEnumValuesMap(results);
    },
    [connectionId, tab.tableName, tab.schema],
  );

  const fetchTableData = useCallback(
    async (
      tableName: string,
      schema: string,
      page: number,
      pageSize: number,
      filters: ColumnFilter[] = [],
    ) => {
      const fetchId = ++fetchIdRef.current;
      setIsDataLoading(true);
      try {
        const useFiltered = filters.length > 0;

        const [result, structure] = await Promise.all([
          useFiltered
            ? invoke<PaginatedTableData>("get_filtered_table_data", {
                id: connectionId,
                table: tableName,
                schema: schema,
                limit: pageSize,
                offset: page * pageSize,
                filters: filters,
              })
            : invoke<PaginatedTableData>("get_table_data", {
                id: connectionId,
                table: tableName,
                schema: schema,
                limit: pageSize,
                offset: page * pageSize,
              }),
          page === 0 && filters.length === 0
            ? invoke<TableStructure>("get_table_structure", {
                id: connectionId,
                table: tableName,
                schema: schema,
              })
            : null,
        ]);

        // Discard results from stale requests
        if (fetchId !== fetchIdRef.current) return;

        setTableData(result.rows);
        setColumnInfo(result.columns || []);
        setPagination((prev) => ({
          ...prev,
          page,
          pageSize,
          totalCount: result.total_count,
        }));
        if (structure) {
          setPrimaryKeyColumns(
            structure.columns
              .filter((c) => c.is_primary_key)
              .map((c) => c.name),
          );
        }
      } catch (e: any) {
        // Discard errors from stale requests
        if (fetchId !== fetchIdRef.current) return;
        console.error(e);
        toast.error(`Failed to load table data: ${e}`);
      } finally {
        if (fetchId === fetchIdRef.current) {
          setIsDataLoading(false);
        }
      }
    },
    [connectionId, toast],
  );

  useEffect(() => {
    fetchTableData(tab.tableName, tab.schema, 0, pagination.pageSize);
  }, [connectionId, tab.tableName, tab.schema, fetchTableData]);

  // Fetch enum values when columnInfo changes
  useEffect(() => {
    if (columnInfo.length > 0) {
      fetchEnumValues(columnInfo);
    }
  }, [columnInfo, fetchEnumValues]);

  const handlePageChange = useCallback(
    (newPage: number) => {
      fetchTableData(
        tab.tableName,
        tab.schema,
        newPage,
        pagination.pageSize,
        activeFilters,
      );
    },
    [tab, pagination.pageSize, activeFilters, fetchTableData],
  );

  const handlePageSizeChange = useCallback(
    (newPageSize: number) => {
      fetchTableData(tab.tableName, tab.schema, 0, newPageSize, activeFilters);
    },
    [tab, activeFilters, fetchTableData],
  );

  // Handle filter changes — reset to page 0 and fetch with new filters
  const handleFiltersChange = useCallback(
    (filters: ColumnFilter[]) => {
      setActiveFilters(filters);
      fetchTableData(
        tab.tableName,
        tab.schema,
        0,
        pagination.pageSize,
        filters,
      );
    },
    [tab, pagination.pageSize, fetchTableData],
  );

  const filterActions: FilterActions = useMemo(
    () => ({
      onFiltersChange: handleFiltersChange,
      enumValues: enumValuesMap,
    }),
    [handleFiltersChange, enumValuesMap],
  );

  const handleCopyRows = useCallback(
    (rows: Record<string, any>[]) => {
      if (rows.length === 0) return;

      const headers = Object.keys(rows[0]);
      const headerLine = headers.join("\t");
      const dataLines = rows.map((row) =>
        headers
          .map((h) => {
            const val = row[h];
            if (val === null || val === undefined) return "";
            if (typeof val === "object") return JSON.stringify(val);
            return String(val);
          })
          .join("\t"),
      );

      const tsv = [headerLine, ...dataLines].join("\n");
      navigator.clipboard.writeText(tsv).then(() => {
        toast.success(
          `Copied ${rows.length} row${
            rows.length !== 1 ? "s" : ""
          } to clipboard`,
        );
      });
    },
    [toast],
  );

  const handleDeleteRowsRequest = useCallback((rows: Record<string, any>[]) => {
    setDeleteConfirm({ isOpen: true, rows });
  }, []);

  const handleDeleteRowsConfirm = useCallback(async () => {
    toast.info(
      `Delete ${deleteConfirm.rows.length} row${
        deleteConfirm.rows.length !== 1 ? "s" : ""
      } - Not yet implemented`,
    );
    setDeleteConfirm({ isOpen: false, rows: [] });
  }, [deleteConfirm.rows, toast]);

  const handleDeleteRowsCancel = useCallback(() => {
    setDeleteConfirm({ isOpen: false, rows: [] });
  }, []);

  const selectionActions: SelectionActions = {
    onCopyRows: handleCopyRows,
    onDeleteRows: handleDeleteRowsRequest,
  };

  const handleCellUpdate = useCallback(
    async (
      row: Record<string, any>,
      columnId: string,
      newValue: string | null,
    ) => {
      let whereClause: string;
      if (primaryKeyColumns.length > 0) {
        whereClause = primaryKeyColumns
          .map((col) => {
            const val = row[col];
            if (val === null || val === undefined) return `"${col}" IS NULL`;
            return `"${col}" = ${formatAsSqlLiteral(val)}`;
          })
          .join(" AND ");
      } else {
        const conditions = columnInfo
          .map((col) => {
            const val = row[col.name];
            if (val === null || val === undefined)
              return `"${col.name}" IS NULL`;
            return `"${col.name}" = ${formatAsSqlLiteral(val)}`;
          })
          .join(" AND ");
        whereClause = `ctid = (SELECT ctid FROM "${tab.schema}"."${tab.tableName}" WHERE ${conditions} LIMIT 1)`;
      }

      const setValue =
        newValue === null ? "NULL" : `'${newValue.replace(/'/g, "''")}'`;
      const query = `UPDATE "${tab.schema}"."${tab.tableName}" SET "${columnId}" = ${setValue} WHERE ${whereClause}`;

      try {
        await invoke("execute_query", { id: connectionId, query });
        toast.success("Cell updated");
        fetchTableData(
          tab.tableName,
          tab.schema,
          pagination.page,
          pagination.pageSize,
          activeFilters,
        );
      } catch (e: any) {
        toast.error(`Update failed: ${e}`);
        throw e;
      }
    },
    [
      connectionId,
      tab,
      primaryKeyColumns,
      columnInfo,
      toast,
      fetchTableData,
      pagination,
      activeFilters,
    ],
  );

  const cellActions: CellActions = {
    onCellUpdate: handleCellUpdate,
  };

  return (
    <>
      <DataTable
        data={tableData}
        columnInfo={columnInfo}
        isLoading={isDataLoading}
        pagination={pagination}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        selectable
        selectionActions={selectionActions}
        cellActions={cellActions}
        tableName={tab.tableName}
        schemaName={tab.schema}
        filterActions={filterActions}
        columnVisibilityKey={`${connectionId}:${tab.schema}:${tab.tableName}`}
      />

      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        title="Delete Rows"
        message={`Are you sure you want to delete ${
          deleteConfirm.rows.length
        } row${
          deleteConfirm.rows.length !== 1 ? "s" : ""
        }? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleDeleteRowsConfirm}
        onCancel={handleDeleteRowsCancel}
      />
    </>
  );
}
