import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Trash2,
  Edit,
  AlertTriangle,
  RefreshCw,
  Database,
  LogOut,
} from "lucide-react";
import {
  DataTable,
  PaginationState,
  SelectionActions,
} from "../components/ui/DataTable";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { SchemaSidebar, SchemaObjects } from "../components/SchemaSidebar";
import {
  DatabaseDashboard,
  DatabaseInfo,
} from "../components/DatabaseDashboard";
import { useConnections } from "../context/ConnectionsContext";
import { useToast } from "../context/ToastContext";
import styles from "./ConnectionDetails.module.css";

interface ColumnInfo {
  name: string;
  pg_type: string;
}

interface PaginatedTableData {
  rows: Record<string, any>[];
  total_count: number;
  columns: ColumnInfo[];
}

const DEFAULT_PAGE_SIZE = 100;

export function ConnectionDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { connections, refreshConnections } = useConnections();
  const toast = useToast();

  // Schema and DB info
  const [schemas, setSchemas] = useState<string[]>([]);
  const [activeSchema, setActiveSchema] = useState<string>("public");
  const [schemaObjects, setSchemaObjects] = useState<SchemaObjects | null>(
    null
  );
  const [dbInfo, setDbInfo] = useState<DatabaseInfo | null>(null);
  const [isSchemaLoading, setIsSchemaLoading] = useState(true);
  const [isDbInfoLoading, setIsDbInfoLoading] = useState(true);

  // Selection state
  const [selectedItem, setSelectedItem] = useState<{
    type: string;
    name: string;
  } | null>(null);
  const [tableData, setTableData] = useState<any[]>([]);
  const [columnInfo, setColumnInfo] = useState<ColumnInfo[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(false);

  // Pagination state
  const [pagination, setPagination] = useState<PaginationState>({
    page: 0,
    pageSize: DEFAULT_PAGE_SIZE,
    totalCount: 0,
  });

  // UI state
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  // Row delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    rows: Record<string, any>[];
  }>({ isOpen: false, rows: [] });

  const connection = connections.find((c) => c.id === id);

  // Selection action handlers
  const handleCopyRows = useCallback(
    (rows: Record<string, any>[]) => {
      // Format rows as tab-separated values (TSV) for spreadsheet compatibility
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
          .join("\t")
      );

      const tsv = [headerLine, ...dataLines].join("\n");
      navigator.clipboard.writeText(tsv).then(() => {
        toast.success(
          `Copied ${rows.length} row${
            rows.length !== 1 ? "s" : ""
          } to clipboard`
        );
      });
    },
    [toast]
  );

  const handleDeleteRowsRequest = useCallback((rows: Record<string, any>[]) => {
    setDeleteConfirm({ isOpen: true, rows });
  }, []);

  const handleDeleteRowsConfirm = useCallback(async () => {
    // TODO: Implement actual row deletion via backend
    // For now, just show a placeholder message
    toast.info(
      `Delete ${deleteConfirm.rows.length} row${
        deleteConfirm.rows.length !== 1 ? "s" : ""
      } - Not yet implemented`
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

  const initConnection = async () => {
    if (!id) return;
    setIsSchemaLoading(true);
    setIsDbInfoLoading(true);
    setError(null);

    try {
      await invoke("establish_connection", { id });

      // Fetch available schemas first
      const schemasData = await invoke<string[]>("get_schemas", { id });
      setSchemas(schemasData);

      // Determine initial schema (from connection config or default to public)
      const initialSchema = connection?.default_schema || "public";
      // If the configured schema doesn't exist, fall back to first available or public
      const validSchema = schemasData.includes(initialSchema)
        ? initialSchema
        : schemasData[0] || "public";
      setActiveSchema(validSchema);

      // Fetch schema objects and database info in parallel
      const [schemaData, dbInfoData] = await Promise.all([
        invoke<SchemaObjects>("get_schema_objects", {
          id,
          schema: validSchema,
        }),
        invoke<DatabaseInfo>("get_database_info", { id, schema: validSchema }),
      ]);

      setSchemaObjects(schemaData);
      setDbInfo(dbInfoData);
    } catch (e: any) {
      console.error(e);
      setError(e.toString());
    } finally {
      setIsSchemaLoading(false);
      setIsDbInfoLoading(false);
      setIsRetrying(false);
    }
  };

  const refreshSchema = async () => {
    if (!id) return;
    setIsSchemaLoading(true);
    try {
      const [schemaData, dbInfoData] = await Promise.all([
        invoke<SchemaObjects>("get_schema_objects", {
          id,
          schema: activeSchema,
        }),
        invoke<DatabaseInfo>("get_database_info", { id, schema: activeSchema }),
      ]);
      setSchemaObjects(schemaData);
      setDbInfo(dbInfoData);
    } catch (e: any) {
      console.error(e);
      toast.error("Failed to refresh schema");
    } finally {
      setIsSchemaLoading(false);
    }
  };

  const handleSchemaChange = async (newSchema: string) => {
    if (!id || newSchema === activeSchema) return;
    setActiveSchema(newSchema);
    setSelectedItem(null); // Clear selection when switching schemas
    setTableData([]);
    setColumnInfo([]);
    setPagination((prev) => ({ ...prev, page: 0, totalCount: 0 })); // Reset pagination
    setIsSchemaLoading(true);
    setIsDbInfoLoading(true);

    try {
      const [schemaData, dbInfoData] = await Promise.all([
        invoke<SchemaObjects>("get_schema_objects", { id, schema: newSchema }),
        invoke<DatabaseInfo>("get_database_info", { id, schema: newSchema }),
      ]);
      setSchemaObjects(schemaData);
      setDbInfo(dbInfoData);
    } catch (e: any) {
      console.error(e);
      toast.error(`Failed to load schema: ${e}`);
    } finally {
      setIsSchemaLoading(false);
      setIsDbInfoLoading(false);
    }
  };

  useEffect(() => {
    initConnection();
  }, [id]);

  // Fetch table data with pagination
  const fetchTableData = useCallback(
    async (page: number, pageSize: number) => {
      if (!id || !selectedItem || selectedItem.type !== "tables") {
        setTableData([]);
        return;
      }

      setIsDataLoading(true);
      try {
        const result = await invoke<PaginatedTableData>("get_table_data", {
          id,
          table: selectedItem.name,
          schema: activeSchema,
          limit: pageSize,
          offset: page * pageSize,
        });
        setTableData(result.rows);
        setColumnInfo(result.columns || []);
        setPagination((prev) => ({
          ...prev,
          page,
          pageSize,
          totalCount: result.total_count,
        }));
      } catch (e: any) {
        console.error(e);
        toast.error(`Failed to load table data: ${e}`);
      } finally {
        setIsDataLoading(false);
      }
    },
    [id, selectedItem, activeSchema, toast]
  );

  // Fetch data when a table is selected
  useEffect(() => {
    if (!id || !selectedItem || selectedItem.type !== "tables") {
      setTableData([]);
      setPagination((prev) => ({ ...prev, totalCount: 0, page: 0 }));
      return;
    }
    // Reset to first page when table changes
    fetchTableData(0, pagination.pageSize);
  }, [id, selectedItem, activeSchema]);

  const handlePageChange = (newPage: number) => {
    fetchTableData(newPage, pagination.pageSize);
  };

  const handlePageSizeChange = (newPageSize: number) => {
    // Reset to first page when page size changes
    fetchTableData(0, newPageSize);
  };

  const handleSelectItem = (type: string, name: string) => {
    setSelectedItem({ type, name });
  };

  const handleCloseConnection = async () => {
    try {
      await invoke("close_connection", { id });
      navigate("/");
    } catch (e: any) {
      console.error(e);
      // Navigate anyway even if close fails
      navigate("/");
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this connection?")) return;
    setIsDeleting(true);
    try {
      await invoke("delete_connection", { id });
      await refreshConnections();
      toast.success("Connection deleted");
      navigate("/");
    } catch (e: any) {
      console.error(e);
      toast.error(`Failed to delete connection: ${e}`);
      setIsDeleting(false);
    }
  };

  const handleRetry = () => {
    setIsRetrying(true);
    initConnection();
  };

  if (error) {
    return (
      <div className={styles.errorContainer}>
        <div className={styles.errorCard}>
          <div className={styles.errorHeader}>
            <div className={styles.errorIconWrapper}>
              <AlertTriangle size={20} className={styles.errorIcon} />
            </div>
            <div>
              <h2 className={styles.errorTitle}>Connection Failed</h2>
              <p className={styles.errorSubtitle}>
                Unable to establish database connection
              </p>
            </div>
          </div>
          <div className={styles.errorMessage}>
            <p className={styles.errorText}>{error}</p>
          </div>
          <div className={styles.errorActions}>
            <Button
              variant="secondary"
              onClick={handleRetry}
              isLoading={isRetrying}
              className={styles.errorActionBtn}
            >
              <RefreshCw size={14} /> Retry
            </Button>
            <Button
              variant="ghost"
              onClick={() => navigate(`/edit-connection/${id}`)}
              className={styles.errorActionBtn}
            >
              <Edit size={14} /> Edit
            </Button>
            <Button
              variant="danger"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const connectionHost = connection
    ? `${connection.host}:${connection.port}/${connection.database}`
    : "";

  return (
    <div className={styles.page}>
      {/* Header Bar */}
      <header className={styles.header}>
        {/* Connection info */}
        <div className={styles.connectionInfo}>
          <div className={styles.connectionIconWrapper}>
            <Database size={14} className={styles.connectionIcon} />
          </div>
          <div>
            <div className={styles.connectionName}>
              {connection?.name || "Connection"}
            </div>
            <div className={styles.connectionHost}>{connectionHost}</div>
          </div>
        </div>

        {/* Divider */}
        <div className={styles.divider} />

        {/* Selected item indicator */}
        {selectedItem && selectedItem.type === "tables" && (
          <>
            <span className={styles.tableName}>{selectedItem.name}</span>
            <span className={styles.tableBadge}>TABLE</span>
          </>
        )}
        {selectedItem && selectedItem.type === "views" && (
          <>
            <span className={styles.tableName}>{selectedItem.name}</span>
            <span className={styles.tableBadge}>VIEW</span>
          </>
        )}

        {/* Spacer */}
        <div className={styles.spacer} />

        {/* Actions */}
        <div className={styles.actions}>
          <button
            onClick={handleCloseConnection}
            className={styles.closeBtn}
            title="Close Connection"
          >
            <LogOut size={14} />
            Close
          </button>
          <button
            onClick={() => navigate(`/edit-connection/${id}`)}
            title="Edit Connection"
            className={styles.actionBtn}
          >
            <Edit size={16} />
          </button>
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            title="Delete Connection"
            className={styles.actionBtn}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      {/* Body with sidebar */}
      <div className={styles.body}>
        {/* Schema Sidebar */}
        <SchemaSidebar
          schema={schemaObjects}
          isLoading={isSchemaLoading}
          selectedItem={selectedItem}
          onSelectItem={handleSelectItem}
          onRefresh={refreshSchema}
          schemas={schemas}
          activeSchema={activeSchema}
          onSchemaChange={handleSchemaChange}
        />

        {/* Main content panel */}
        <div className={styles.mainPanel}>
          {!selectedItem ? (
            // Dashboard when nothing selected
            <DatabaseDashboard
              info={dbInfo}
              isLoading={isDbInfoLoading}
              connectionName={connection?.name || "Database"}
              connectionHost={connectionHost}
              onOpenSqlEditor={() => navigate(`/connection/${id}/sql`)}
            />
          ) : selectedItem.type === "tables" ? (
            // Table data view
            <div className={styles.tableView}>
              <div className={styles.tableContent}>
                <DataTable
                  data={tableData}
                  columnInfo={columnInfo}
                  isLoading={isDataLoading}
                  pagination={pagination}
                  onPageChange={handlePageChange}
                  onPageSizeChange={handlePageSizeChange}
                  selectable
                  selectionActions={selectionActions}
                />
              </div>
            </div>
          ) : (
            // Placeholder for views, functions, sequences
            <div className={styles.emptyState}>
              <div className={styles.emptyIconWrapper}>
                <Database size={36} className={styles.emptyIcon} />
              </div>
              <h2 className={styles.emptyTitle}>
                {selectedItem.type === "views" && "View Details"}
                {selectedItem.type === "functions" && "Function Details"}
                {selectedItem.type === "sequences" && "Sequence Details"}
              </h2>
              <p className={styles.emptySubtitle}>
                {selectedItem.type === "views" &&
                  "View inspection coming soon. Select a table to view data."}
                {selectedItem.type === "functions" &&
                  "Function inspection coming soon. Select a table to view data."}
                {selectedItem.type === "sequences" &&
                  "Sequence inspection coming soon. Select a table to view data."}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation dialog */}
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
    </div>
  );
}
