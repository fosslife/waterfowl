import { Button } from "../components/ui/Button";
import { Link } from "react-router-dom";
import { Database, Zap, Shield, Terminal } from "lucide-react";
import { useConnections } from "../context/ConnectionsContext";
import styles from "./Welcome.module.css";

export function Welcome() {
  const { connections } = useConnections();
  const hasConnections = connections.length > 0;

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
          <Button size="lg">
            {hasConnections
              ? "Create New Connection"
              : "Create First Connection"}
          </Button>
        </Link>

        <p className={styles.footnote}>PostgreSQL 12+ supported</p>
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
