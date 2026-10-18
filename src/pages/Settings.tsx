import { useCallback, useEffect, useRef, useState } from "react";
import { Palette } from "lucide-react";
import {
  DEFAULT_APPEARANCE,
  FONT_OPTIONS,
  FONT_SIZE_PX_OPTIONS,
  ZOOM_PERCENT_OPTIONS,
  commitAppearanceChange,
  getAppearance,
  getAppliedAppearance,
  readCachedAppearance,
  type AppearanceSettings,
} from "@services/appearance";
import { useToast } from "@context/ToastContext";
import styles from "./Settings.module.css";

function SettingSelect<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <select
      className={styles.select}
      aria-label={label}
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
  const { error: toastError } = useToast();
  const [settings, setSettings] = useState<AppearanceSettings>(
    () => readCachedAppearance() ?? DEFAULT_APPEARANCE,
  );
  const userEditedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    getAppearance()
      .then((saved) => {
        if (cancelled || userEditedRef.current) return;
        setSettings(saved);
      })
      .catch((error: unknown) => {
        console.error("Failed to load appearance settings for form", error);
      });

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, []);

  const updateSetting = useCallback(
    async (patch: Partial<AppearanceSettings>) => {
      userEditedRef.current = true;
      const { next, saved } = commitAppearanceChange(patch);
      setSettings(next);

      const outcome = await saved;
      if (!mountedRef.current || outcome !== "failed-rolled-back") return;

      setSettings(getAppliedAppearance());
      toastError(
        "Could not save appearance settings. Your previous look was restored.",
      );
    },
    [toastError],
  );

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
          <div className={styles.navItem} aria-current="page">
            <Palette size={16} />
            <span>Appearance</span>
          </div>
        </nav>

        <section className={styles.content}>
          <div className={styles.panel}>
            <div className={styles.row}>
              <div>
                <h3 className={styles.rowTitle}>Font type</h3>
                <p className={styles.rowHint}>
                  Typeface used for the app text.
                </p>
              </div>
              <SettingSelect
                label="Font type"
                value={settings.fontFamily}
                options={FONT_OPTIONS.map((option) => ({
                  value: option.id,
                  label: option.label,
                }))}
                onChange={(fontFamily) => {
                  void updateSetting({ fontFamily });
                }}
              />
            </div>

            <div className={styles.row}>
              <div>
                <h3 className={styles.rowTitle}>Font size</h3>
                <p className={styles.rowHint}>
                  Base text size. Other sizes scale with it.
                </p>
              </div>
              <SettingSelect
                label="Font size"
                value={settings.fontSizePx}
                options={FONT_SIZE_PX_OPTIONS.map((size) => ({
                  value: size,
                  label: `${size}px`,
                }))}
                onChange={(fontSizePx) => {
                  void updateSetting({ fontSizePx });
                }}
              />
            </div>

            <div className={styles.row}>
              <div>
                <h3 className={styles.rowTitle}>Zoom</h3>
                <p className={styles.rowHint}>Scale of the whole window.</p>
              </div>
              <SettingSelect
                label="Zoom"
                value={settings.zoomPercent}
                options={ZOOM_PERCENT_OPTIONS.map((zoom) => ({
                  value: zoom,
                  label: `${zoom}%`,
                }))}
                onChange={(zoomPercent) => {
                  void updateSetting({ zoomPercent });
                }}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
