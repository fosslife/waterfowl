import { memo } from "react";
import styles from "../DataTable.module.css";
import { X, Copy, Trash2 } from "lucide-react";

export const SelectionSidebarPanel = memo(function SelectionSidebarPanel({
  selectedCount,
  onClear,
  onCopy,
  onDelete,
}: {
  selectedCount: number;
  onClear: () => void;
  onCopy?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className={styles.sidebarSection}>
      <div className={styles.sidebarSectionHeader}>
        <div className={styles.sidebarSectionTitle}>
          <span className={styles.sidebarCount}>{selectedCount}</span>
          <span className={styles.sidebarLabel}>
            row{selectedCount !== 1 ? "s" : ""} selected
          </span>
        </div>
        <button
          className={styles.sidebarCloseBtn}
          onClick={onClear}
          title="Clear selection"
        >
          <X size={14} />
        </button>
      </div>

      <div className={styles.sidebarActions}>
        {onCopy && (
          <button
            className={styles.sidebarBtn}
            onClick={onCopy}
            title="Copy selected rows"
          >
            <Copy size={16} />
            <span>Copy Rows</span>
          </button>
        )}
        {onDelete && (
          <button
            className={`${styles.sidebarBtn} ${styles.sidebarBtnDanger}`}
            onClick={onDelete}
            title="Delete selected rows"
          >
            <Trash2 size={16} />
            <span>Delete Rows</span>
          </button>
        )}
      </div>
    </div>
  );
});
