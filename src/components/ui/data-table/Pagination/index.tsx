import { memo } from "react";
import styles from "../DataTable.module.css";
import {
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
} from "lucide-react";
import { PaginationState } from "../DataTable";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500];

export const PaginationControls = memo(function PaginationControls({
  pagination,
  onPageChange,
  onPageSizeChange,
}: {
  pagination: PaginationState;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}) {
  const { page, pageSize, totalCount } = pagination;
  const totalPages = Math.ceil(totalCount / pageSize);
  const startRow = page * pageSize + 1;
  const endRow = Math.min((page + 1) * pageSize, totalCount);

  const canGoPrev = page > 0;
  const canGoNext = page < totalPages - 1;

  return (
    <div className={styles.pagination}>
      {/* Page size selector */}
      <div className={styles.pageSizeSelector}>
        <span className={styles.pageSizeLabel}>Rows:</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange?.(Number(e.target.value))}
          className={styles.pageSizeSelect}
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>

      {/* Navigation controls */}
      <div className={styles.pageNav}>
        <button
          onClick={() => onPageChange?.(0)}
          disabled={!canGoPrev}
          className={styles.pageBtn}
          title="First page"
        >
          <ChevronsLeft size={14} />
        </button>
        <button
          onClick={() => onPageChange?.(page - 1)}
          disabled={!canGoPrev}
          className={styles.pageBtn}
          title="Previous page"
        >
          <ChevronLeft size={14} />
        </button>

        <span className={styles.pageInfo}>
          Page {page + 1} of {totalPages || 1}
        </span>

        <button
          onClick={() => onPageChange?.(page + 1)}
          disabled={!canGoNext}
          className={styles.pageBtn}
          title="Next page"
        >
          <ChevronRight size={14} />
        </button>
        <button
          onClick={() => onPageChange?.(totalPages - 1)}
          disabled={!canGoNext}
          className={styles.pageBtn}
          title="Last page"
        >
          <ChevronsRight size={14} />
        </button>
      </div>

      {/* Row range */}
      <span className={styles.rowCount}>
        {totalCount > 0
          ? `${startRow}-${endRow} of ${totalCount.toLocaleString()}`
          : "0 rows"}
      </span>
    </div>
  );
});
