import { useParams, useNavigate } from "react-router-dom";
import { useState, useRef } from "react";
import { Play, ArrowLeft, Database } from "lucide-react";
import { SqlEditorTab, SqlEditorTabRef } from "../components/SqlEditorTab";
import { Button } from "../components/ui/Button";
import { useConnections } from "../context/ConnectionsContext";
import styles from "./SqlEditorPage.module.css";

export function SqlEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { connections } = useConnections();

  const tabRef = useRef<SqlEditorTabRef>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [query, setQuery] = useState("");

  const connection = connections.find((c) => c.id === id);

  const handleExecute = () => {
    tabRef.current?.execute();
  };

  const connectionHost = connection
    ? `${connection.host}:${connection.port}/${connection.database}`
    : "";

  if (!id) {
    return (
      <div className={styles.page}>
        <div className={styles.errorState}>No connection ID provided</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <button
          className={styles.backBtn}
          onClick={() => navigate(`/connection/${id}`)}
          title="Back to connection"
        >
          <ArrowLeft size={16} />
        </button>

        <div className={styles.connectionInfo}>
          <div className={styles.connectionIconWrapper}>
            <Database size={14} />
          </div>
          <div>
            <div className={styles.connectionName}>
              {connection?.name || "Connection"}
            </div>
            <div className={styles.connectionHost}>{connectionHost}</div>
          </div>
        </div>

        <div className={styles.headerTitle}>SQL Editor</div>

        <div className={styles.spacer} />

        <Button
          variant="primary"
          onClick={handleExecute}
          disabled={isExecuting || !query.trim()}
          isLoading={isExecuting}
          className={styles.executeBtn}
        >
          <Play size={14} />
          Execute
        </Button>
      </header>

      {/* Main content - use SqlEditorTab */}
      <SqlEditorTab
        ref={tabRef}
        connectionId={id}
        onQueryChange={setQuery}
        onExecutingChange={setIsExecuting}
        showExecuteButton={false}
      />
    </div>
  );
}
