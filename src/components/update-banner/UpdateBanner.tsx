import { useEffect, useState } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { Download, RefreshCw, X } from "lucide-react";
import { Button } from "@components/ui/button/Button";
import styles from "./UpdateBanner.module.css";

type Phase = "available" | "downloading" | "ready";

/**
 * App-wide update notifier. Replaces the old silent auto-install: on mount it
 * asks Rust whether self-update is allowed (package-manager installs say no —
 * see `updater_allowed`), checks for an update, and if one exists shows a
 * dismissible banner. The download only starts when the user clicks.
 */
export function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [phase, setPhase] = useState<Phase>("available");
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkForUpdates() {
      try {
        // Package-manager installs manage their own updates (see updater_allowed in Rust).
        if (!(await invoke<boolean>("updater_allowed"))) return;
        const found = await check();
        if (found && !cancelled) setUpdate(found);
      } catch (e) {
        console.error("update check failed:", e);
      }
    }

    checkForUpdates();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update || dismissed) return null;

  async function install() {
    if (!update) return;
    setPhase("downloading");
    let downloaded = 0;
    let contentLength = 0;
    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength ?? 0;
            setProgress(
              contentLength
                ? Math.round((downloaded / contentLength) * 100)
                : 0,
            );
            break;
          case "Finished":
            setProgress(100);
            break;
        }
      });
      setPhase("ready");
      await relaunch();
    } catch (e) {
      console.error("update install failed:", e);
      setPhase("available");
    }
  }

  return (
    <div className={styles.banner} role="status">
      <span className={styles.icon}>
        <Download size={18} />
      </span>

      <div className={styles.text}>
        {phase === "available" && (
          <>
            <span className={styles.title}>Update available</span>
            <span className={styles.subtitle}>
              Version {update.version} is ready to install.
            </span>
          </>
        )}
        {phase === "downloading" && (
          <>
            <span className={styles.title}>Downloading update…</span>
            <span className={styles.subtitle}>{progress}%</span>
          </>
        )}
        {phase === "ready" && <span className={styles.title}>Restarting…</span>}
      </div>

      {phase === "available" && (
        <div className={styles.actions}>
          <Button size="sm" onClick={install} className={styles.updateBtn}>
            <RefreshCw size={14} />
            Update &amp; Restart
          </Button>
          <button
            className={styles.dismiss}
            onClick={() => setDismissed(true)}
            aria-label="Dismiss update notification"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
