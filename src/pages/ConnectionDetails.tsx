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
} from "lucide-react";
import { DataTable } from "../components/ui/DataTable";
import { Button } from "../components/ui/Button";
import { SchemaSidebar, SchemaObjects } from "../components/SchemaSidebar";
import {
  DatabaseDashboard,
  DatabaseInfo,
} from "../components/DatabaseDashboard";
import { useConnections } from "../context/ConnectionsContext";
import { useToast } from "../context/ToastContext";
import styles from "./ConnectionDetails.module.css";

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
  const [isDataLoading, setIsDataLoading] = useState(false);

  // UI state
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const connection = connections.find((c) => c.id === id);

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

  // Fetch data when a table is selected
  useEffect(() => {
    async function fetchData() {
      if (!id || !selectedItem || selectedItem.type !== "tables") {
        setTableData([]);
        return;
      }

      setIsDataLoading(true);
      try {
        const data = await invoke<any[]>("get_table_data", {
          id,
          table: selectedItem.name,
          schema: activeSchema,
        });
        setTableData(data);
      } catch (e: any) {
        console.error(e);
        toast.error(`Failed to load table data: ${e}`);
      } finally {
        setIsDataLoading(false);
      }
    }
    fetchData();
  }, [id, selectedItem, activeSchema]);

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
            />
          ) : selectedItem.type === "tables" ? (
            // Table data view
            <div className={styles.tableView}>
              <div className={styles.tableHeader}>
                <span className={styles.tableName}>{selectedItem.name}</span>
                <span className={styles.tableBadge}>LIMIT 100</span>
              </div>
              <div className={styles.tableContent}>
                <DataTable data={tableData} isLoading={isDataLoading} />
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
    </div>
  );
}
