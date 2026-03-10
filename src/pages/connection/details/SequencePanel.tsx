import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "@context/ToastContext";
import { SequenceTab } from "@context/TabContext";
import styles from "./ConnectionDetails.module.css";

interface SequencePanelProps {
  connectionId: string;
  tab: SequenceTab;
}

export function SequencePanel({ connectionId, tab }: SequencePanelProps) {
  const toast = useToast();
  const [sequenceInfo, setSequenceInfo] = useState<Record<string, any> | null>(
    null,
  );
  const [isSequenceLoading, setIsSequenceLoading] = useState(false);

  const fetchSequenceInfo = useCallback(
    async (sequenceName: string, schema: string) => {
      setIsSequenceLoading(true);
      try {
        const result = await invoke<Record<string, any>>("get_sequence_info", {
          id: connectionId,
          sequenceName,
          schema,
        });
        setSequenceInfo(result);
      } catch (e: any) {
        console.error(e);
        toast.error(`Failed to load sequence info: ${e}`);
      } finally {
        setIsSequenceLoading(false);
      }
    },
    [connectionId, toast],
  );

  useEffect(() => {
    fetchSequenceInfo(tab.sequenceName, tab.schema);
  }, [connectionId, tab.sequenceName, tab.schema, fetchSequenceInfo]);

  if (isSequenceLoading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.spinner} />
        <p>Loading sequence info...</p>
      </div>
    );
  }

  if (!sequenceInfo) {
    return (
      <div className={styles.emptyState}>
        <p>No sequence information available</p>
      </div>
    );
  }

  return (
    <div className={styles.sequenceInfo}>
      <h3>Sequence Properties</h3>
      <div className={styles.metaGrid}>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Name:</span>
          <span className={styles.metaValue}>{sequenceInfo.name}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Schema:</span>
          <span className={styles.metaValue}>{sequenceInfo.schema}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Data Type:</span>
          <span className={styles.metaValue}>{sequenceInfo.data_type}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Current Value:</span>
          <span className={`${styles.metaValue} ${styles.highlight}`}>
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
  );
}
