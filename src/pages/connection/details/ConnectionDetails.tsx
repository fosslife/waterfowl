import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
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
import { TabBar } from "@components/ui/tabs/TabBar";
import { Button } from "@components/ui/button/Button";
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

// Import Panels
import { TablePanel } from "./TablePanel";
import { ViewPanel } from "./ViewPanel";
import { FunctionPanel } from "./FunctionPanel";
import { SequencePanel } from "./SequencePanel";

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

  // UI state
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const connection = connections.find((c) => c.id === id);
  const activeTab = getActiveTab();

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
                <TablePanel connectionId={id!} tab={activeTab as TableTab} />
              </div>
            </div>
          )}

          {/* View tab - read-only data display */}
          {activeTab?.type === "view" && (
            <div className={styles.tableView}>
              <div className={styles.tableContent}>
                <ViewPanel connectionId={id!} tab={activeTab as ViewTab} />
              </div>
            </div>
          )}

          {/* Function tab */}
          {activeTab?.type === "function" && (
            <div className={styles.functionView}>
              <FunctionPanel connectionId={id!} tab={activeTab as FunctionTab} />
            </div>
          )}

          {/* Sequence tab */}
          {activeTab?.type === "sequence" && (
            <div className={styles.sequenceView}>
              <SequencePanel connectionId={id!} tab={activeTab as SequenceTab} />
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
