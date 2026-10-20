import { useEffect, useRef } from "react";
import { useToast } from "@context/ToastContext";
import {
  subscribeGeneralSaveOutcomes,
  type GeneralSaveOutcome,
} from "@services/generalSettings";

export function generalSettingsSaveAlert(outcome: GeneralSaveOutcome): string | null {
  if (outcome === "failed-rolled-back") {
    return "Could not save general settings. Your previous choice was restored.";
  }
  if (outcome === "failed-timed-out") {
    return "Saving is taking longer than expected. Your settings are still being saved.";
  }
  if (outcome === "failed-not-ready") {
    return "General settings are not loaded, so this change was not saved.";
  }
  return null;
}

/**
 * Track the warning created for a slow save. Resolving that save removes
 * only its own warning. Other error toasts stay.
 */
export function reduceSaveAlert(
  timeoutToastIds: readonly string[],
  outcome: GeneralSaveOutcome,
  createToast: (message: string, duration?: number) => string | undefined,
  dismissToast: (id: string) => void,
): string[] {
  if (outcome === "timeout-resolved") {
    const [active, ...rest] = timeoutToastIds;
    if (active) dismissToast(active);
    return rest;
  }

  const message = generalSettingsSaveAlert(outcome);
  if (!message) return [...timeoutToastIds];
  // A duration of 0 stays until this save finishes. Other errors keep their own timer.
  const id =
    outcome === "failed-timed-out" ? createToast(message, 0) : createToast(message);
  if (outcome === "failed-timed-out" && id) return [...timeoutToastIds, id];
  return [...timeoutToastIds];
}

/** Mounted beside the page so a save error is still shown after Settings closes. */
export function GeneralSettingsSaveAlerts() {
  const { error: toastError, dismiss } = useToast();
  const timeoutToastIds = useRef<string[]>([]);

  useEffect(() => {
    const ids = timeoutToastIds;
    const unsubscribe = subscribeGeneralSaveOutcomes((outcome) => {
      ids.current = reduceSaveAlert(
        ids.current,
        outcome,
        toastError,
        dismiss,
      );
    });
    return () => {
      unsubscribe();
      for (const id of ids.current) dismiss(id);
      ids.current = [];
    };
  }, [toastError, dismiss]);

  return null;
}
