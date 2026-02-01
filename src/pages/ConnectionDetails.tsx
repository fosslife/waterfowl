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
import clsx from "clsx";

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
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 48,
        }}
      >
        <div
          style={{
            maxWidth: 480,
            width: "100%",
            padding: 32,
            background: "var(--color-base-100)",
            borderRadius: 8,
            border: "1px solid var(--color-accent-secondary)",
            boxShadow: "0 0 30px rgba(255, 0, 85, 0.1)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 20,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                background: "rgba(255, 0, 85, 0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <AlertTriangle
                size={20}
                style={{ color: "var(--color-accent-secondary)" }}
              />
            </div>
            <div>
              <h2
                style={{
                  fontSize: "var(--text-lg)",
                  fontWeight: "var(--weight-bold)",
                  color: "var(--color-accent-secondary)",
                }}
              >
                Connection Failed
              </h2>
              <p
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--color-text-tertiary)",
                }}
              >
                Unable to establish database connection
              </p>
            </div>
          </div>
          <div
            style={{
              padding: 16,
              background: "var(--color-base-50)",
              borderRadius: 6,
              border: "1px solid var(--border-subtle)",
              marginBottom: 24,
            }}
          >
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-xs)",
                color: "var(--color-text-secondary)",
                wordBreak: "break-word",
                lineHeight: 1.6,
              }}
            >
              {error}
            </p>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <Button
              variant="secondary"
              onClick={handleRetry}
              isLoading={isRetrying}
              style={{ flex: 1 }}
            >
              <RefreshCw size={14} /> Retry
            </Button>
            <Button
              variant="ghost"
              onClick={() => navigate(`/edit-connection/${id}`)}
              style={{ flex: 1 }}
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
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header Bar */}
      <header
        style={{
          height: 56,
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--color-base-50)",
          display: "flex",
          alignItems: "center",
          padding: "0 24px",
          gap: 16,
          flexShrink: 0,
        }}
      >
        {/* Connection info */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: "rgba(0, 243, 255, 0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Database
              size={14}
              style={{ color: "var(--color-accent-primary)" }}
            />
          </div>
          <div>
            <div
              style={{
                fontSize: "var(--text-sm)",
                fontWeight: "var(--weight-medium)",
                color: "var(--color-text-primary)",
              }}
            >
              {connection?.name || "Connection"}
            </div>
            <div
              style={{
                fontSize: "0.65rem",
                color: "var(--color-text-tertiary)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {connection?.host}:{connection?.port}/{connection?.database}
            </div>
          </div>
        </div>

        {/* Divider */}
        <div
          style={{ width: 1, height: 24, background: "var(--border-subtle)" }}
        />

        {/* Table selector dropdown */}
        <div ref={dropdownRef} style={{ position: "relative" }}>
          <button
            onClick={() => setIsTableDropdownOpen(!isTableDropdownOpen)}
            disabled={isSchemaLoading}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              background: selectedTable
                ? "var(--color-base-200)"
                : "var(--color-base-100)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 6,
              color: selectedTable
                ? "var(--color-accent-primary)"
                : "var(--color-text-secondary)",
              fontSize: "var(--text-sm)",
              fontFamily: selectedTable ? "var(--font-mono)" : "inherit",
              cursor: "pointer",
              minWidth: 180,
              justifyContent: "space-between",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {isSchemaLoading ? (
                <Loader2
                  size={14}
                  style={{ animation: "spin 1s linear infinite" }}
                />
              ) : (
                <Table size={14} />
              )}
              {isSchemaLoading ? "Loading..." : selectedTable || "Select table"}
            </span>
            <ChevronDown
              size={14}
              style={{
                transform: isTableDropdownOpen ? "rotate(180deg)" : "rotate(0)",
                transition: "transform 0.2s",
              }}
            />
          </button>

          {/* Dropdown menu */}
          {isTableDropdownOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                width: 280,
                maxHeight: 320,
                background: "var(--color-base-100)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                boxShadow: "var(--shadow-lg)",
                zIndex: 1000,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {/* Search */}
              <div
                style={{
                  padding: 8,
                  borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                <div style={{ position: "relative" }}>
                  <Search
                    size={14}
                    style={{
                      position: "absolute",
                      left: 10,
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "var(--color-text-tertiary)",
                    }}
                  />
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Search tables..."
                    autoFocus
                    style={{
                      width: "100%",
                      padding: "8px 8px 8px 32px",
                      background: "var(--color-base-50)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 4,
                      color: "var(--color-text-primary)",
                      fontSize: "var(--text-xs)",
                    }}
                  />
                  {filter && (
                    <button
                      onClick={() => setFilter("")}
                      style={{
                        position: "absolute",
                        right: 8,
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "transparent",
                        color: "var(--color-text-tertiary)",
                        padding: 2,
                        borderRadius: 4,
                      }}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>

              {/* Table list */}
              <div style={{ flex: 1, overflowY: "auto", padding: 4 }}>
                {filteredTables.length === 0 ? (
                  <div
                    style={{
                      padding: 24,
                      textAlign: "center",
                      color: "var(--color-text-tertiary)",
                      fontSize: "var(--text-xs)",
                    }}
                  >
                    No tables found
                  </div>
                ) : (
                  filteredTables.map((table) => (
                    <button
                      key={table}
                      onClick={() => {
                        setSelectedTable(table);
                        setIsTableDropdownOpen(false);
                        setFilter("");
                      }}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "8px 12px",
                        background:
                          selectedTable === table
                            ? "var(--color-base-200)"
                            : "transparent",
                        border: "none",
                        borderRadius: 4,
                        color:
                          selectedTable === table
                            ? "var(--color-accent-primary)"
                            : "var(--color-text-secondary)",
                        fontSize: "var(--text-sm)",
                        fontFamily: "var(--font-mono)",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <Table
                        size={14}
                        style={{
                          color:
                            selectedTable === table
                              ? "var(--color-accent-primary)"
                              : "var(--color-text-tertiary)",
                        }}
                      />
                      <span
                        style={{
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {table}
                      </span>
                    </button>
                  ))
                )}
              </div>

              {/* Footer with count */}
              <div
                style={{
                  padding: "8px 12px",
                  borderTop: "1px solid var(--border-subtle)",
                  fontSize: "0.65rem",
                  color: "var(--color-text-tertiary)",
                }}
              >
                {tables.length} tables
              </div>
            </div>
          )}
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            onClick={() => navigate(`/edit-connection/${id}`)}
            title="Edit Connection"
            style={{
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: "none",
              borderRadius: 6,
              color: "var(--color-text-tertiary)",
              cursor: "pointer",
            }}
          >
            <Edit size={16} />
          </button>
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            title="Delete Connection"
            style={{
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: "none",
              borderRadius: 6,
              color: "var(--color-text-tertiary)",
              cursor: "pointer",
            }}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      {/* Main content */}
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {!selectedTable ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: 48,
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 80,
                height: 80,
                borderRadius: 16,
                background: "var(--color-base-100)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 24,
              }}
            >
              <Table
                size={36}
                style={{ color: "var(--color-text-tertiary)", opacity: 0.5 }}
              />
            </div>
            <h2
              style={{
                fontSize: "var(--text-lg)",
                fontWeight: "var(--weight-medium)",
                color: "var(--color-text-primary)",
                marginBottom: 8,
              }}
            >
              Select a Table
            </h2>
            <p
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--color-text-tertiary)",
                maxWidth: 300,
              }}
            >
              Choose a table from the dropdown above to view and explore its
              data.
            </p>
            {tables.length > 0 && (
              <div
                style={{
                  marginTop: 24,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  justifyContent: "center",
                  maxWidth: 400,
                }}
              >
                {tables.slice(0, 5).map((table) => (
                  <button
                    key={table}
                    onClick={() => setSelectedTable(table)}
                    style={{
                      padding: "6px 12px",
                      background: "var(--color-base-100)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 6,
                      color: "var(--color-text-secondary)",
                      fontSize: "var(--text-xs)",
                      fontFamily: "var(--font-mono)",
                      cursor: "pointer",
                    }}
                  >
                    {table}
                  </button>
                ))}
                {tables.length > 5 && (
                  <span
                    style={{
                      padding: "6px 12px",
                      fontSize: "var(--text-xs)",
                      color: "var(--color-text-tertiary)",
                    }}
                  >
                    +{tables.length - 5} more
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Table header bar */}
            <div
              style={{
                height: 44,
                borderBottom: "1px solid var(--border-subtle)",
                display: "flex",
                alignItems: "center",
                padding: "0 24px",
                gap: 12,
                background: "var(--color-base-50)",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--weight-bold)",
                  color: "var(--color-accent-primary)",
                }}
              >
                {selectedTable}
              </span>
              <span
                style={{
                  fontSize: "0.65rem",
                  color: "var(--color-text-tertiary)",
                  background: "var(--color-base-200)",
                  padding: "2px 8px",
                  borderRadius: 4,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                LIMIT 100
              </span>
            </div>
            {/* Data table with padding */}
            <div style={{ flex: 1, overflow: "hidden", padding: "0" }}>
              <DataTable data={tableData} isLoading={isDataLoading} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
