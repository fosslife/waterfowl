import { useCallback, useSyncExternalStore } from "react";
import { NavLink } from "react-router-dom";
import { Palette } from "lucide-react";
import clsx from "clsx";
import { Button } from "@components/ui/button/Button";
import {
  FONT_OPTIONS,
  FONT_SIZE_PX_OPTIONS,
  ZOOM_PERCENT_OPTIONS,
} from "@services/appearance";
import {
  commitSettings,
  getAppliedSettingsSnapshot,
  getSettingsLoadError,
  getSettingsSaveError,
  retrySettingsLoad,
  retrySettingsSave,
  subscribeSettings,
  type Settings,
} from "@services/settings";
import styles from "./Settings.module.css";

function SettingSelect<T extends string | number>({
  value,
  options,
  onChange,
  labelledBy,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  labelledBy: string;
}) {
  return (
    <select
      className={styles.select}
      aria-labelledby={labelledBy}
      value={String(value)}
      onChange={(event) => {
        const match = options.find(
          (option) => String(option.value) === event.target.value,
        );
        if (match) onChange(match.value);
      }}
    >
      {options.map((option) => (
        <option key={String(option.value)} value={String(option.value)}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Settings() {
  const settings = useSyncExternalStore(
    subscribeSettings,
    getAppliedSettingsSnapshot,
    getAppliedSettingsSnapshot,
  );
  const saveError = useSyncExternalStore(
    subscribeSettings,
    getSettingsSaveError,
    getSettingsSaveError,
  );
  const loadError = useSyncExternalStore(
    subscribeSettings,
    getSettingsLoadError,
    getSettingsLoadError,
  );

  const updateSetting = useCallback((patch: Partial<Settings>) => {
    commitSettings(patch);
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Settings</h1>
          <p className={styles.subtitle}>
            Appearance is saved on this computer and restored when the app
            opens.
          </p>
        </div>
      </header>

      <div className={styles.body}>
        <nav className={styles.nav} aria-label="Settings sections">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              clsx(styles.navItem, isActive && styles.navItemCurrent)
            }
          >
            <Palette size={16} />
            <span>Appearance</span>
          </NavLink>
        </nav>

        <section className={styles.content}>
          <div className={styles.panel}>
            {loadError ? (
              <div className={styles.saveError} role="alert">
                <p>{loadError}</p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => retrySettingsLoad()}
                >
                  Retry
                </Button>
              </div>
            ) : null}
            {saveError ? (
              <div className={styles.saveError} role="alert">
                <p>{saveError}</p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => retrySettingsSave()}
                >
                  Retry
                </Button>
              </div>
            ) : null}

            <div className={styles.row}>
              <div>
                <h3 id="setting-font" className={styles.rowTitle}>
                  Font
                </h3>
                <p className={styles.rowHint}>Chooses the typeface.</p>
              </div>
              <SettingSelect
                labelledBy="setting-font"
                value={settings.fontFamily}
                options={FONT_OPTIONS.map((option) => ({
                  value: option.id,
                  label: option.label,
                }))}
                onChange={(fontFamily) => {
                  updateSetting({ fontFamily });
                }}
              />
            </div>

            <div className={styles.row}>
              <div>
                <h3 id="setting-font-size" className={styles.rowTitle}>
                  Font size
                </h3>
                <p className={styles.rowHint}>
                  Changes the size of text. Spacing grows with it. Used
                  together with zoom, both apply.
                </p>
              </div>
              <SettingSelect
                labelledBy="setting-font-size"
                value={settings.fontSizePx}
                options={FONT_SIZE_PX_OPTIONS.map((size) => ({
                  value: size,
                  label: `${size}px`,
                }))}
                onChange={(fontSizePx) => {
                  updateSetting({ fontSizePx });
                }}
              />
            </div>

            <div className={styles.row}>
              <div>
                <h3 id="setting-zoom" className={styles.rowTitle}>
                  Zoom
                </h3>
                <p className={styles.rowHint}>
                  Scales the whole interface, including text and other
                  controls. Used together with font size, both apply.
                </p>
              </div>
              <SettingSelect
                labelledBy="setting-zoom"
                value={settings.zoomPercent}
                options={ZOOM_PERCENT_OPTIONS.map((zoom) => ({
                  value: zoom,
                  label: `${zoom}%`,
                }))}
                onChange={(zoomPercent) => {
                  updateSetting({ zoomPercent });
                }}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
