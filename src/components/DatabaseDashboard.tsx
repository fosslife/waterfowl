import {
  Database,
  Table,
  Eye,
  Code2,
  Hash,
  HardDrive,
  Server,
  Loader2,
  Terminal,
} from "lucide-react";
import styles from "./DatabaseDashboard.module.css";

export interface DatabaseInfo {
  version: string;
  database_name: string;
  database_size: string;
  total_tables: number;
  total_views: number;
  total_functions: number;
  total_sequences: number;
}

interface DatabaseDashboardProps {
  info: DatabaseInfo | null;
  isLoading: boolean;
  connectionName: string;
  connectionHost: string;
  onOpenSqlEditor?: () => void;
}

export function DatabaseDashboard({
  info,
  isLoading,
  connectionName,
  connectionHost,
}: DatabaseDashboardProps) {
  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Loader2 size={24} className={styles.spinner} />
        <span>Loading database info...</span>
      </div>
    );
  }

  if (!info) {
    return (
      <div className={styles.loading}>
        <span>Unable to load database info</span>
      </div>
    );
  }

  // Parse PostgreSQL version for display
  const versionMatch = info.version.match(/PostgreSQL (\d+\.\d+)/);
  const pgVersion = versionMatch ? versionMatch[1] : info.version.split(" ")[0];

  return (
    <div className={styles.dashboard}>
      <div className={styles.header}>
        <h1 className={styles.title}>{connectionName}</h1>
        <p className={styles.subtitle}>{connectionHost}</p>
      </div>

      {/* Stats Grid */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statHeader}>
            <div className={styles.statIconWrapper} data-variant="primary">
              <Table size={18} />
            </div>
            <span className={styles.statLabel}>Tables</span>
          </div>
          <div className={styles.statValue}>{info.total_tables}</div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statHeader}>
            <div className={styles.statIconWrapper} data-variant="success">
              <Eye size={18} />
            </div>
            <span className={styles.statLabel}>Views</span>
          </div>
          <div className={styles.statValue}>{info.total_views}</div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statHeader}>
            <div className={styles.statIconWrapper} data-variant="warning">
              <Code2 size={18} />
            </div>
            <span className={styles.statLabel}>Functions</span>
          </div>
          <div className={styles.statValue}>{info.total_functions}</div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statHeader}>
            <div className={styles.statIconWrapper} data-variant="secondary">
              <Hash size={18} />
            </div>
            <span className={styles.statLabel}>Sequences</span>
          </div>
          <div className={styles.statValue}>{info.total_sequences}</div>
        </div>
      </div>

      {/* Server Info */}
      <div className={styles.infoSection}>
        <h2 className={styles.infoTitle}>
          <Server size={16} className={styles.infoTitleIcon} />
          Server Information
        </h2>
        <div className={styles.infoGrid}>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>PostgreSQL Version</span>
            <span className={styles.infoValue}>{pgVersion}</span>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>Database</span>
            <span className={styles.infoValue}>{info.database_name}</span>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>Size</span>
            <span className={styles.infoValue}>{info.database_size}</span>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className={styles.actionsSection}>
        <h2 className={styles.actionsTitle}>Quick Actions</h2>
        <div className={styles.actionsGrid}>
          <button className={styles.actionBtn} disabled title="Coming soon">
            <Terminal size={16} className={styles.actionIcon} />
            Open SQL Editor
          </button>
        </div>
      </div>
    </div>
  );
}
