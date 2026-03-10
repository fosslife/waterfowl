import { memo, useRef, useEffect } from "react";
import styles from "../DataTable.module.css";
import { Copy, ClipboardList, Code2, Pencil, Ban } from "lucide-react";

export const ContextMenu = memo(function ContextMenu({
  x,
  y,
  onCopyCell,
  onCopyRow,
  onCopyAsInsert,
  onEdit,
  onSetNull,
  onClose,
}: {
  x: number;
  y: number;
  onCopyCell: () => void;
  onCopyRow: () => void;
  onCopyAsInsert?: () => void;
  onEdit?: () => void;
  onSetNull?: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Keep menu within viewport bounds
  const adjustedX = Math.min(x, window.innerWidth - 220);
  const adjustedY = Math.min(y, window.innerHeight - 240);

  return (
    <div
      ref={menuRef}
      className={styles.contextMenu}
      style={{ left: adjustedX, top: adjustedY }}
    >
      <button className={styles.contextMenuItem} onClick={onCopyCell}>
        <Copy size={14} />
        <span>Copy Cell Value</span>
        <span className={styles.contextMenuShortcut}>Ctrl+C</span>
      </button>
      <button className={styles.contextMenuItem} onClick={onCopyRow}>
        <ClipboardList size={14} />
        <span>Copy Row</span>
      </button>
      {onCopyAsInsert && (
        <button className={styles.contextMenuItem} onClick={onCopyAsInsert}>
          <Code2 size={14} />
          <span>Copy as INSERT</span>
        </button>
      )}
      {(onEdit || onSetNull) && <div className={styles.contextMenuDivider} />}
      {onEdit && (
        <button className={styles.contextMenuItem} onClick={onEdit}>
          <Pencil size={14} />
          <span>Edit Value</span>
          <span className={styles.contextMenuShortcut}>Enter</span>
        </button>
      )}
      {onSetNull && (
        <button
          className={styles.contextMenuItem}
          data-variant="danger"
          onClick={onSetNull}
        >
          <Ban size={14} />
          <span>Set NULL</span>
        </button>
      )}
    </div>
  );
});
