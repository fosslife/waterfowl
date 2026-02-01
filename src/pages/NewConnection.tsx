import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MoveLeft, Database, Server, Key, Zap } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { FormSkeleton } from "../components/ui/Skeleton";
import { useConnections } from "../context/ConnectionsContext";
import { useToast } from "../context/ToastContext";
import { useNavigate, useParams } from "react-router-dom";
import styles from "./NewConnection.module.css";

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
      <div className={styles.page}>
        <div className={styles.header}>
          <div className={`${styles.skeletonBar} ${styles.skeletonTitle}`} />
          <div className={`${styles.skeletonBar} ${styles.skeletonHeading}`} />
          <div className={`${styles.skeletonBar} ${styles.skeletonSubtitle}`} />
        </div>
        <div className={styles.skeletonCard}>
          <FormSkeleton fields={5} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button onClick={() => navigate(-1)} className={styles.backButton}>
          <MoveLeft size={16} />
          Back
        </button>
        <h1 className={styles.title}>
          {id ? "Edit Connection" : "New Connection"}
        </h1>
        <p className={styles.subtitle}>
          {id
            ? "Update your database connection details"
            : "Configure a new PostgreSQL database connection"}
        </p>
      </div>

      <form onSubmit={handleSubmit} className={styles.form}>
        {/* General Info Card */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardIconWrapper}>
              <Database size={16} className={styles.cardIcon} />
            </div>
            <h2 className={styles.cardTitle}>General Info</h2>
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
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardIconWrapper}>
              <Server size={16} className={styles.cardIcon} />
            </div>
            <h2 className={styles.cardTitle}>Server Connection</h2>
          </div>

          <div className={styles.gridTwoThird}>
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

          <div className={styles.fieldSpacing}>
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
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardIconWrapper}>
              <Key size={16} className={styles.cardIcon} />
            </div>
            <h2 className={styles.cardTitle}>Authentication</h2>
          </div>

          <div className={styles.gridHalf}>
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

        <div className={styles.actions}>
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
          <div className={styles.actionGroup}>
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
