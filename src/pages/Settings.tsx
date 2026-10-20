import { useCallback, useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { useGeneralSettingsLoadState } from "@components/GeneralSettingsNotice";
import { ConfirmDialog } from "@components/ui/dialog/ConfirmDialog";
import { Button } from "@components/ui/button/Button";
import {
  DEFAULT_GENERAL_SETTINGS,
  commitGeneralChange,
  getAppliedGeneralSettings,
  isGeneralSettingsSaveInFlight,
  subscribeGeneralSettings,
  type GeneralSettings,
} from "@services/generalSettings";
import styles from "./Settings.module.css";

function SettingSwitch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <span className={styles.switch}>
      <span className={styles.switchValue}>{checked ? "On" : "Off"}</span>
      <span className={styles.switchControl}>
        <input
          type="checkbox"
          role="switch"
          aria-label={label}
          aria-checked={checked}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className={styles.switchTrack} />
      </span>
    </span>
  );
}

export function Settings() {
  const loadState = useGeneralSettingsLoadState();
  const [settings, setSettings] = useState<GeneralSettings>(
    getAppliedGeneralSettings,
  );
  const [saveInFlight, setSaveInFlight] = useState(
    isGeneralSettingsSaveInFlight,
  );
  const [resetOpen, setResetOpen] = useState(false);
  const settingsEditable = loadState === "ready" && !saveInFlight;

  useEffect(
    () =>
      subscribeGeneralSettings(() => {
        setSettings(getAppliedGeneralSettings());
        setSaveInFlight(isGeneralSettingsSaveInFlight());
      }),
    [],
  );

  const updateSetting = useCallback((patch: Partial<GeneralSettings>) => {
    commitGeneralChange(patch);
  }, []);

  const closeReset = useCallback(() => {
    setResetOpen(false);
  }, []);

  const confirmReset = useCallback(() => {
    setResetOpen(false);
    void updateSetting(DEFAULT_GENERAL_SETTINGS);
  }, [updateSetting]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Settings</h1>
          <p className={styles.subtitle}>
            General settings are saved on this computer and restored when the
            app opens.
          </p>
        </div>
      </header>

      <div className={styles.body}>
        <nav className={styles.nav} aria-label="Settings sections">
          <div className={styles.navItem} aria-current="page">
            <SlidersHorizontal size={16} />
            <span>General</span>
          </div>
        </nav>

        <section className={styles.content}>
          <div className={styles.panel}>
            <label className={styles.row}>
              <div>
                <h3 className={styles.rowTitle}>
                  Confirm before deleting a connection
                </h3>
                <p className={styles.rowHint}>
                  Ask before a saved connection and its password are removed.
                </p>
              </div>
              <SettingSwitch
                label="Confirm before deleting a connection"
                disabled={!settingsEditable}
                checked={settings.confirmDestructiveActions}
                onChange={(confirmDestructiveActions) => {
                  void updateSetting({ confirmDestructiveActions });
                }}
              />
            </label>

            <label className={styles.row}>
              <div>
                <h3 className={styles.rowTitle}>
                  Show success and information notifications
                </h3>
                <p className={styles.rowHint}>
                  Error and warning notifications stay visible. This includes
                  "Connection deleted" and "Successfully connected".
                </p>
              </div>
              <SettingSwitch
                label="Show success and information notifications"
                disabled={!settingsEditable}
                checked={settings.showStatusNotifications}
                onChange={(showStatusNotifications) => {
                  void updateSetting({ showStatusNotifications });
                }}
              />
            </label>

            <div className={styles.row}>
              <div>
                <h3 className={styles.rowTitle}>Reset general settings</h3>
                <p className={styles.rowHint}>Turns both switches back on.</p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!settingsEditable}
                onClick={() => setResetOpen(true)}
              >
                Reset General Settings
              </Button>
            </div>
          </div>
        </section>
      </div>

      <ConfirmDialog
        isOpen={resetOpen}
        title="Reset general settings"
        message="Both switches will turn back on."
        confirmLabel="Reset"
        variant="warning"
        onConfirm={confirmReset}
        onCancel={closeReset}
      />
    </div>
  );
}
