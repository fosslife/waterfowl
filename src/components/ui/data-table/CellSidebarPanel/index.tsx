import { memo, useRef, useEffect } from "react";
import styles from "../DataTable.module.css";
import { X, Copy, Code2, Pencil, Ban, Check } from "lucide-react";

export const CellSidebarPanel = memo(function CellSidebarPanel({
  columnName,
  columnType,
  value,
  onCopy,
  onClear,
  onEdit,
  onSetNull,
  onCopyAsInsert,
  isEditing,
  editValue,
  onEditChange,
  onEditConfirm,
  onEditCancel,
}: {
  columnName: string;
  columnType: string;
  value: string;
  onCopy: () => void;
  onClear: () => void;
  onEdit?: () => void;
  onSetNull?: () => void;
  onCopyAsInsert?: () => void;
  isEditing?: boolean;
  editValue?: string;
  onEditChange?: (val: string) => void;
  onEditConfirm?: () => void;
  onEditCancel?: () => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.setSelectionRange(
        inputRef.current.value.length,
        inputRef.current.value.length,
      );
    }
  }, [isEditing]);

  // Format long strings nicely
  let displayValue = value;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null) {
      displayValue = JSON.stringify(parsed, null, 2);
    }
  } catch (e) {
    // not JSON, keep as is
  }

  return (
    <div className={styles.sidebarSection}>
      <div className={styles.sidebarSectionHeader}>
        <div className={styles.sidebarSectionTitle}>
          <span className={styles.sidebarColumnName}>{columnName}</span>
          <span className={styles.sidebarColumnType}>{columnType}</span>
        </div>
        <button
          className={styles.sidebarCloseBtn}
          onClick={onClear}
          title="Clear selection (Esc)"
        >
          <X size={14} />
        </button>
      </div>

      <div className={styles.sidebarValueContainer}>
        {isEditing && editValue !== undefined ? (
          <textarea
            ref={inputRef}
            className={styles.sidebarEditorInput}
            value={editValue}
            onChange={(e) => onEditChange?.(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onEditConfirm?.();
              }
              if (e.key === "Escape") onEditCancel?.();
            }}
          />
        ) : (
          <pre className={styles.sidebarPreValue}>{displayValue}</pre>
        )}
      </div>

      <div className={styles.sidebarActions}>
        {isEditing ? (
          <>
            <button
              className={styles.sidebarBtn}
              onClick={onEditConfirm}
              title="Save changes (Enter)"
            >
              <Check size={16} />
              <span>Save Value</span>
            </button>
            <button
              className={styles.sidebarBtn}
              onClick={onEditCancel}
              title="Cancel editing (Esc)"
            >
              <X size={16} />
              <span>Cancel Edit</span>
            </button>
          </>
        ) : (
          <>
            <button
              className={styles.sidebarBtn}
              onClick={onCopy}
              title="Copy cell value (Ctrl+C)"
            >
              <Copy size={16} />
              <span>Copy Value</span>
            </button>
            {onCopyAsInsert && (
              <button
                className={styles.sidebarBtn}
                onClick={onCopyAsInsert}
                title="Copy row as INSERT statement"
              >
                <Code2 size={16} />
                <span>Copy as INSERT</span>
              </button>
            )}
            {onEdit && (
              <button
                className={styles.sidebarBtn}
                onClick={onEdit}
                title="Edit cell value (Enter)"
              >
                <Pencil size={16} />
                <span>Edit Value</span>
              </button>
            )}
            {onSetNull && (
              <button
                className={`${styles.sidebarBtn} ${styles.sidebarBtnDanger}`}
                onClick={onSetNull}
                title="Set cell value to NULL"
              >
                <Ban size={16} />
                <span>Set to NULL</span>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
});
