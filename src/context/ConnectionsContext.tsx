import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { invoke } from "@tauri-apps/api/core";

export interface Connection {
  id: string;
  name: string;
  host: string;
  port: string;
  user: string;
  database: string;
  driver: string;
  default_schema: string;
}

interface ConnectionsContextType {
  connections: Connection[];
  isLoading: boolean;
  refreshConnections: () => Promise<void>;
}

const ConnectionsContext = createContext<ConnectionsContextType | undefined>(
  undefined
);

export function ConnectionsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshConnections = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await invoke<Connection[]>("get_connections");
      setConnections(result);
    } catch (e) {
      console.error("Failed to fetch connections:", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshConnections();
  }, [refreshConnections]);

  return (
    <ConnectionsContext.Provider
      value={{ connections, isLoading, refreshConnections }}
    >
      {children}
    </ConnectionsContext.Provider>
  );
}

export function useConnections() {
  const context = useContext(ConnectionsContext);
  if (context === undefined) {
    throw new Error("useConnections must be used within a ConnectionsProvider");
  }
  return context;
}
