import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import {
  getConnections as fetchConnections,
  StoredConnection,
} from "../services/connections";

/**
 * Connection interface used throughout the app.
 * Maps from StoredConnection to a frontend-friendly format.
 */
export interface Connection {
  id: string;
  name: string;
  host: string;
  port: string;
  user: string;
  password?: string | null;
  database: string;
  driver: string;
  default_schema: string;
}

/**
 * Convert stored connection to frontend Connection interface.
 */
function toConnection(stored: StoredConnection): Connection {
  return {
    id: stored.id,
    name: stored.name,
    host: stored.host,
    port: stored.port,
    user: stored.username,
    password: stored.password,
    database: stored.database_name,
    driver: stored.driver,
    default_schema: stored.default_schema,
  };
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
      const storedConnections = await fetchConnections();
      setConnections(storedConnections.map(toConnection));
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
