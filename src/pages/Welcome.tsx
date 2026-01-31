import { Button } from "../components/ui/Button";
import { Link } from "react-router-dom";
import { Database } from "lucide-react";

export function Welcome() {
  return (
    <div className="h-full flex flex-col items-center justify-center p-8 text-center">
      <div className="mb-6 p-4 rounded-full bg-base-100 border border-subtle">
        <Database size={48} className="text-secondary" />
      </div>
      <h1 className="text-2xl font-bold mb-2">No Connections Yet</h1>
      <p className="text-secondary mb-8 max-w-sm">
        Connect to your database to start managing your data. 
        Waterfowl supports PostgreSQL out of the box.
      </p>
      <Link to="/new-connection">
        <Button size="lg">Add New Connection</Button>
      </Link>
    </div>
  );
}
