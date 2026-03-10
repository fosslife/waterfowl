import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "@context/ToastContext";
import { FunctionTab } from "@context/TabContext";
import styles from "./ConnectionDetails.module.css";

interface FunctionPanelProps {
  connectionId: string;
  tab: FunctionTab;
}

export function FunctionPanel({ connectionId, tab }: FunctionPanelProps) {
  const toast = useToast();
  const [functionDefinition, setFunctionDefinition] = useState<string>("");
  const [functionMetadata, setFunctionMetadata] = useState<Record<
    string,
    any
  > | null>(null);
  const [isFunctionLoading, setIsFunctionLoading] = useState(false);

  const fetchFunctionInfo = useCallback(
    async (functionName: string, schema: string) => {
      setIsFunctionLoading(true);
      try {
        const result = await invoke<Record<string, any>>("get_function_info", {
          id: connectionId,
          functionName,
          schema,
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
    [connectionId, toast],
  );

  useEffect(() => {
    fetchFunctionInfo(tab.functionName, tab.schema);
  }, [connectionId, tab.functionName, tab.schema, fetchFunctionInfo]);

  if (isFunctionLoading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.spinner} />
        <p>Loading function definition...</p>
      </div>
    );
  }

  return (
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
              <div className={`${styles.metaItem} ${styles.fullWidth}`}>
                <span className={styles.metaLabel}>Description:</span>
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
          <code>{functionDefinition || "No definition available"}</code>
        </pre>
      </div>
    </>
  );
}
