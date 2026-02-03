import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react";

// Tab types
export type TabType = "dashboard" | "table" | "view" | "function" | "sequence" | "structure" | "sql";

export interface BaseTab {
  id: string;
  type: TabType;
  title: string;
}

export interface DashboardTab extends BaseTab {
  type: "dashboard";
}

export interface TableTab extends BaseTab {
  type: "table";
  schema: string;
  tableName: string;
}

export interface ViewTab extends BaseTab {
  type: "view";
  schema: string;
  viewName: string;
}

export interface FunctionTab extends BaseTab {
  type: "function";
  schema: string;
  functionName: string;
}

export interface SequenceTab extends BaseTab {
  type: "sequence";
  schema: string;
  sequenceName: string;
}

export interface StructureTab extends BaseTab {
  type: "structure";
  schema: string;
  tableName: string;
}

export interface SqlTab extends BaseTab {
  type: "sql";
  queryContent: string;
  // Optional: for saved queries
  queryId?: string;
}

export type Tab = DashboardTab | TableTab | ViewTab | FunctionTab | SequenceTab | StructureTab | SqlTab;

// Type for creating new tabs (without id)
export type NewDashboardTab = Omit<DashboardTab, "id">;
export type NewTableTab = Omit<TableTab, "id">;
export type NewViewTab = Omit<ViewTab, "id">;
export type NewFunctionTab = Omit<FunctionTab, "id">;
export type NewSequenceTab = Omit<SequenceTab, "id">;
export type NewStructureTab = Omit<StructureTab, "id">;
export type NewSqlTab = Omit<SqlTab, "id">;
export type NewTab = NewDashboardTab | NewTableTab | NewViewTab | NewFunctionTab | NewSequenceTab | NewStructureTab | NewSqlTab;

interface TabContextValue {
  tabs: Tab[];
  activeTabId: string | null;

  // Actions
  openTab: (tab: NewTab) => string;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTab: (tabId: string, updates: Partial<Tab>) => void;

  // Helpers
  findTableTab: (schema: string, tableName: string) => Tab | undefined;
  getActiveTab: () => Tab | undefined;
}

const TabContext = createContext<TabContextValue | null>(null);

interface TabProviderProps {
  children: ReactNode;
}

export function TabProvider({ children }: TabProviderProps) {
  // Initialize with dashboard tab
  const [tabs, setTabs] = useState<Tab[]>([
    { id: "dashboard", type: "dashboard", title: "Overview" },
  ]);
  const [activeTabId, setActiveTabId] = useState<string | null>("dashboard");

  const generateId = () => crypto.randomUUID();

  const openTab = useCallback(
    (tabData: NewTab): string => {
      // For table tabs, check if already open
      if (tabData.type === "table") {
        const tableData = tabData as NewTableTab;
        const existing = tabs.find(
          (t) =>
            t.type === "table" &&
            (t as TableTab).schema === tableData.schema &&
            (t as TableTab).tableName === tableData.tableName
        );
        if (existing) {
          setActiveTabId(existing.id);
          return existing.id;
        }
      }

      // For view tabs, check if already open
      if (tabData.type === "view") {
        const viewData = tabData as NewViewTab;
        const existing = tabs.find(
          (t) =>
            t.type === "view" &&
            (t as ViewTab).schema === viewData.schema &&
            (t as ViewTab).viewName === viewData.viewName
        );
        if (existing) {
          setActiveTabId(existing.id);
          return existing.id;
        }
      }

      // For function tabs, check if already open
      if (tabData.type === "function") {
        const funcData = tabData as NewFunctionTab;
        const existing = tabs.find(
          (t) =>
            t.type === "function" &&
            (t as FunctionTab).schema === funcData.schema &&
            (t as FunctionTab).functionName === funcData.functionName
        );
        if (existing) {
          setActiveTabId(existing.id);
          return existing.id;
        }
      }

      // For sequence tabs, check if already open
      if (tabData.type === "sequence") {
        const seqData = tabData as NewSequenceTab;
        const existing = tabs.find(
          (t) =>
            t.type === "sequence" &&
            (t as SequenceTab).schema === seqData.schema &&
            (t as SequenceTab).sequenceName === seqData.sequenceName
        );
        if (existing) {
          setActiveTabId(existing.id);
          return existing.id;
        }
      }

      // For structure tabs, check if already open
      if (tabData.type === "structure") {
        const structData = tabData as NewStructureTab;
        const existing = tabs.find(
          (t) =>
            t.type === "structure" &&
            (t as StructureTab).schema === structData.schema &&
            (t as StructureTab).tableName === structData.tableName
        );
        if (existing) {
          setActiveTabId(existing.id);
          return existing.id;
        }
      }

      const newTab: Tab = {
        ...tabData,
        id: generateId(),
      } as Tab;

      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
      return newTab.id;
    },
    [tabs]
  );

  const closeTab = useCallback(
    (tabId: string) => {
      // Don't close dashboard tab
      if (tabId === "dashboard") return;

      setTabs((prev) => {
        const index = prev.findIndex((t) => t.id === tabId);
        const newTabs = prev.filter((t) => t.id !== tabId);

        // If closing active tab, switch to adjacent tab
        if (activeTabId === tabId && newTabs.length > 0) {
          // Try to select the tab to the left, or the first tab
          const newActiveIndex = Math.max(0, index - 1);
          setActiveTabId(newTabs[newActiveIndex]?.id || "dashboard");
        }

        return newTabs;
      });
    },
    [activeTabId]
  );

  const setActiveTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  const updateTab = useCallback((tabId: string, updates: Partial<Tab>) => {
    setTabs((prev) =>
      prev.map((tab) => (tab.id === tabId ? ({ ...tab, ...updates } as Tab) : tab))
    );
  }, []);

  const findTableTab = useCallback(
    (schema: string, tableName: string): Tab | undefined => {
      return tabs.find(
        (t) =>
          t.type === "table" && t.schema === schema && t.tableName === tableName
      );
    },
    [tabs]
  );

  const getActiveTab = useCallback((): Tab | undefined => {
    return tabs.find((t) => t.id === activeTabId);
  }, [tabs, activeTabId]);

  return (
    <TabContext.Provider
      value={{
        tabs,
        activeTabId,
        openTab,
        closeTab,
        setActiveTab,
        updateTab,
        findTableTab,
        getActiveTab,
      }}
    >
      {children}
    </TabContext.Provider>
  );
}

export function useTabs() {
  const context = useContext(TabContext);
  if (!context) {
    throw new Error("useTabs must be used within a TabProvider");
  }
  return context;
}
