import { Button } from "../components/ui/Button";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  Database,
  Zap,
  Shield,
  Terminal,
  Plus,
  Server,
  Keyboard,
  Lightbulb,
  ArrowRight,
} from "lucide-react";
import { useConnections, Connection } from "../context/ConnectionsContext";
import { getRecentConnectionIds } from "../services/connections";
import styles from "./Welcome.module.css";

export function Welcome() {
  const { connections, isLoading } = useConnections();
  const [recentConnections, setRecentConnections] = useState<Connection[]>([]);
  const hasConnections = connections.length > 0;

  // Load recent connections sorted by last used
  useEffect(() => {
    async function loadRecent() {
      if (connections.length === 0) {
        setRecentConnections([]);
        return;
      }

      try {
        const recentIds = await getRecentConnectionIds();
        const connectionMap = new Map(connections.map((c) => [c.id, c]));

        // Build list: first from recent IDs, then remaining connections
        const orderedConnections: Connection[] = [];
        const usedIds = new Set<string>();

        // Add recently used connections first (in order of recency)
        for (const id of recentIds) {
          const conn = connectionMap.get(id);
          if (conn) {
            orderedConnections.push(conn);
            usedIds.add(id);
          }
        }

        // Add remaining connections that weren't recently used
        for (const conn of connections) {
          if (!usedIds.has(conn.id)) {
            orderedConnections.push(conn);
          }
        }

        // Limit to top 5
        setRecentConnections(orderedConnections.slice(0, 5));
      } catch (e) {
        console.error("Failed to load recent connections:", e);
        // Fallback to first 5 connections
        setRecentConnections(connections.slice(0, 5));
      }
    }

    loadRecent();
  }, [connections]);

  // Show first-time experience when no connections
  if (!hasConnections && !isLoading) {
    return <FirstTimeExperience />;
  }

  // Show dashboard with connections when they exist
  return (
    <div className={styles.page}>
      {/* Background grid pattern */}
      <div className={styles.bgGrid} />

      {/* Animated accent circle */}
      <div className={styles.accentCircle} />

      <div className={styles.dashboardContent}>
        {/* Header section */}
        <div className={styles.dashboardHeader}>
          <div className={styles.headerIcon}>
            <span className={styles.headerIconText}>WF</span>
          </div>
          <div>
            <h1 className={styles.dashboardTitle}>Welcome back</h1>
            <p className={styles.dashboardSubtitle}>
              Select a connection to get started
            </p>
          </div>
        </div>

        {/* Two-column layout */}
        <div className={styles.columnsContainer}>
          {/* Left column: Recent Connections */}
          <div className={styles.column}>
            <div className={styles.columnHeader}>
              <Server size={16} />
              <span>Recent Connections</span>
            </div>
            <div className={styles.connectionsList}>
              {recentConnections.map((conn) => (
                <ConnectionCard key={conn.id} connection={conn} />
              ))}
            </div>
            <Link to="/new-connection" className={styles.newConnectionLink}>
              <div className={styles.newConnectionCard}>
                <div className={styles.newConnectionIcon}>
                  <Plus size={20} />
                </div>
                <span>Add New Connection</span>
                <ArrowRight size={16} className={styles.arrowIcon} />
              </div>
            </Link>
          </div>

          {/* Right column: Quick Tips & Shortcuts */}
          <div className={styles.column}>
            <div className={styles.columnHeader}>
              <Lightbulb size={16} />
              <span>Quick Tips</span>
            </div>
            <div className={styles.tipsList}>
              <TipCard
                icon={<Keyboard size={18} />}
                title="Keyboard Shortcuts"
                description="Coming soon! Quick keyboard shortcuts for power users."
              />
              <TipCard
                icon={<Terminal size={18} />}
                title="SQL Editor"
                description="Write and execute raw SQL queries with syntax highlighting."
              />
              <TipCard
                icon={<Shield size={18} />}
                title="Secure Connections"
                description="All connections are stored locally with encrypted passwords."
              />
              <TipCard
                icon={<Zap size={18} />}
                title="Fast Navigation"
                description="Browse schemas, tables, and columns with instant search."
              />
            </div>
          </div>
        </div>

        <p className={styles.versionNote}>Waterfowl · PostgreSQL 12+</p>
      </div>
    </div>
  );
}

// First-time experience for new users
function FirstTimeExperience() {
  return (
    <div className={styles.page}>
      {/* Background grid pattern */}
      <div className={styles.bgGrid} />

      {/* Animated accent circle */}
      <div className={styles.accentCircle} />

      <div className={styles.content}>
        {/* Icon with glow effect */}
        <div className={styles.iconContainer}>
          <div className={styles.iconGlow} />
          <div className={styles.iconBox}>
            <Database size={56} className={styles.icon} />
          </div>
        </div>

        <h1 className={styles.title}>Welcome to Waterfowl</h1>

        <p className={styles.subtitle}>
          A precision database management tool for PostgreSQL. Fast, secure, and
          built for power users.
        </p>

        {/* Feature pills */}
        <div className={styles.features}>
          <FeaturePill icon={<Zap size={14} />} text="Lightning Fast" />
          <FeaturePill icon={<Shield size={14} />} text="Secure by Default" />
          <FeaturePill icon={<Terminal size={14} />} text="Raw SQL Access" />
        </div>

        <Link to="/new-connection">
          <Button size="lg">Create First Connection</Button>
        </Link>

        <p className={styles.footnote}>PostgreSQL 12+ supported</p>
      </div>
    </div>
  );
}

function ConnectionCard({ connection }: { connection: Connection }) {
  return (
    <Link
      to={`/connection/${connection.id}`}
      className={styles.connectionCardLink}
    >
      <div className={styles.connectionCard}>
        <div className={styles.connectionIcon}>
          <Database size={18} />
        </div>
        <div className={styles.connectionInfo}>
          <span className={styles.connectionName}>{connection.name}</span>
          <span className={styles.connectionDetails}>
            {connection.host}:{connection.port}/{connection.database}
          </span>
        </div>
        <ArrowRight size={16} className={styles.arrowIcon} />
      </div>
    </Link>
  );
}

function TipCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className={styles.tipCard}>
      <div className={styles.tipIcon}>{icon}</div>
      <div className={styles.tipContent}>
        <span className={styles.tipTitle}>{title}</span>
        <span className={styles.tipDescription}>{description}</span>
      </div>
    </div>
  );
}

function FeaturePill({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className={styles.featurePill}>
      <span className={styles.featurePillIcon}>{icon}</span>
      {text}
    </div>
  );
}
