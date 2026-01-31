import { Database, Plus, Settings } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import { useConnections } from '../context/ConnectionsContext';
import styles from './AppLayout.module.css';

export function AppLayout() {
  const { connections } = useConnections();

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.logo}>WF</div>
          <span className={styles.brandName}>Waterfowl</span>
        </div>

        <nav className={styles.nav}>
          <div className={styles.sectionTitle}>Connections</div>
          
          <NavLink 
            to="/new-connection" 
            className={({ isActive }) => clsx(styles.navItem, isActive && styles.active)}
          >
            <Plus size={18} />
            <span>New Connection</span>
          </NavLink>

          <div className={styles.sectionTitle} style={{ marginTop: '1rem' }}>Saved</div>
          
          {connections.length === 0 && (
             <div style={{ padding: '0 1rem', fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                No connections
             </div>
          )}

          {connections.map(conn => (
            <NavLink 
              key={conn.id}
              to={`/connection/${conn.id}`} 
              className={({ isActive }) => clsx(styles.navItem, isActive && styles.active)}
            >
              <Database size={18} />
              <span>{conn.name}</span>
            </NavLink>
          ))}
        </nav>

        <div className={styles.footer}>
          <button className={styles.navItem}>
            <Settings size={18} />
            <span>Settings</span>
          </button>
        </div>
      </aside>

      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}
