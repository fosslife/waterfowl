import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Table, Search } from "lucide-react";

export function ConnectionDetails() {
  const { id } = useParams();
  const [tables, setTables] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    async function init() {
      if (!id) return;
      setIsLoading(true);
      setError(null);
      try {
        // 1. Establish connection (Rust creates pool)
        await invoke("establish_connection", { id });
        
        // 2. Fetch tables
        const tablesList = await invoke<string[]>("get_tables", { id });
        setTables(tablesList);
      } catch (e: any) {
        console.error(e);
        setError(e.toString());
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, [id]);

  const filteredTables = tables.filter(t => t.toLowerCase().includes(filter.toLowerCase()));

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-8 text-center text-accent-secondary">
        <div>
          <h2 className="text-lg font-bold mb-2">Connection Failed</h2>
          <p className="font-mono text-sm bg-base-100 p-4 rounded border border-accent-secondary/50">
            {error}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {/* Tables Sidebar */}
      <div className="w-64 border-r border-subtle flex flex-col bg-base-50">
        <div className="p-4 border-b border-subtle">
           <div className="relative">
             <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
             <input 
                className="w-full bg-base-100 border border-subtle rounded-md pl-9 pr-2 py-1.5 text-xs text-primary focus:outline-none focus:border-accent-primary"
                placeholder="Search tables..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
             />
           </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2">
            {isLoading && (
                <div className="text-xs text-text-tertiary p-2 text-center">Loading schema...</div>
            )}
            
            {!isLoading && filteredTables.length === 0 && (
                <div className="text-xs text-text-tertiary p-2 text-center">No tables found</div>
            )}

            {filteredTables.map(table => (
                <button 
                  key={table}
                  className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:text-primary hover:bg-base-200 rounded-md flex items-center gap-2 transition-colors group"
                >
                    <Table size={14} className="text-text-tertiary group-hover:text-accent-primary" />
                    <span className="truncate">{table}</span>
                </button>
            ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 bg-app flex flex-col items-center justify-center text-text-tertiary">
          <Table size={48} className="mb-4 opacity-20" />
          <p className="text-sm">Select a table to view data</p>
      </div>
    </div>
  );
}
