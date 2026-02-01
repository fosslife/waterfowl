import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MoveLeft, Database, Server, Key, Zap } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { FormSkeleton } from "../components/ui/Skeleton";
import { useConnections } from "../context/ConnectionsContext";
import { useToast } from "../context/ToastContext";
import { useNavigate, useParams } from "react-router-dom";

export function NewConnection() {
  const navigate = useNavigate();
  const { id } = useParams(); // If present, we are editing
  const { refreshConnections } = useConnections();
  const toast = useToast();
  const [formData, setFormData] = useState({
    name: "My Postgres",
    host: "localhost",
    port: "5432",
    user: "postgres",
    password: "",
    database: "postgres",
    driver: "postgres",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    if (id) {
      setIsFetching(true);
      invoke("get_connection", { id })
        .then((conn: any) => {
          setFormData({
            name: conn.name,
            host: conn.host,
            port: conn.port,
            user: conn.user,
            password: conn.password || "",
            database: conn.database,
            driver: conn.driver,
          });
        })
        .catch(console.error)
        .finally(() => setIsFetching(false));
    }
  }, [id]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.id]: e.target.value }));
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    try {
      await invoke("test_connection", { connection: formData });
      toast.success(
        `Successfully connected to ${formData.host}:${formData.port}/${formData.database}`
      );
    } catch (error: any) {
      toast.error(`Connection failed: ${error}`);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await invoke("save_connection", {
        connection: { ...formData, id: id || undefined },
      });
      await refreshConnections();
      toast.success(
        id ? "Connection updated successfully" : "Connection saved successfully"
      );
      navigate("/");
    } catch (error: any) {
      console.error("Failed to save connection:", error);
      toast.error(`Failed to save connection: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  if (isFetching) {
    return (
      <div
        style={{
          maxWidth: 640,
          margin: "0 auto",
          padding: "48px 32px",
          height: "100%",
          overflowY: "auto",
        }}
      >
        <div style={{ marginBottom: 32 }}>
          <div
            style={{
              width: 60,
              height: 16,
              background: "var(--color-base-200)",
              borderRadius: 4,
              marginBottom: 16,
            }}
          />
          <div
            style={{
              width: 200,
              height: 28,
              background: "var(--color-base-200)",
              borderRadius: 4,
              marginBottom: 8,
            }}
          />
          <div
            style={{
              width: 280,
              height: 16,
              background: "var(--color-base-200)",
              borderRadius: 4,
            }}
          />
        </div>
        <div
          style={{
            padding: 24,
            background: "var(--color-base-100)",
            borderRadius: 8,
            border: "1px solid var(--border-subtle)",
          }}
        >
          <FormSkeleton fields={5} />
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: "48px 32px",
        height: "100%",
        overflowY: "auto",
      }}
    >
      <div style={{ marginBottom: 32 }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "var(--color-text-tertiary)",
            background: "transparent",
            marginBottom: 16,
            fontSize: "var(--text-sm)",
            transition: "color var(--transition-fast)",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.color = "var(--color-accent-primary)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.color = "var(--color-text-tertiary)")
          }
        >
          <MoveLeft size={16} />
          Back
        </button>
        <h1
          style={{
            fontSize: "var(--text-2xl)",
            fontWeight: "var(--weight-bold)",
            color: "var(--color-text-primary)",
            marginBottom: 4,
          }}
        >
          {id ? "Edit Connection" : "New Connection"}
        </h1>
        <p style={{ color: "var(--color-text-secondary)" }}>
          {id
            ? "Update your database connection details"
            : "Configure a new PostgreSQL database connection"}
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 24,
          paddingBottom: 32,
        }}
      >
        {/* General Info Card */}
        <div
          style={{
            padding: 24,
            borderRadius: 8,
            border: "1px solid var(--border-subtle)",
            background: "var(--color-base-100)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 20,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 6,
                background: "rgba(0, 243, 255, 0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Database
                size={16}
                style={{ color: "var(--color-accent-primary)" }}
              />
            </div>
            <h2
              style={{
                fontSize: "var(--text-base)",
                fontWeight: "var(--weight-medium)",
                color: "var(--color-text-primary)",
              }}
            >
              General Info
            </h2>
          </div>
          <Input
            id="name"
            label="Connection Name (Alias)"
            placeholder="e.g. Production DB"
            value={formData.name}
            onChange={handleChange}
          />
        </div>

        {/* Connection Details Card */}
        <div
          style={{
            padding: 24,
            borderRadius: 8,
            border: "1px solid var(--border-subtle)",
            background: "var(--color-base-100)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 20,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 6,
                background: "rgba(0, 243, 255, 0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Server
                size={16}
                style={{ color: "var(--color-accent-primary)" }}
              />
            </div>
            <h2
              style={{
                fontSize: "var(--text-base)",
                fontWeight: "var(--weight-medium)",
                color: "var(--color-text-primary)",
              }}
            >
              Server Connection
            </h2>
          </div>

          <div
            style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}
          >
            <Input
              id="host"
              label="Host"
              placeholder="localhost"
              value={formData.host}
              onChange={handleChange}
            />
            <Input
              id="port"
              label="Port"
              placeholder="5432"
              value={formData.port}
              onChange={handleChange}
            />
          </div>

          <div style={{ marginTop: 16 }}>
            <Input
              id="database"
              label="Database Name"
              placeholder="postgres"
              value={formData.database}
              onChange={handleChange}
            />
          </div>
        </div>

        {/* Authentication Card */}
        <div
          style={{
            padding: 24,
            borderRadius: 8,
            border: "1px solid var(--border-subtle)",
            background: "var(--color-base-100)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 20,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 6,
                background: "rgba(0, 243, 255, 0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Key size={16} style={{ color: "var(--color-accent-primary)" }} />
            </div>
            <h2
              style={{
                fontSize: "var(--text-base)",
                fontWeight: "var(--weight-medium)",
                color: "var(--color-text-primary)",
              }}
            >
              Authentication
            </h2>
          </div>

          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
          >
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
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 8,
          }}
        >
          <Button
            type="button"
            variant="secondary"
            onClick={handleTestConnection}
            disabled={isLoading || isTesting}
            isLoading={isTesting}
          >
            <Zap size={14} />
            Test Connection
          </Button>
          <div style={{ display: "flex", gap: 12 }}>
            <Button
              type="button"
              variant="ghost"
              onClick={() => navigate(-1)}
              disabled={isLoading || isTesting}
            >
              Cancel
            </Button>
            <Button type="submit" isLoading={isLoading} disabled={isTesting}>
              {id ? "Update Connection" : "Save Connection"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
