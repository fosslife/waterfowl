import { X, Table, Terminal, LayoutDashboard } from "lucide-react";
import { Tab, TabType } from "../../context/TabContext";
import styles from "./TabBar.module.css";
import clsx from "clsx";

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
}

const TAB_ICONS: Record<TabType, React.ReactNode> = {
  dashboard: <LayoutDashboard size={14} />,
  table: <Table size={14} />,
  sql: <Terminal size={14} />,
};

export function TabBar({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
}: TabBarProps) {
  if (tabs.length <= 1) {
    // Don't show tab bar if only dashboard is open
    return null;
  }

  return (
    <div className={styles.tabBar}>
      <div className={styles.tabList}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={clsx(
              styles.tab,
              tab.id === activeTabId && styles.active
            )}
            onClick={() => onTabClick(tab.id)}
            title={tab.title}
          >
            <span className={styles.tabIcon} data-type={tab.type}>
              {TAB_ICONS[tab.type]}
            </span>
            <span className={styles.tabTitle}>{tab.title}</span>
            {tab.type !== "dashboard" && (
              <button
                className={styles.closeBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onTabClose(tab.id);
                }}
                title="Close tab"
              >
                <X size={12} />
              </button>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
