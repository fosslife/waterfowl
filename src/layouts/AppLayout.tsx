import {
  Database,
  Plus,
  Settings,
  Circle,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { NavLink, Outlet, useParams, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import clsx from "clsx";
import { useConnections } from "../context/ConnectionsContext";
import { useNewConnectionModal } from "../context/NewConnectionModalContext";
import styles from "./AppLayout.module.css";

export function AppLayout() {
  const { connections } = useConnections();
  const { openNewConnectionModal } = useNewConnectionModal();
  const { id: activeConnectionId } = useParams();
  const location = useLocation();

  const isInConnection = location.pathname.startsWith("/connection/");
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    if (isInConnection) {
      setIsCollapsed(true);
    }
  }, [isInConnection]);

  return (
    <div className={styles.layout}>
      <aside className={clsx(styles.sidebar, isCollapsed && styles.collapsed)}>
        <div className={styles.brand}>
          <NavLink to="/" className={styles.logo}>
            <span className={styles.logoText}>WF</span>
            <div className={styles.logoPulse} />
          </NavLink>
          {!isCollapsed && <span className={styles.brandName}>Waterfowl</span>}

          {!isCollapsed && (
            <button
              className={styles.collapseBtn}
              onClick={() => setIsCollapsed(true)}
              title="Collapse sidebar"
            >
              <PanelLeftClose size={14} />
            </button>
          )}
        </div>

        <nav className={styles.nav}>
          {isCollapsed && (
            <button
              className={styles.navItem}
              onClick={() => setIsCollapsed(false)}
              title="Expand sidebar"
            >
              <PanelLeft size={18} />
            </button>
          )}

          {!isCollapsed && (
            <div className={styles.sectionTitle}>
              <span>Actions</span>
            </div>
          )}

          <button
            className={clsx(styles.navItem, styles.addNew)}
            onClick={openNewConnectionModal}
            title="New Connection"
          >
            <Plus size={18} />
            {!isCollapsed && <span>New Connection</span>}
          </button>

          {!isCollapsed && (
            <div
              className={`${styles.sectionTitle} ${styles.connectionsSectionTitle}`}
            >
              <span>Connections</span>
              {connections.length > 0 && (
                <span className={styles.connectionCount}>
                  {connections.length}
                </span>
              )}
            </div>
          )}

          {!isCollapsed && connections.length === 0 && (
            <div className={styles.emptyState}>
              <Database size={20} className={styles.emptyIcon} />
              <span>No connections yet</span>
            </div>
          )}

          <div className={styles.connectionsList}>
            {connections.map((conn) => (
              <NavLink
                key={conn.id}
                to={`/connection/${conn.id}`}
                className={({ isActive }) =>
                  clsx(
                    styles.navItem,
                    styles.connectionItem,
                    isActive && styles.active,
                  )
                }
                title={
                  isCollapsed
                    ? `${conn.name} (${conn.host}:${conn.port})`
                    : undefined
                }
              >
                <div className={styles.connectionIcon}>
                  <Database size={16} />
                  <Circle
                    size={6}
                    className={clsx(
                      styles.statusDot,
                      activeConnectionId === conn.id && styles.statusConnected,
                    )}
                  />
                </div>
                {!isCollapsed && (
                  <div className={styles.connectionInfo}>
                    <span className={styles.connectionName}>{conn.name}</span>
                    <span className={styles.connectionHost}>
                      {conn.host}:{conn.port}
                    </span>
                  </div>
                )}
              </NavLink>
            ))}
          </div>
        </nav>

        <div className={styles.footer}>
          <button className={styles.navItem} title="Settings">
            <Settings size={16} />
            {!isCollapsed && <span>Settings</span>}
          </button>
          {!isCollapsed && <div className={styles.version}>v0.1.0</div>}
        </div>
      </aside>

      <main
        className={clsx(
          styles.content,
          isCollapsed && styles.contentWithCollapsedSidebar,
        )}
      >
        <Outlet />
      </main>
    </div>
  );
}
