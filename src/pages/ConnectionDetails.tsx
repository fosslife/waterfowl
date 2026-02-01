import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Table,
  Search,
  Trash2,
  Edit,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  Database,
  Loader2,
  X,
} from "lucide-react";
import { DataTable } from "../components/ui/DataTable";
import { Button } from "../components/ui/Button";
import { useConnections } from "../context/ConnectionsContext";
import { useToast } from "../context/ToastContext";
import styles from "./ConnectionDetails.module.css";

export function ConnectionDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { connections, refreshConnections } = useConnections();
  const toast = useToast();
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableData, setTableData] = useState<any[]>([]);
  const [isSchemaLoading, setIsSchemaLoading] = useState(true);
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isTableDropdownOpen, setIsTableDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const connection = connections.find((c) => c.id === id);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsTableDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const initConnection = async () => {
    if (!id) return;
    setIsSchemaLoading(true);
    setError(null);
    try {
      await invoke("establish_connection", { id });
      const tablesList = await invoke<string[]>("get_tables", { id });
      setTables(tablesList);
    } catch (e: any) {
      console.error(e);
      setError(e.toString());
    } finally {
      setIsSchemaLoading(false);
      setIsRetrying(false);
    }
  };

  useEffect(() => {
    initConnection();
  }, [id]);

  useEffect(() => {
    async function fetchData() {
      if (!id || !selectedTable) return;
      setIsDataLoading(true);
      try {
        const data = await invoke<any[]>("get_table_data", {
          id,
          table: selectedTable,
        });
        setTableData(data);
      } catch (e: any) {
        console.error(e);
      } finally {
        setIsDataLoading(false);
      }
    }
    fetchData();
  }, [id, selectedTable]);

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

  const filteredTables = tables.filter((t) =>
    t.toLowerCase().includes(filter.toLowerCase())
  );

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
            <div className={styles.connectionHost}>
              {connection?.host}:{connection?.port}/{connection?.database}
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className={styles.divider} />

        {/* Table selector dropdown */}
        <div ref={dropdownRef} className={styles.dropdownWrapper}>
          <button
            onClick={() => setIsTableDropdownOpen(!isTableDropdownOpen)}
            disabled={isSchemaLoading}
            className={styles.dropdownTrigger}
            data-has-selection={!!selectedTable}
          >
            <span className={styles.dropdownTriggerContent}>
              {isSchemaLoading ? (
                <Loader2 size={14} className={styles.spinner} />
              ) : (
                <Table size={14} />
              )}
              {isSchemaLoading ? "Loading..." : selectedTable || "Select table"}
            </span>
            <ChevronDown
              size={14}
              className={styles.dropdownChevron}
              data-open={isTableDropdownOpen}
            />
          </button>

          {/* Dropdown menu */}
          {isTableDropdownOpen && (
            <div className={styles.dropdownMenu}>
              {/* Search */}
              <div className={styles.dropdownSearch}>
                <div className={styles.searchInputWrapper}>
                  <Search size={14} className={styles.searchIcon} />
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Search tables..."
                    autoFocus
                    className={styles.searchInput}
                  />
                  {filter && (
                    <button
                      onClick={() => setFilter("")}
                      className={styles.searchClear}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>

              {/* Table list */}
              <div className={styles.dropdownList}>
                {filteredTables.length === 0 ? (
                  <div className={styles.dropdownEmpty}>No tables found</div>
                ) : (
                  filteredTables.map((table) => (
                    <button
                      key={table}
                      onClick={() => {
                        setSelectedTable(table);
                        setIsTableDropdownOpen(false);
                        setFilter("");
                      }}
                      className={styles.dropdownItem}
                      data-selected={selectedTable === table}
                    >
                      <Table size={14} className={styles.dropdownItemIcon} />
                      <span className={styles.dropdownItemText}>{table}</span>
                    </button>
                  ))
                )}
              </div>

              {/* Footer with count */}
              <div className={styles.dropdownFooter}>
                {tables.length} tables
              </div>
            </div>
          )}
        </div>

        {/* Spacer */}
        <div className={styles.spacer} />

        {/* Actions */}
        <div className={styles.actions}>
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

      {/* Main content */}
      <main className={styles.main}>
        {!selectedTable ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIconWrapper}>
              <Table size={36} className={styles.emptyIcon} />
            </div>
            <h2 className={styles.emptyTitle}>Select a Table</h2>
            <p className={styles.emptySubtitle}>
              Choose a table from the dropdown above to view and explore its
              data.
            </p>
            {tables.length > 0 && (
              <div className={styles.quickTables}>
                {tables.slice(0, 5).map((table) => (
                  <button
                    key={table}
                    onClick={() => setSelectedTable(table)}
                    className={styles.quickTableBtn}
                  >
                    {table}
                  </button>
                ))}
                {tables.length > 5 && (
                  <span className={styles.quickTableMore}>
                    +{tables.length - 5} more
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className={styles.tableView}>
            {/* Table header bar */}
            <div className={styles.tableHeader}>
              <span className={styles.tableName}>{selectedTable}</span>
              <span className={styles.tableBadge}>LIMIT 100</span>
            </div>
            {/* Data table with padding */}
            <div className={styles.tableContent}>
              <DataTable data={tableData} isLoading={isDataLoading} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
