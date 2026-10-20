import { useEffect, useState } from "react";
import { Button } from "@components/ui/button/Button";
import {
  getGeneralSettingsLoadState,
  reloadGeneralSettings,
  subscribeGeneralSettings,
  type GeneralSettingsLoadState,
} from "@services/generalSettings";
import styles from "./GeneralSettingsNotice.module.css";

export const GENERAL_SETTINGS_SLOW_LOAD_MS = 3000;

export function generalSettingsNoticeCopy(
  state: GeneralSettingsLoadState,
  pendingMs: number,
): { message: string; showRetry: boolean } | null {
  if (state === "ready") return null;
  if (state === "failed") {
    return {
      message:
        "General settings could not be loaded. Changes are paused so a saved choice is not overwritten. Try again, or close the app and open it again.",
      showRetry: true,
    };
  }
  if (pendingMs < GENERAL_SETTINGS_SLOW_LOAD_MS) return null;
  return {
    message: "Still loading...",
    showRetry: false,
  };
}

export function useGeneralSettingsLoadState(): GeneralSettingsLoadState {
  const [state, setState] = useState(getGeneralSettingsLoadState);

  useEffect(
    () =>
      subscribeGeneralSettings(() => {
        setState(getGeneralSettingsLoadState());
      }),
    [],
  );

  return state;
}

export function GeneralSettingsNotice() {
  const state = useGeneralSettingsLoadState();
  const [pendingMs, setPendingMs] = useState(0);
  const [timedState, setTimedState] = useState(state);
  if (timedState !== state) {
    setTimedState(state);
    setPendingMs(0);
  }

  useEffect(() => {
    if (state !== "pending") return;

    const timeout = window.setTimeout(() => {
      setPendingMs(GENERAL_SETTINGS_SLOW_LOAD_MS);
    }, GENERAL_SETTINGS_SLOW_LOAD_MS);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [state]);

  const copy = generalSettingsNoticeCopy(
    state,
    state === "pending" ? pendingMs : 0,
  );
  if (!copy) return null;

  return (
    <div className={styles.notice} role="status">
      <p>{copy.message}</p>
      {copy.showRetry && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            void reloadGeneralSettings();
          }}
        >
          Try again
        </Button>
      )}
    </div>
  );
}
