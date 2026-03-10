import clsx from "clsx";
import styles from "./Skeleton.module.css";

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  variant?: "text" | "circular" | "rectangular";
  animation?: "pulse" | "wave" | "none";
}

export function Skeleton({
  className,
  width,
  height,
  variant = "text",
  animation = "wave",
}: SkeletonProps) {
  return (
    <div
      className={clsx(
        styles.skeleton,
        styles[variant],
        styles[animation],
        className
      )}
      style={{ width, height }}
    />
  );
}

// Table loading skeleton
export function TableSkeleton({
  rows = 5,
  columns = 4,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className={styles.tableSkeleton}>
      {/* Header */}
      <div className={styles.tableHeader}>
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} height={16} className={styles.headerCell} />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className={styles.tableRow}>
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton
              key={colIndex}
              height={14}
              width={`${60 + Math.random() * 30}%`}
              className={styles.cell}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// Form skeleton
export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div className={styles.formSkeleton}>
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className={styles.formField}>
          <Skeleton height={12} width={80} className={styles.label} />
          <Skeleton height={40} className={styles.input} />
        </div>
      ))}
    </div>
  );
}
