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
  ScrollText,
} from "lucide-react";
import { SqlEditor, SqlEditorRef, SchemaCompletionData } from "./sql-editor";
import { DataTable } from "./ui/data-table/DataTable";
import { Button } from "./ui/button/Button";
import { useToast } from "../context/ToastContext";
import {
  QueryResult,
  QueryHistoryItem,
  ScriptResult,
  ScriptStatementResult,
} from "../types/sql";
import {
  splitStatements,
  statementAtCursor,
  type SqlStatement,
} from "../utils/sqlStatements";
import styles from "./SqlEditorTab.module.css";

export interface SqlEditorTabRef {
  execute: () => void;
  getQuery: () => string;
}

export interface SqlEditorTabProps {
  connectionId: string;
  /**
   * Identifies this tab's pinned database session. Must be stable for the life
   * of the tab — statements run on the session it names, so transactions and
   * `SET`s survive switching away and back.
   */
  sessionId: string;
  initialQuery?: string;
  onQueryChange?: (query: string) => void;
  onExecutingChange?: (isExecuting: boolean) => void;
  /** Hide the execute button in the editor panel (useful when parent has its own) */
  showExecuteButton?: boolean;
}

const DEFAULT_QUERY = `-- Write your SQL query here
-- Press Ctrl+Enter (Cmd+Enter on Mac) to execute

SELECT * FROM `;

/** One-line summary of a result. Statements with no columns (INSERT/UPDATE/
 *  DELETE/DDL) return no rows, so the server-reported count is all there is. */
function describeResult(result: QueryResult): string {
  if (result.columns.length === 0) {
    return `${result.rows_affected} rows affected`;
  }
  return result.truncated
    ? `first ${result.rows.length} rows`
    : `${result.rows.length} rows`;
}

/** Collapse a statement onto one line for the script log. */
function summarizeStatement(statement: string): string {
  const flat = statement.replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 119)}…` : flat;
}

export const SqlEditorTab = forwardRef<SqlEditorTabRef, SqlEditorTabProps>(
  function SqlEditorTab(
    {
      connectionId,
      sessionId,
      initialQuery,
      onQueryChange,
      onExecutingChange,
      showExecuteButton = true,
    },
    ref,
  ) {
    const toast = useToast();
    const editorRef = useRef<SqlEditorRef>(null);

    // State
    const [query, setQuery] = useState(initialQuery || DEFAULT_QUERY);
    const [isExecuting, setIsExecuting] = useState(false);
    const [result, setResult] = useState<QueryResult | null>(null);
    /** Set only for script runs — drives the per-statement log strip. */
    const [script, setScript] = useState<ScriptResult | null>(null);
    /** Which statement's result the grid is showing, within a script run. */
    const [selectedStatement, setSelectedStatement] = useState<number | null>(
      null,
    );
    const [error, setError] = useState<string | null>(null);
    const [schemaData, setSchemaData] = useState<SchemaCompletionData | null>(
      null,
    );
    const [history, setHistory] = useState<QueryHistoryItem[]>([]);
    const [activeSchema] = useState("public");

    // Notify parent of executing state changes
    const updateIsExecuting = useCallback(
      (value: boolean) => {
        setIsExecuting(value);
        onExecutingChange?.(value);
      },
      [onExecutingChange],
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

    // Claim this tab's database session. Opening is idempotent, so remounting
    // on a tab switch reattaches to the session (and any transaction on it)
    // rather than starting a new one. Closing is the tab's job, not this
    // component's — see closeTab in TabContext.
    useEffect(() => {
      if (!connectionId) return;
      invoke("open_session", { id: connectionId, sessionId }).catch((e) =>
        console.error("Failed to open SQL session:", e),
      );
    }, [connectionId, sessionId]);

    // Execute query
    const executeQuery = useCallback(
      async (queryToExecute: string) => {
        if (!connectionId || !queryToExecute.trim()) return;

        updateIsExecuting(true);
        setError(null);
        // Running a single statement replaces any script log on screen — the
        // log describes a run that is no longer what the grid is showing.
        setScript(null);
        setSelectedStatement(null);

        const startTime = Date.now();
        const historyId = crypto.randomUUID();

        try {
          const queryResult = await invoke<QueryResult>("execute_query", {
            id: connectionId,
            query: queryToExecute,
            sessionId,
          });

          setResult(queryResult);

          setHistory((prev) => [
            {
              id: historyId,
              query: queryToExecute,
              timestamp: new Date(),
              success: true,
              rowCount:
                queryResult.columns.length === 0
                  ? queryResult.rows_affected
                  : queryResult.rows.length,
              executionTime: queryResult.execution_time_ms,
            },
            ...prev.slice(0, 49),
          ]);

          const summary = describeResult(queryResult);
          if (queryResult.session_reset) {
            // Worth its own warning: the rollback is silent otherwise, and the
            // user may have believed a transaction was still open.
            toast.error(
              `${summary} — result truncated, so the session was reset. Any open transaction rolled back.`,
            );
          } else if (queryResult.truncated) {
            toast.info(
              `Query executed: ${summary} in ${queryResult.execution_time_ms}ms — result truncated`,
            );
          } else {
            toast.success(
              `Query executed: ${summary} in ${queryResult.execution_time_ms}ms`,
            );
          }
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
      [connectionId, sessionId, toast, updateIsExecuting],
    );

    // Splitting is cheap but runs on every cursor move, so hold the result for
    // as long as the document is unchanged.
    const statementCache = useRef<{
      doc: string;
      statements: SqlStatement[];
    } | null>(null);

    const getStatements = useCallback((doc: string) => {
      if (statementCache.current?.doc !== doc) {
        statementCache.current = { doc, statements: splitStatements(doc) };
      }
      return statementCache.current.statements;
    }, []);

    /**
     * What Ctrl+Enter and the Execute button both run: the selection if there
     * is one, otherwise the statement under the cursor. Identical for both
     * controls — the same gesture shouldn't mean two different things.
     */
    const handleExecute = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;

      const doc = editor.getValue();
      const selection = editor.getSelectionRange();
      if (selection.from !== selection.to) {
        executeQuery(doc.slice(selection.from, selection.to));
        return;
      }

      const statement = statementAtCursor(
        getStatements(doc),
        editor.getCursorPosition(),
      );
      if (!statement) {
        toast.error("No statement under the cursor");
        return;
      }
      executeQuery(statement.text);
    }, [executeQuery, getStatements, toast]);

    /**
     * Show one statement of a script run. Its outcome — a grid or an error —
     * owns the area below the log, so selecting a different row swaps both.
     * Passing null clears the area.
     */
    const selectStatement = useCallback(
      (entry: ScriptStatementResult | null) => {
        setSelectedStatement(entry?.index ?? null);
        setResult(entry?.result ?? null);
        setError(
          entry?.error
            ? `Statement ${entry.index + 1} failed: ${entry.error}`
            : null,
        );
      },
      [],
    );

    /**
     * What Ctrl+Shift+Enter and the Run Script button both run: every statement
     * in the editor, in order, on this tab's session. A selection narrows the
     * script to itself, matching the single-statement path.
     *
     * Nothing is wrapped in a transaction on the user's behalf — the script
     * does what it says. `BEGIN` and `COMMIT` in the text work because the
     * whole run stays on one session.
     */
    const executeScript = useCallback(async () => {
      const editor = editorRef.current;
      if (!editor || !connectionId) return;

      const doc = editor.getValue();
      const selection = editor.getSelectionRange();
      const source =
        selection.from !== selection.to
          ? doc.slice(selection.from, selection.to)
          : doc;

      const statements = splitStatements(source).map((s) => s.text);
      if (statements.length === 0) {
        toast.error("Nothing to run");
        return;
      }

      updateIsExecuting(true);
      setError(null);
      const historyId = crypto.randomUUID();

      try {
        const script = await invoke<ScriptResult>("execute_script", {
          sessionId,
          statements,
        });

        setScript(script);

        const failed = script.statements.find((s) => s.error);
        // Open on the failure if there was one — it's the thing that needs
        // attention. Otherwise on the last statement that produced a grid: a
        // script is mostly DDL/DML, and the trailing SELECT is the check.
        const lastWithRows = [...script.statements]
          .reverse()
          .find((s) => s.result && s.result.columns.length > 0);
        selectStatement(failed ?? lastWithRows ?? null);
        setHistory((prev) => [
          {
            id: historyId,
            query: source,
            timestamp: new Date(),
            success: !failed,
            error: failed?.error ?? undefined,
            executionTime: script.execution_time_ms,
          },
          ...prev.slice(0, 49),
        ]);

        if (failed) {
          toast.error(
            `Script stopped at statement ${failed.index + 1} of ${statements.length}`,
          );
        } else if (script.stopped_early) {
          toast.error(
            `Script stopped after statement ${script.statements.length} of ${statements.length} — the session was reset`,
          );
        } else {
          toast.success(
            `Script ran ${statements.length} statements in ${script.execution_time_ms}ms`,
          );
        }
      } catch (e: any) {
        const errorMessage = e.toString();
        setError(errorMessage);
        setScript(null);
        setResult(null);
        toast.error("Script failed");
      } finally {
        updateIsExecuting(false);
      }
    }, [connectionId, sessionId, selectStatement, toast, updateIsExecuting]);

    // Keep the highlight in step with the cursor so the armed statement is
    // always visible before it runs.
    const handleCursorActivity = useCallback(
      (position: number, selection: { from: number; to: number }) => {
        const editor = editorRef.current;
        if (!editor) return;

        // A selection already shows its own extent; a second tint would only
        // muddy which of the two is about to run.
        if (selection.from !== selection.to) {
          editor.setActiveStatement(null);
          return;
        }

        const statement = statementAtCursor(
          getStatements(editor.getValue()),
          position,
        );
        editor.setActiveStatement(
          statement ? { from: statement.from, to: statement.to } : null,
        );
      },
      [getStatements],
    );

    // Expose methods to parent via ref
    useImperativeHandle(
      ref,
      () => ({
        execute: handleExecute,
        getQuery: () => query,
      }),
      [handleExecute, query],
    );

    // CodeMirror only reports cursor activity once something moves, so prime the
    // highlight on mount — the armed statement should be visible before the
    // user touches anything.
    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      handleCursorActivity(
        editor.getCursorPosition(),
        editor.getSelectionRange(),
      );
    }, [handleCursorActivity]);

    const handleQueryChange = useCallback(
      (newQuery: string) => {
        setQuery(newQuery);
        onQueryChange?.(newQuery);
      },
      [onQueryChange],
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
          .join("\t"),
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
                Ctrl+Enter runs the highlighted statement • Ctrl+Shift+Enter
                runs all • Select text to run only that
              </span>
              <div className={styles.spacer} />
              {showExecuteButton && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={executeScript}
                    disabled={isExecuting || !query.trim()}
                    title="Run every statement in order (Ctrl+Shift+Enter)"
                  >
                    <ScrollText size={14} />
                    Run Script
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleExecute}
                    disabled={isExecuting || !query.trim()}
                    isLoading={isExecuting}
                    title="Run the highlighted statement (Ctrl+Enter)"
                  >
                    <Play size={14} />
                    Execute
                  </Button>
                </>
              )}
            </div>
            <div className={styles.editorWrapper}>
              <SqlEditor
                ref={editorRef}
                initialValue={query}
                onChange={handleQueryChange}
                onExecute={handleExecute}
                onExecuteScript={executeScript}
                onCursorActivity={handleCursorActivity}
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
                    {describeResult(result)}
                  </span>
                  {result.truncated && (
                    <span
                      className={styles.resultTruncated}
                      title="The result set was larger than the display limit. Add a LIMIT clause, or export the table to get every row."
                    >
                      <AlertCircle size={12} />
                      truncated
                    </span>
                  )}
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

              {!isExecuting && script && (
                <div className={styles.scriptLog}>
                  {script.statements.map((entry) => (
                    <button
                      key={entry.index}
                      className={styles.scriptLogRow}
                      data-selected={selectedStatement === entry.index}
                      title={entry.statement}
                      onClick={() => selectStatement(entry)}
                    >
                      <span className={styles.scriptLogIndex}>
                        {entry.index + 1}
                      </span>
                      {entry.error ? (
                        <AlertCircle
                          size={12}
                          className={styles.scriptLogFailed}
                        />
                      ) : (
                        <CheckCircle2
                          size={12}
                          className={styles.scriptLogOk}
                        />
                      )}
                      <span className={styles.scriptLogText}>
                        {summarizeStatement(entry.statement)}
                      </span>
                      <span className={styles.scriptLogSummary}>
                        {entry.result ? describeResult(entry.result) : "failed"}
                      </span>
                    </button>
                  ))}
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

              {!isExecuting && !error && !result && !script && (
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
  },
);
