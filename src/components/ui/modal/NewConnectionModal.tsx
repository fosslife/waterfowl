import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { Database, Server, Key, Zap, X, Plus } from "lucide-react";
import { Button } from "@components/ui/button/Button";
import { Input } from "@components/ui/input/Input";
import { useConnections } from "@context/ConnectionsContext";
import { useToast } from "@context/ToastContext";
import { saveConnection } from "@services/connections";
import styles from "./NewConnectionModal.module.css";

const INITIAL_FORM_DATA = {
  name: "My Postgres",
  host: "localhost",
  port: "5432",
  user: "postgres",
  password: "",
  database: "postgres",
  driver: "postgres",
  default_schema: "public",
};

interface NewConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NewConnectionModal({
  isOpen,
  onClose,
}: NewConnectionModalProps) {
  const { refreshConnections } = useConnections();
  const toast = useToast();
  const [formData, setFormData] = useState({ ...INITIAL_FORM_DATA });
  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setFormData({ ...INITIAL_FORM_DATA });
      setIsLoading(false);
      setIsTesting(false);
    }
  }, [isOpen]);

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isLoading && !isTesting) onClose();
    },
    [onClose, isLoading, isTesting],
  );

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, handleEscape]);

  if (!isOpen) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.id]: e.target.value }));
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    try {
      await invoke("test_connection", {
        connection: {
          name: formData.name,
          host: formData.host,
          port: formData.port,
          user: formData.user,
          password: formData.password || null,
          database: formData.database,
          driver: formData.driver,
          default_schema: formData.default_schema,
        },
      });
      toast.success(
        `Successfully connected to ${formData.host}:${formData.port}/${formData.database}`,
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
      await saveConnection({
        name: formData.name,
        host: formData.host,
        port: formData.port,
        username: formData.user,
        password: formData.password || null,
        database_name: formData.database,
        driver: formData.driver,
        default_schema: formData.default_schema,
      });
      await refreshConnections();
      toast.success("Connection saved successfully");
      onClose();
    } catch (error: any) {
      console.error("Failed to save connection:", error);
      toast.error(`Failed to save connection: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  const busy = isLoading || isTesting;

  return createPortal(
    <div
      className={styles.overlay}
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="new-conn-title"
      >
        <div className={styles.header}>
          <div className={styles.headerIcon}>
            <Plus size={16} />
          </div>
          <div className={styles.titleGroup}>
            <h2 id="new-conn-title" className={styles.title}>
              New Connection
            </h2>
            <p className={styles.subtitle}>
              Configure a new PostgreSQL database connection
            </p>
          </div>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            disabled={busy}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className={styles.body}>
          <form
            id="new-connection-form"
            onSubmit={handleSubmit}
            className={styles.form}
          >
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardIconWrapper}>
                  <Database size={14} className={styles.cardIcon} />
                </div>
                <h3 className={styles.cardTitle}>General Info</h3>
              </div>
              <Input
                id="name"
                label="Connection Name (Alias)"
                placeholder="e.g. Production DB"
                value={formData.name}
                autoComplete="off"
                autoFocus
                onChange={handleChange}
              />
            </div>

            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardIconWrapper}>
                  <Server size={14} className={styles.cardIcon} />
                </div>
                <h3 className={styles.cardTitle}>Server Connection</h3>
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
              <div className={styles.gridHalf}>
                <Input
                  id="database"
                  label="Database Name"
                  placeholder="postgres"
                  autoComplete="off"
                  value={formData.database}
                  onChange={handleChange}
                />
                <Input
                  id="default_schema"
                  label="Default Schema"
                  placeholder="public"
                  autoComplete="off"
                  value={formData.default_schema}
                  onChange={handleChange}
                />
              </div>
            </div>

            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardIconWrapper}>
                  <Key size={14} className={styles.cardIcon} />
                </div>
                <h3 className={styles.cardTitle}>Authentication</h3>
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
          </form>
        </div>

        <div className={styles.footer}>
          <Button
            type="button"
            variant="secondary"
            onClick={handleTestConnection}
            disabled={busy}
            isLoading={isTesting}
          >
            <Zap size={14} />
            Test Connection
          </Button>
          <div className={styles.actionGroup}>
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="new-connection-form"
              isLoading={isLoading}
              disabled={isTesting}
            >
              Save Connection
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
