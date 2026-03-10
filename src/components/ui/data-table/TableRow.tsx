import { memo } from "react";
import { Check } from "lucide-react";
import { flexRender } from "@tanstack/react-table";
import type { PaginationState } from "./DataTable";
import styles from "./DataTable.module.css";

interface TableRowProps {
  row: any;
  virtualRow: { index: number; size: number; start: number };
  isSelected: boolean;
  isOdd: boolean;
  selectable: boolean;
  pagination?: PaginationState;
  totalTableWidth: number;
  onToggleSelection: (index: number) => void;
  selectedCellColumnId?: string | null;
  onCellClick?: (rowIndex: number, columnId: string) => void;
  onCellDoubleClick?: (rowIndex: number, columnId: string) => void;
  onContextMenu?: (
    e: React.MouseEvent,
    rowIndex: number,
    columnId: string,
  ) => void;
}

function getCellClass(val: any): string {
  if (val === null || val === undefined) return styles.cellNull;
  if (typeof val === "number") return styles.cellNumber;
  if (typeof val === "boolean") return styles.cellBoolean;
  if (Array.isArray(val)) return styles.cellArray;
  if (typeof val === "object") return styles.cellJson;
  return "";
}



export const TableRow = memo(function TableRow({
  row,
  virtualRow,
  isSelected,
  isOdd,
  selectable,
  pagination,
  totalTableWidth,
  onToggleSelection,
  selectedCellColumnId,
  onCellClick,
  onCellDoubleClick,
  onContextMenu,
}: TableRowProps) {
  return (
    <tr
      data-index={virtualRow.index}
      data-selected={isSelected}
      className={isOdd ? styles.zebraRow : undefined}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: totalTableWidth,
        height: `${virtualRow.size}px`,
        transform: `translateY(${virtualRow.start}px)`,
      }}
    >
      {selectable && (
        <td className={styles.checkboxCell}>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelection(virtualRow.index)}
            />
            <span className={styles.checkboxIndicator}>
              {isSelected && <Check size={12} />}
            </span>
          </label>
        </td>
      )}
      <td className={styles.rowIndex}>
        {pagination
          ? pagination.page * pagination.pageSize + virtualRow.index + 1
          : virtualRow.index + 1}
      </td>
      {row.getVisibleCells().map((cell: any) => {
        const value = cell.getValue();
        const columnId = cell.column.id;
        const isCellSelected = selectedCellColumnId === columnId;
        const cellClass = getCellClass(value);
        return (
          <td
            key={cell.id}
            className={
              isCellSelected
                ? cellClass
                  ? `${cellClass} ${styles.cellSelected}`
                  : styles.cellSelected
                : cellClass
            }
            style={{ width: cell.column.getSize() }}
            data-cell-row={virtualRow.index}
            data-cell-col={columnId}
            onClick={() => onCellClick?.(virtualRow.index, columnId)}
            onDoubleClick={() =>
              onCellDoubleClick?.(virtualRow.index, columnId)
            }
            onContextMenu={(e) =>
              onContextMenu?.(e, virtualRow.index, columnId)
            }
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        );
      })}
    </tr>
  );
});
