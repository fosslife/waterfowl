import {
  Database,
  Plus,
  Settings,
  Circle,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { NavLink, Outlet, useParams, useLocation } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import clsx from "clsx";
import { useConnections } from "../context/ConnectionsContext";
import styles from "./AppLayout.module.css";

const HOVER_DELAY_MS = 400;

export function AppLayout() {
  const { connections } = useConnections();
  const { id: activeConnectionId } = useParams();
  const location = useLocation();

  // Auto-collapse when viewing a connection
  const isInConnection = location.pathname.startsWith("/connection/");
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = useRef<number | null>(null);

  // Auto-collapse when entering a connection view
  useEffect(() => {
    if (isInConnection) {
      setIsCollapsed(true);
    }
  }, [isInConnection]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  const handleMouseEnter = () => {
    if (!isCollapsed) return;

    // Clear any existing timeout
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    // Delay before expanding to filter out accidental hovers
    hoverTimeoutRef.current = window.setTimeout(() => {
      setIsHovered(true);
    }, HOVER_DELAY_MS);
  };

  const handleMouseLeave = () => {
    // Cancel pending hover
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsHovered(false);
  };

  const showExpanded = !isCollapsed || isHovered;

  return (
    <div className={styles.layout}>
      <aside
        className={clsx(
          styles.sidebar,
          isCollapsed && styles.collapsed,
          isCollapsed && isHovered && styles.hoveredOpen,
        )}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className={styles.brand}>
          <NavLink to="/" className={styles.logo}>
            <span className={styles.logoText}>WF</span>
            <div className={styles.logoPulse} />
          </NavLink>
          {showExpanded && <span className={styles.brandName}>Waterfowl</span>}

          {showExpanded && (
            <button
              className={styles.collapseBtn}
              onClick={() => {
                setIsCollapsed(!isCollapsed);
                setIsHovered(false);
              }}
              title={isCollapsed ? "Pin sidebar" : "Collapse sidebar"}
            >
              {isCollapsed ? (
                <PanelLeft size={14} />
              ) : (
                <PanelLeftClose size={14} />
              )}
            </button>
          )}
        </div>

        <nav className={styles.nav}>
          {showExpanded && (
            <div className={styles.sectionTitle}>
              <span>Actions</span>
            </div>
          )}

          <NavLink
            to="/connection/new"
            className={({ isActive }) =>
              clsx(styles.navItem, styles.addNew, isActive && styles.active)
            }
            title="New Connection"
          >
            <Plus size={18} />
            {showExpanded && <span>New Connection</span>}
          </NavLink>

          {showExpanded && (
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

          {showExpanded && connections.length === 0 && (
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
                  !showExpanded
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
                {showExpanded && (
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
            {showExpanded && <span>Settings</span>}
          </button>
          {showExpanded && <div className={styles.version}>v0.1.0</div>}
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
