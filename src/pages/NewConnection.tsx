import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useConnections } from "../context/ConnectionsContext";

export function NewConnection() {
  const navigate = useNavigate();
  const { refreshConnections } = useConnections();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    host: "localhost",
    port: "5432",
    user: "postgres",
    password: "",
    database: "postgres",
    driver: "postgres", // Default
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, [e.target.id]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await invoke("save_connection", { connection: formData });
      await refreshConnections(); // Update list immediately
      navigate("/"); 
    } catch (error) {
      console.error("Failed to save:", error);
      alert("Failed to save connection: " + error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-app">
      {/* Header */}
      <div className="h-[60px] border-b border-subtle flex items-center gap-4 mb-6">
        <button onClick={() => navigate(-1)} className="text-secondary hover:text-primary transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h1 className="font-bold text-lg text-primary">New Connection</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto flex justify-center">
        <form onSubmit={handleSubmit} className="w-full max-w-2xl flex flex-col gap-6 pb-8">
          
          <div className="p-6 rounded-lg border border-subtle bg-card shadow-sm">
            <h2 className="text-base font-medium mb-4 text-accent">General Info</h2>
            <div className="flex flex-col gap-4">
              <Input 
                id="name" 
                label="Connection Name (Alias)" 
                placeholder="e.g. Production DB" 
                value={formData.name}
                onChange={handleChange}
              />
            </div>
          </div>

          <div className="p-6 rounded-lg border border-subtle bg-card shadow-sm">
             <h2 className="text-base font-medium mb-4 text-accent">Connection Details</h2>
             <div className="grid grid-cols-12 gap-4">
                <div className="col-span-8">
                  <Input 
                    id="host" 
                    label="Host" 
                    placeholder="localhost" 
                    value={formData.host}
                    onChange={handleChange}
                  />
                </div>
                <div className="col-span-4">
                  <Input 
                    id="port" 
                    label="Port" 
                    placeholder="5432" 
                    value={formData.port}
                    onChange={handleChange}
                  />
                </div>
             </div>

             <div className="grid grid-cols-2 gap-4 mt-4">
                <Input 
                  id="user" 
                  label="User" 
                  placeholder="postgres" 
                  value={formData.user}
                  onChange={handleChange}
                />
                <Input 
                  id="password" 
                  label="Password" 
                  type="password"
                  placeholder="••••••••" 
                  value={formData.password}
                  onChange={handleChange}
                />
             </div>

             <div className="mt-4">
               <Input 
                  id="database" 
                  label="Database Name" 
                  placeholder="postgres" 
                  value={formData.database}
                  onChange={handleChange}
                />
             </div>
          </div>

          <div className="flex justify-end gap-3 mt-8">
            <Button type="button" variant="ghost" onClick={() => navigate(-1)} disabled={isLoading}>Cancel</Button>
            <Button type="submit" isLoading={isLoading}>Save Connection</Button>
          </div>

        </form>
      </div>
    </div>
  );
}
