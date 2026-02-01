import { Loader2, Database } from "lucide-react";
import styles from "./DataTable.module.css";
import clsx from "clsx";

interface DataTableProps {
  data: Record<string, any>[];
  isLoading?: boolean;
  emptyMessage?: string;
}

export function DataTable({
  data,
  isLoading,
  emptyMessage = "No data found",
}: DataTableProps) {
  if (isLoading) {
    return (
      <div className={styles.loadingState}>
        <div className={styles.loadingSpinner}>
          <Loader2 className={styles.spinnerIcon} size={24} />
          <div className={styles.scanLine} />
        </div>
        <span className={styles.loadingText}>Fetching records...</span>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={styles.emptyState}>
        <Database size={32} className={styles.emptyIcon} />
        <span className={styles.emptyText}>{emptyMessage}</span>
      </div>
    );
  }

  const columns = Object.keys(data[0]);

  return (
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.rowIndex}>#</th>
            {columns.map((col) => (
              <th key={col}>
                <span className={styles.columnName}>{col}</span>
                <span className={styles.columnType}>
                  {inferType(data, col)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} className={clsx(i % 2 === 1 && styles.zebraRow)}>
              <td className={styles.rowIndex}>{i + 1}</td>
              {columns.map((col) => (
                <td key={col} className={getCellClass(row[col])}>
                  {formatValue(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.tableFooter}>
        <span className={styles.rowCount}>{data.length} rows</span>
      </div>
    </div>
  );
}

function inferType(data: Record<string, any>[], col: string): string {
  const sample = data.find(
    (row) => row[col] !== null && row[col] !== undefined
  )?.[col];
  if (sample === undefined) return "unknown";
  if (typeof sample === "number")
    return Number.isInteger(sample) ? "int" : "float";
  if (typeof sample === "boolean") return "bool";
  if (typeof sample === "string") {
    if (/^\d{4}-\d{2}-\d{2}/.test(sample)) return "date";
    if (sample.length > 100) return "text";
    return "varchar";
  }
  if (typeof sample === "object") return "json";
  return "unknown";
}

function getCellClass(val: any): string {
  if (val === null || val === undefined) return styles.cellNull;
  if (typeof val === "number") return styles.cellNumber;
  if (typeof val === "boolean") return styles.cellBoolean;
  if (typeof val === "object") return styles.cellJson;
  return "";
}

function formatValue(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}
