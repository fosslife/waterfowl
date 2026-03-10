import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DataTable,
  PaginationState,
  SelectionActions,
  CellActions,
} from "@components/ui/data-table/DataTable";
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

  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    rows: Record<string, any>[];
  }>({ isOpen: false, rows: [] });

  const fetchTableData = useCallback(
    async (
      tableName: string,
      schema: string,
      page: number,
      pageSize: number,
    ) => {
      setIsDataLoading(true);
      try {
        const [result, structure] = await Promise.all([
          invoke<PaginatedTableData>("get_table_data", {
            id: connectionId,
            table: tableName,
            schema: schema,
            limit: pageSize,
            offset: page * pageSize,
          }),
          page === 0
            ? invoke<TableStructure>("get_table_structure", {
                id: connectionId,
                table: tableName,
                schema: schema,
              })
            : null,
        ]);
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
        console.error(e);
        toast.error(`Failed to load table data: ${e}`);
      } finally {
        setIsDataLoading(false);
      }
    },
    [connectionId, toast],
  );

  useEffect(() => {
    fetchTableData(tab.tableName, tab.schema, 0, pagination.pageSize);
  }, [connectionId, tab.tableName, tab.schema, fetchTableData]); // Depend on tab explicitly, omitting pagination.pageSize from exhaustive deps or fetching on mount only

  const handlePageChange = (newPage: number) => {
    fetchTableData(tab.tableName, tab.schema, newPage, pagination.pageSize);
  };

  const handlePageSizeChange = (newPageSize: number) => {
    fetchTableData(tab.tableName, tab.schema, 0, newPageSize);
  };

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
