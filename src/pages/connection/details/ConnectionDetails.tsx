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
  CellActions,
  formatAsSqlLiteral,
} from "@components/ui/data-table/DataTable";
import { TabBar } from "@components/ui/tabs/TabBar";
import { Button } from "@components/ui/button/Button";
import { ConfirmDialog } from "@components/ui/dialog/ConfirmDialog";
import { SchemaSidebar, SchemaObjects } from "@components/SchemaSidebar";
import { DatabaseDashboard, DatabaseInfo } from "@components/DatabaseDashboard";
import { SqlEditorTab } from "@components/SqlEditorTab";
import { useConnections } from "@context/ConnectionsContext";
import { useToast } from "@context/ToastContext";
import {
  recordConnectionUsage,
  deleteConnection,
  getConnection,
} from "@services/connections";
import {
  TabProvider,
  useTabs,
  TableTab,
  ViewTab,
  FunctionTab,
  SequenceTab,
  SqlTab,
} from "@context/TabContext";
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

interface TableColumn {
  name: string;
  data_type: string;
  is_nullable: boolean;
  default_value: string | null;
  is_primary_key: boolean;
  is_unique: boolean;
  foreign_key: string | null;
}

interface TableStructure {
  name: string;
  schema: string;
  columns: TableColumn[];
  indexes: any[];
  row_count: number;
  size: string;
  description: string | null;
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
    null,
  );
  const [dbInfo, setDbInfo] = useState<DatabaseInfo | null>(null);
  const [isSchemaLoading, setIsSchemaLoading] = useState(true);
  const [isDbInfoLoading, setIsDbInfoLoading] = useState(true);

  // Table data (for table tabs)
  const [tableData, setTableData] = useState<any[]>([]);
  const [columnInfo, setColumnInfo] = useState<ColumnInfo[]>([]);
  const [primaryKeyColumns, setPrimaryKeyColumns] = useState<string[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(false);

  // View data (for view tabs)
  const [viewData, setViewData] = useState<any[]>([]);
  const [viewColumnInfo, setViewColumnInfo] = useState<ColumnInfo[]>([]);
  const [isViewLoading, setIsViewLoading] = useState(false);
  const [viewPagination, setViewPagination] = useState<PaginationState>({
    page: 0,
    pageSize: DEFAULT_PAGE_SIZE,
    totalCount: 0,
  });

  // Function definition (for function tabs)
  const [functionDefinition, setFunctionDefinition] = useState<string>("");
  const [functionMetadata, setFunctionMetadata] = useState<Record<
    string,
    any
  > | null>(null);
  const [isFunctionLoading, setIsFunctionLoading] = useState(false);

  // Sequence info (for sequence tabs)
  const [sequenceInfo, setSequenceInfo] = useState<Record<string, any> | null>(
    null,
  );
  const [isSequenceLoading, setIsSequenceLoading] = useState(false);

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

  // Fetch table data with pagination
  const fetchTableData = useCallback(
    async (
      tableName: string,
      schema: string,
      page: number,
      pageSize: number,
    ) => {
      if (!id) {
        setTableData([]);
        return;
      }

      setIsDataLoading(true);
      try {
        const [result, structure] = await Promise.all([
          invoke<PaginatedTableData>("get_table_data", {
            id,
            table: tableName,
            schema: schema,
            limit: pageSize,
            offset: page * pageSize,
          }),
          page === 0
            ? invoke<TableStructure>("get_table_structure", {
                id,
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
    [id, toast],
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
      if (!id || !activeTab || activeTab.type !== "table") return;
      const tableTab = activeTab as TableTab;

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
        whereClause = `ctid = (SELECT ctid FROM "${tableTab.schema}"."${tableTab.tableName}" WHERE ${conditions} LIMIT 1)`;
      }

      const setValue =
        newValue === null ? "NULL" : `'${newValue.replace(/'/g, "''")}'`;
      const query = `UPDATE "${tableTab.schema}"."${tableTab.tableName}" SET "${columnId}" = ${setValue} WHERE ${whereClause}`;

      try {
        await invoke("execute_query", { id, query });
        toast.success("Cell updated");
        fetchTableData(
          tableTab.tableName,
          tableTab.schema,
          pagination.page,
          pagination.pageSize,
        );
      } catch (e: any) {
        toast.error(`Update failed: ${e}`);
        throw e;
      }
    },
    [
      id,
      activeTab,
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

  const initConnection = async () => {
    if (!id) return;
    setIsSchemaLoading(true);
    setIsDbInfoLoading(true);
    setError(null);

    try {
      // Fetch full connection config from SQLite (includes password)
      const connConfig = await getConnection(id);
      if (!connConfig) {
        throw new Error("Connection not found");
      }

      // Convert to Rust-expected format and establish connection
      await invoke("establish_connection", {
        id,
        connection: {
          id: connConfig.id,
          name: connConfig.name,
          host: connConfig.host,
          port: connConfig.port,
          user: connConfig.username,
          password: connConfig.password,
          database: connConfig.database_name,
          driver: connConfig.driver,
          default_schema: connConfig.default_schema,
        },
      });

      // Track this connection as recently used
      recordConnectionUsage(id).catch(console.error);

      const schemasData = await invoke<string[]>("get_schemas", { id });
      setSchemas(schemasData);

      const initialSchema = connConfig.default_schema || "public";
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

  // Fetch view data with pagination
  const fetchViewData = useCallback(
    async (
      viewName: string,
      schema: string,
      page: number,
      pageSize: number,
    ) => {
      if (!id) {
        setViewData([]);
        return;
      }

      setIsViewLoading(true);
      try {
        const result = await invoke<PaginatedTableData>("get_view_data", {
          id,
          view: viewName,
          schema: schema,
          limit: pageSize,
          offset: page * pageSize,
        });
        setViewData(result.rows);
        setViewColumnInfo(result.columns || []);
        setViewPagination((prev) => ({
          ...prev,
          page,
          pageSize,
          totalCount: result.total_count,
        }));
      } catch (e: any) {
        console.error(e);
        toast.error(`Failed to load view data: ${e}`);
      } finally {
        setIsViewLoading(false);
      }
    },
    [id, toast],
  );

  // Fetch function info
  const fetchFunctionInfo = useCallback(
    async (functionName: string, schema: string) => {
      if (!id) {
        setFunctionDefinition("");
        setFunctionMetadata(null);
        return;
      }

      setIsFunctionLoading(true);
      try {
        const result = await invoke<Record<string, any>>("get_function_info", {
          id,
          functionName: functionName,
          schema: schema,
        });
        setFunctionDefinition(result.definition || "");
        setFunctionMetadata(result);
      } catch (e: any) {
        console.error(e);
        toast.error(`Failed to load function info: ${e}`);
      } finally {
        setIsFunctionLoading(false);
      }
    },
    [id, toast],
  );

  // Fetch sequence info
  const fetchSequenceInfo = useCallback(
    async (sequenceName: string, schema: string) => {
      if (!id) {
        setSequenceInfo(null);
        return;
      }

      setIsSequenceLoading(true);
      try {
        const result = await invoke<Record<string, any>>("get_sequence_info", {
          id,
          sequenceName: sequenceName,
          schema: schema,
        });
        setSequenceInfo(result);
      } catch (e: any) {
        console.error(e);
        toast.error(`Failed to load sequence info: ${e}`);
      } finally {
        setIsSequenceLoading(false);
      }
    },
    [id, toast],
  );

  // Fetch data when a table tab becomes active
  useEffect(() => {
    if (!id || !activeTab) {
      setTableData([]);
      setViewData([]);
      setPagination((prev) => ({ ...prev, totalCount: 0, page: 0 }));
      setViewPagination((prev) => ({ ...prev, totalCount: 0, page: 0 }));
      return;
    }

    if (activeTab.type === "table") {
      const tableTab = activeTab as TableTab;
      fetchTableData(
        tableTab.tableName,
        tableTab.schema,
        0,
        pagination.pageSize,
      );
    } else if (activeTab.type === "view") {
      const viewTab = activeTab as ViewTab;
      fetchViewData(
        viewTab.viewName,
        viewTab.schema,
        0,
        viewPagination.pageSize,
      );
    } else if (activeTab.type === "function") {
      const funcTab = activeTab as FunctionTab;
      fetchFunctionInfo(funcTab.functionName, funcTab.schema);
    } else if (activeTab.type === "sequence") {
      const seqTab = activeTab as SequenceTab;
      fetchSequenceInfo(seqTab.sequenceName, seqTab.schema);
    }
  }, [id, activeTab?.id]);

  const handlePageChange = (newPage: number) => {
    if (activeTab?.type === "table") {
      const tableTab = activeTab as TableTab;
      fetchTableData(
        tableTab.tableName,
        tableTab.schema,
        newPage,
        pagination.pageSize,
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
    } else if (type === "views") {
      openTab({
        type: "view",
        title: name,
        schema: activeSchema,
        viewName: name,
      });
    } else if (type === "functions") {
      openTab({
        type: "function",
        title: name,
        schema: activeSchema,
        functionName: name,
      });
    } else if (type === "sequences") {
      openTab({
        type: "sequence",
        title: name,
        schema: activeSchema,
        sequenceName: name,
      });
    }
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
      // Close the active connection first
      await invoke("close_connection", { id });
      // Delete from SQLite storage
      await deleteConnection(id!);
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
              onClick={() => navigate(`/connection/edit/${id}`)}
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
            onClick={() => navigate(`/connection/edit/${id}`)}
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
              : activeTab?.type === "view"
                ? { type: "views", name: (activeTab as ViewTab).viewName }
                : activeTab?.type === "function"
                  ? {
                      type: "functions",
                      name: (activeTab as FunctionTab).functionName,
                    }
                  : activeTab?.type === "sequence"
                    ? {
                        type: "sequences",
                        name: (activeTab as SequenceTab).sequenceName,
                      }
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
                  cellActions={cellActions}
                  tableName={(activeTab as TableTab).tableName}
                  schemaName={(activeTab as TableTab).schema}
                />
              </div>
            </div>
          )}

          {/* View tab - read-only data display */}
          {activeTab?.type === "view" && (
            <div className={styles.tableView}>
              <div className={styles.viewHeader}>
                <span className={styles.viewBadge}>Read-Only View</span>
              </div>
              <div className={styles.tableContent}>
                <DataTable
                  data={viewData}
                  columnInfo={viewColumnInfo}
                  isLoading={isViewLoading}
                  pagination={viewPagination}
                  onPageChange={(newPage) => {
                    const viewTab = activeTab as ViewTab;
                    fetchViewData(
                      viewTab.viewName,
                      viewTab.schema,
                      newPage,
                      viewPagination.pageSize,
                    );
                  }}
                  onPageSizeChange={(newPageSize) => {
                    const viewTab = activeTab as ViewTab;
                    fetchViewData(
                      viewTab.viewName,
                      viewTab.schema,
                      0,
                      newPageSize,
                    );
                  }}
                />
              </div>
            </div>
          )}

          {/* Function tab */}
          {activeTab?.type === "function" && (
            <div className={styles.functionView}>
              {isFunctionLoading ? (
                <div className={styles.loadingContainer}>
                  <div className={styles.spinner} />
                  <p>Loading function definition...</p>
                </div>
              ) : (
                <>
                  {functionMetadata && (
                    <div className={styles.functionMeta}>
                      <h3>Function Details</h3>
                      <div className={styles.metaGrid}>
                        <div className={styles.metaItem}>
                          <span className={styles.metaLabel}>Language:</span>
                          <span className={styles.metaValue}>
                            {functionMetadata.language}
                          </span>
                        </div>
                        <div className={styles.metaItem}>
                          <span className={styles.metaLabel}>Return Type:</span>
                          <span className={styles.metaValue}>
                            {functionMetadata.return_type}
                          </span>
                        </div>
                        <div className={styles.metaItem}>
                          <span className={styles.metaLabel}>Arguments:</span>
                          <span className={styles.metaValue}>
                            {functionMetadata.arguments || "None"}
                          </span>
                        </div>
                        <div className={styles.metaItem}>
                          <span className={styles.metaLabel}>Volatility:</span>
                          <span className={styles.metaValue}>
                            {functionMetadata.volatility}
                          </span>
                        </div>
                        <div className={styles.metaItem}>
                          <span className={styles.metaLabel}>Strict:</span>
                          <span className={styles.metaValue}>
                            {functionMetadata.is_strict ? "Yes" : "No"}
                          </span>
                        </div>
                        {functionMetadata.description && (
                          <div
                            className={`${styles.metaItem} ${styles.fullWidth}`}
                          >
                            <span className={styles.metaLabel}>
                              Description:
                            </span>
                            <span className={styles.metaValue}>
                              {functionMetadata.description}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  <div className={styles.functionCode}>
                    <h3>Definition</h3>
                    <pre className={styles.codeBlock}>
                      <code>
                        {functionDefinition || "No definition available"}
                      </code>
                    </pre>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Sequence tab */}
          {activeTab?.type === "sequence" && (
            <div className={styles.sequenceView}>
              {isSequenceLoading ? (
                <div className={styles.loadingContainer}>
                  <div className={styles.spinner} />
                  <p>Loading sequence info...</p>
                </div>
              ) : sequenceInfo ? (
                <div className={styles.sequenceInfo}>
                  <h3>Sequence Properties</h3>
                  <div className={styles.metaGrid}>
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>Name:</span>
                      <span className={styles.metaValue}>
                        {sequenceInfo.name}
                      </span>
                    </div>
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>Schema:</span>
                      <span className={styles.metaValue}>
                        {sequenceInfo.schema}
                      </span>
                    </div>
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>Data Type:</span>
                      <span className={styles.metaValue}>
                        {sequenceInfo.data_type}
                      </span>
                    </div>
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>Current Value:</span>
                      <span
                        className={`${styles.metaValue} ${styles.highlight}`}
                      >
                        {sequenceInfo.current_value?.toLocaleString()}
                      </span>
                    </div>
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>Start Value:</span>
                      <span className={styles.metaValue}>
                        {sequenceInfo.start_value?.toLocaleString()}
                      </span>
                    </div>
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>Increment:</span>
                      <span className={styles.metaValue}>
                        {sequenceInfo.increment?.toLocaleString()}
                      </span>
                    </div>
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>Min Value:</span>
                      <span className={styles.metaValue}>
                        {sequenceInfo.min_value?.toLocaleString()}
                      </span>
                    </div>
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>Max Value:</span>
                      <span className={styles.metaValue}>
                        {sequenceInfo.max_value?.toLocaleString()}
                      </span>
                    </div>
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>Cycle:</span>
                      <span className={styles.metaValue}>
                        {sequenceInfo.cycle ? "Yes" : "No"}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className={styles.emptyState}>
                  <p>No sequence information available</p>
                </div>
              )}
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
