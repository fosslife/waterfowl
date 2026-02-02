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
  Terminal,
} from "lucide-react";
import {
  DataTable,
  PaginationState,
  SelectionActions,
} from "../components/ui/DataTable";
import { TabBar } from "../components/ui/TabBar";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { SchemaSidebar, SchemaObjects } from "../components/SchemaSidebar";
import {
  DatabaseDashboard,
  DatabaseInfo,
} from "../components/DatabaseDashboard";
import { SqlEditorTab } from "../components/SqlEditorTab";
import { useConnections } from "../context/ConnectionsContext";
import { useToast } from "../context/ToastContext";
import { TabProvider, useTabs, TableTab, SqlTab } from "../context/TabContext";
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

// Inner component that uses tab context
function ConnectionWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { connections, refreshConnections } = useConnections();
  const toast = useToast();
  const {
    tabs,
    activeTabId,
    openTab,
    closeTab,
    setActiveTab,
    updateTab,
    getActiveTab,
  } = useTabs();

  // Schema and DB info
  const [schemas, setSchemas] = useState<string[]>([]);
  const [activeSchema, setActiveSchema] = useState<string>("public");
  const [schemaObjects, setSchemaObjects] = useState<SchemaObjects | null>(
    null
  );
  const [dbInfo, setDbInfo] = useState<DatabaseInfo | null>(null);
  const [isSchemaLoading, setIsSchemaLoading] = useState(true);
  const [isDbInfoLoading, setIsDbInfoLoading] = useState(true);

  // Table data (for table tabs)
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
  const activeTab = getActiveTab();

  // Selection action handlers
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

      const schemasData = await invoke<string[]>("get_schemas", { id });
      setSchemas(schemasData);

      const initialSchema = connection?.default_schema || "public";
      const validSchema = schemasData.includes(initialSchema)
        ? initialSchema
        : schemasData[0] || "public";
      setActiveSchema(validSchema);

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
    setTableData([]);
    setColumnInfo([]);
    setPagination((prev) => ({ ...prev, page: 0, totalCount: 0 }));
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
    async (
      tableName: string,
      schema: string,
      page: number,
      pageSize: number
    ) => {
      if (!id) {
        setTableData([]);
        return;
      }

      setIsDataLoading(true);
      try {
        const result = await invoke<PaginatedTableData>("get_table_data", {
          id,
          table: tableName,
          schema: schema,
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
    [id, toast]
  );

  // Fetch data when a table tab becomes active
  useEffect(() => {
    if (!id || !activeTab || activeTab.type !== "table") {
      setTableData([]);
      setPagination((prev) => ({ ...prev, totalCount: 0, page: 0 }));
      return;
    }
    const tableTab = activeTab as TableTab;
    fetchTableData(tableTab.tableName, tableTab.schema, 0, pagination.pageSize);
  }, [id, activeTab?.id]);

  const handlePageChange = (newPage: number) => {
    if (activeTab?.type === "table") {
      const tableTab = activeTab as TableTab;
      fetchTableData(
        tableTab.tableName,
        tableTab.schema,
        newPage,
        pagination.pageSize
      );
    }
  };

  const handlePageSizeChange = (newPageSize: number) => {
    if (activeTab?.type === "table") {
      const tableTab = activeTab as TableTab;
      fetchTableData(tableTab.tableName, tableTab.schema, 0, newPageSize);
    }
  };

  const handleSelectItem = (type: string, name: string) => {
    if (type === "tables") {
      openTab({
        type: "table",
        title: name,
        schema: activeSchema,
        tableName: name,
      });
    }
    // TODO: Handle views, functions, sequences
  };

  const handleOpenSqlEditor = () => {
    openTab({
      type: "sql",
      title: `Query ${tabs.filter((t) => t.type === "sql").length + 1}`,
      queryContent: "",
    });
  };

  const handleCloseConnection = async () => {
    try {
      await invoke("close_connection", { id });
      navigate("/");
    } catch (e: any) {
      console.error(e);
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

  // Get display info for header
  const getHeaderInfo = () => {
    if (!activeTab || activeTab.type === "dashboard") {
      return null;
    }
    if (activeTab.type === "table") {
      return { name: (activeTab as TableTab).tableName, badge: "TABLE" };
    }
    if (activeTab.type === "sql") {
      return { name: activeTab.title, badge: "SQL" };
    }
    return null;
  };

  const headerInfo = getHeaderInfo();

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

        {/* Current tab indicator */}
        {headerInfo && (
          <div className={styles.selectedItemIndicator}>
            <span className={styles.tableName}>{headerInfo.name}</span>
            <span className={styles.tableBadge}>{headerInfo.badge}</span>
          </div>
        )}

        {/* Spacer */}
        <div className={styles.spacer} />

        {/* Actions */}
        <div className={styles.actions}>
          <button
            onClick={handleOpenSqlEditor}
            className={styles.sqlEditorBtn}
            title="Open SQL Editor"
          >
            <Terminal size={14} />
            SQL Editor
          </button>
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

      {/* Tab Bar */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onTabClick={setActiveTab}
        onTabClose={closeTab}
      />

      {/* Body with sidebar */}
      <div className={styles.body}>
        {/* Schema Sidebar */}
        <SchemaSidebar
          schema={schemaObjects}
          isLoading={isSchemaLoading}
          selectedItem={
            activeTab?.type === "table"
              ? { type: "tables", name: (activeTab as TableTab).tableName }
              : null
          }
          onSelectItem={handleSelectItem}
          onRefresh={refreshSchema}
          schemas={schemas}
          activeSchema={activeSchema}
          onSchemaChange={handleSchemaChange}
        />

        {/* Main content panel */}
        <div className={styles.mainPanel}>
          {/* Dashboard tab */}
          {activeTab?.type === "dashboard" && (
            <DatabaseDashboard
              info={dbInfo}
              isLoading={isDbInfoLoading}
              connectionName={connection?.name || "Database"}
              connectionHost={connectionHost}
              onOpenSqlEditor={handleOpenSqlEditor}
            />
          )}

          {/* Table tab */}
          {activeTab?.type === "table" && (
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
          )}

          {/* SQL Editor tab */}
          {activeTab?.type === "sql" && (
            <SqlEditorTab
              connectionId={id!}
              initialQuery={(activeTab as SqlTab).queryContent}
              onQueryChange={(query) =>
                updateTab(activeTab.id, {
                  queryContent: query,
                } as Partial<SqlTab>)
              }
            />
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

// Main component with TabProvider wrapper
export function ConnectionDetails() {
  return (
    <TabProvider>
      <ConnectionWorkspace />
    </TabProvider>
  );
}
