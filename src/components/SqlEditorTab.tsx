import {
  useEffect,
  useState,
  useCallback,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Play,
  Database,
  Clock,
  AlertCircle,
  CheckCircle2,
  Copy,
  Trash2,
  Loader2,
} from "lucide-react";
import { SqlEditor, SqlEditorRef, SchemaCompletionData } from "./sql-editor";
import { DataTable } from "./ui/DataTable";
import { Button } from "./ui/Button";
import { useToast } from "../context/ToastContext";
import { QueryResult, QueryHistoryItem } from "../types/sql";
import styles from "./SqlEditorTab.module.css";

export interface SqlEditorTabRef {
  execute: () => void;
  getQuery: () => string;
}

export interface SqlEditorTabProps {
  connectionId: string;
  initialQuery?: string;
  onQueryChange?: (query: string) => void;
  onExecutingChange?: (isExecuting: boolean) => void;
  /** Hide the execute button in the editor panel (useful when parent has its own) */
  showExecuteButton?: boolean;
}

const DEFAULT_QUERY = `-- Write your SQL query here
-- Press Ctrl+Enter (Cmd+Enter on Mac) to execute

SELECT * FROM `;

export const SqlEditorTab = forwardRef<SqlEditorTabRef, SqlEditorTabProps>(
  function SqlEditorTab(
    {
      connectionId,
      initialQuery,
      onQueryChange,
      onExecutingChange,
      showExecuteButton = true,
    },
    ref
  ) {
    const toast = useToast();
    const editorRef = useRef<SqlEditorRef>(null);

    // State
    const [query, setQuery] = useState(initialQuery || DEFAULT_QUERY);
    const [isExecuting, setIsExecuting] = useState(false);
    const [result, setResult] = useState<QueryResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [schemaData, setSchemaData] = useState<SchemaCompletionData | null>(
      null
    );
    const [history, setHistory] = useState<QueryHistoryItem[]>([]);
    const [activeSchema] = useState("public");

    // Notify parent of executing state changes
    const updateIsExecuting = useCallback(
      (value: boolean) => {
        setIsExecuting(value);
        onExecutingChange?.(value);
      },
      [onExecutingChange]
    );

    // Load schema data for autocomplete
    const loadSchemaData = useCallback(async () => {
      if (!connectionId) return;

      try {
        const schemas = await invoke<string[]>("get_schemas", {
          id: connectionId,
        });
        const schemaObjects = await invoke<{
          tables: { name: string }[];
          views: { name: string }[];
          functions: { name: string }[];
          sequences: { name: string }[];
        }>("get_schema_objects", { id: connectionId, schema: activeSchema });

        const completionData: SchemaCompletionData = {
          tables: schemaObjects.tables.map((t) => ({ name: t.name })),
          views: schemaObjects.views.map((v) => ({ name: v.name })),
          functions: schemaObjects.functions.map((f) => ({ name: f.name })),
          schemas,
        };

        setSchemaData(completionData);
      } catch (e) {
        console.error("Failed to load schema data:", e);
      }
    }, [connectionId, activeSchema]);

    useEffect(() => {
      loadSchemaData();
    }, [loadSchemaData]);

    // Execute query
    const executeQuery = useCallback(
      async (queryToExecute: string) => {
        if (!connectionId || !queryToExecute.trim()) return;

        updateIsExecuting(true);
        setError(null);

        const startTime = Date.now();
        const historyId = crypto.randomUUID();

        try {
          const queryResult = await invoke<QueryResult>("execute_query", {
            id: connectionId,
            query: queryToExecute,
          });

          setResult(queryResult);

          setHistory((prev) => [
            {
              id: historyId,
              query: queryToExecute,
              timestamp: new Date(),
              success: true,
              rowCount: queryResult.rows.length,
              executionTime: queryResult.execution_time_ms,
            },
            ...prev.slice(0, 49),
          ]);

          toast.success(
            `Query executed: ${queryResult.rows.length} rows in ${queryResult.execution_time_ms}ms`
          );
        } catch (e: any) {
          const errorMessage = e.toString();
          setError(errorMessage);
          setResult(null);

          setHistory((prev) => [
            {
              id: historyId,
              query: queryToExecute,
              timestamp: new Date(),
              success: false,
              error: errorMessage,
              executionTime: Date.now() - startTime,
            },
            ...prev.slice(0, 49),
          ]);

          toast.error("Query failed");
        } finally {
          updateIsExecuting(false);
        }
      },
      [connectionId, toast, updateIsExecuting]
    );

    const handleExecute = useCallback(() => {
      const queryToRun = editorRef.current?.getSelection() || query;
      executeQuery(queryToRun);
    }, [query, executeQuery]);

    // Expose methods to parent via ref
    useImperativeHandle(
      ref,
      () => ({
        execute: handleExecute,
        getQuery: () => query,
      }),
      [handleExecute, query]
    );

    const handleQueryChange = useCallback(
      (newQuery: string) => {
        setQuery(newQuery);
        onQueryChange?.(newQuery);
      },
      [onQueryChange]
    );

    const handleHistoryClick = useCallback((item: QueryHistoryItem) => {
      setQuery(item.query);
      editorRef.current?.setValue(item.query);
      editorRef.current?.focus();
    }, []);

    const handleClearHistory = useCallback(() => {
      setHistory([]);
      toast.info("History cleared");
    }, [toast]);

    const handleCopyResult = useCallback(() => {
      if (!result || result.rows.length === 0) return;

      const headers = result.columns.map((c) => c.name);
      const headerLine = headers.join("\t");
      const dataLines = result.rows.map((row) =>
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
        toast.success("Copied to clipboard");
      });
    }, [result, toast]);

    const formatTimestamp = (date: Date) => {
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    };

    return (
      <div className={styles.container}>
        {/* Main content */}
        <div className={styles.content}>
          {/* Editor panel */}
          <div className={styles.editorPanel}>
            <div className={styles.editorHeader}>
              <span className={styles.editorTitle}>Query</span>
              <span className={styles.editorHint}>
                Ctrl+Enter to execute • Select text to run partial query
              </span>
              <div className={styles.spacer} />
              {showExecuteButton && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleExecute}
                  disabled={isExecuting || !query.trim()}
                  isLoading={isExecuting}
                >
                  <Play size={14} />
                  Execute
                </Button>
              )}
            </div>
            <div className={styles.editorWrapper}>
              <SqlEditor
                ref={editorRef}
                initialValue={query}
                onChange={handleQueryChange}
                onExecute={executeQuery}
                schemaData={schemaData || undefined}
                placeholder="Enter your SQL query..."
                autoFocus
                minHeight="150px"
                maxHeight="300px"
              />
            </div>
          </div>

          {/* Results panel */}
          <div className={styles.resultsPanel}>
            <div className={styles.resultsHeader}>
              <span className={styles.resultsTitle}>Results</span>
              {result && (
                <div className={styles.resultsMeta}>
                  <span className={styles.resultCount}>
                    {result.rows.length} rows
                  </span>
                  <span className={styles.resultTime}>
                    <Clock size={12} />
                    {result.execution_time_ms}ms
                  </span>
                  <button
                    className={styles.copyBtn}
                    onClick={handleCopyResult}
                    title="Copy as TSV"
                  >
                    <Copy size={14} />
                  </button>
                </div>
              )}
            </div>

            <div className={styles.resultsContent}>
              {isExecuting && (
                <div className={styles.loadingState}>
                  <Loader2 size={24} className={styles.spinner} />
                  <span>Executing query...</span>
                </div>
              )}

              {!isExecuting && error && (
                <div className={styles.errorState}>
                  <div className={styles.errorIcon}>
                    <AlertCircle size={20} />
                  </div>
                  <div className={styles.errorContent}>
                    <div className={styles.errorTitle}>Query Error</div>
                    <pre className={styles.errorMessage}>{error}</pre>
                  </div>
                </div>
              )}

              {!isExecuting && !error && result && (
                <div className={styles.tableWrapper}>
                  <DataTable
                    data={result.rows}
                    columnInfo={result.columns}
                    isLoading={false}
                  />
                </div>
              )}

              {!isExecuting && !error && !result && (
                <div className={styles.emptyState}>
                  <Database size={32} className={styles.emptyIcon} />
                  <span>Execute a query to see results</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* History sidebar */}
        <aside className={styles.historySidebar}>
          <div className={styles.historyHeader}>
            <span className={styles.historyTitle}>History</span>
            {history.length > 0 && (
              <button
                className={styles.clearHistoryBtn}
                onClick={handleClearHistory}
                title="Clear history"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>

          <div className={styles.historyList}>
            {history.length === 0 ? (
              <div className={styles.historyEmpty}>
                <Clock size={16} />
                <span>No queries yet</span>
              </div>
            ) : (
              history.map((item) => (
                <button
                  key={item.id}
                  className={styles.historyItem}
                  onClick={() => handleHistoryClick(item)}
                  data-success={item.success}
                >
                  <div className={styles.historyItemHeader}>
                    {item.success ? (
                      <CheckCircle2 size={12} className={styles.successIcon} />
                    ) : (
                      <AlertCircle
                        size={12}
                        className={styles.errorIconSmall}
                      />
                    )}
                    <span className={styles.historyTime}>
                      {formatTimestamp(item.timestamp)}
                    </span>
                  </div>
                  <pre className={styles.historyQuery}>
                    {item.query.slice(0, 100)}
                    {item.query.length > 100 ? "..." : ""}
                  </pre>
                  {item.success && item.rowCount !== undefined && (
                    <span className={styles.historyMeta}>
                      {item.rowCount} rows • {item.executionTime}ms
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </aside>
      </div>
    );
  }
);
