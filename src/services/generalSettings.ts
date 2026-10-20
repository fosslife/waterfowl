/**
 * Saved General settings: delete confirmation and status notifications.
 * Stored in the local SQLite app_settings table so they survive a restart.
 */

import { getDatabase } from "./database";

export interface GeneralSettings {
  confirmDestructiveActions: boolean;
  showStatusNotifications: boolean;
}

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  confirmDestructiveActions: true,
  showStatusNotifications: true,
};

export const GENERAL_SETTING_KEYS = {
  confirmDestructiveActions: "general.confirmDestructiveActions",
  showStatusNotifications: "general.showStatusNotifications",
} as const;

export type GeneralSaveOutcome =
  | "saved"
  | "failed-rolled-back"
  | "failed-superseded"
  | "failed-not-ready"
  | "failed-timed-out"
  | "timeout-resolved";

export type GeneralSettingsLoadState = "ready" | "pending" | "failed";

/** How long a read may stay pending before Retry is offered. The database call keeps running. */
export const GENERAL_SETTINGS_LOAD_TIMEOUT_MS = 8000;

/** How long one write may run before we say it is still unfinished. The write is not cancelled. */
export const GENERAL_SETTINGS_SAVE_TIMEOUT_MS = 8000;

type StatusVariant = "success" | "error" | "warning" | "info";
type LoadListener = () => void;
type SaveOutcomeListener = (outcome: GeneralSaveOutcome) => void;

let dirtySinceLoad = false;
let applied: GeneralSettings = { ...DEFAULT_GENERAL_SETTINGS };
/** Last values known to be stored. Delete confirmation trusts this copy. */
let confirmed: GeneralSettings = { ...DEFAULT_GENERAL_SETTINGS };
let loadState: GeneralSettingsLoadState = "pending";
let loadRequestId = 0;
let startupStarted = false;
let activeLoad: Promise<GeneralSettingsLoadState> | null = null;
/** True after a read outlives the timeout, so Retry can start another read. */
let loadAbandoned = false;
let loadTimer: ReturnType<typeof setTimeout> | null = null;
let saveQueue: Promise<void> = Promise.resolve();
let savesInFlight = 0;
const loadListeners = new Set<LoadListener>();
const saveOutcomeListeners = new Set<SaveOutcomeListener>();

function emitLoadState(): void {
  for (const listener of loadListeners) {
    listener();
  }
}

export function getGeneralSettingsLoadState(): GeneralSettingsLoadState {
  return loadState;
}

/**
 * Listen for load changes. The listener also runs immediately with the
 * current status, so a screen that appears late still sees a finished load.
 */
export function subscribeGeneralSettings(listener: LoadListener): () => void {
  loadListeners.add(listener);
  listener();
  return () => {
    loadListeners.delete(listener);
  };
}

/**
 * Hear save failures, including after the Settings page is gone.
 * Does not replay old results. Success is quiet.
 */
export function subscribeGeneralSaveOutcomes(
  listener: SaveOutcomeListener,
): () => void {
  saveOutcomeListeners.add(listener);
  return () => {
    saveOutcomeListeners.delete(listener);
  };
}

function notifySaveOutcome(outcome: GeneralSaveOutcome): void {
  if (outcome === "saved" || outcome === "failed-superseded") return;
  for (const listener of saveOutcomeListeners) {
    listener(outcome);
  }
}

/** A load is in progress. Saves stay off until it finishes. */
export function beginGeneralSettingsLoad(): void {
  loadState = "pending";
  emitLoadState();
}

/** The read failed. Saves stay off so defaults are not written over saved rows. */
export function failGeneralSettingsLoad(): void {
  loadState = "failed";
  emitLoadState();
}

export function getAppliedGeneralSettings(): GeneralSettings {
  return { ...applied };
}

/** Values the database has accepted. Delete confirmation trusts this copy. */
export function getConfirmedGeneralSettings(): GeneralSettings {
  return { ...confirmed };
}

/** True while a write is queued or still running, including one that has already timed out. */
export function isGeneralSettingsSaveInFlight(): boolean {
  return savesInFlight > 0;
}

/**
 * Ask before delete while the saved choice says to ask, or while an
 * on-screen "off" has not been stored yet.
 */
export function shouldConfirmDestructiveAction(): boolean {
  return (
    confirmed.confirmDestructiveActions || applied.confirmDestructiveActions
  );
}

/** Accept only the exact stored words. Anything else keeps the default. */
export function parseStoredBoolean(
  raw: string | undefined,
  fallback: boolean,
): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

export function normalizeGeneralSettings(
  raw: Partial<Record<string, string>>,
): GeneralSettings {
  return {
    confirmDestructiveActions: parseStoredBoolean(
      raw[GENERAL_SETTING_KEYS.confirmDestructiveActions],
      DEFAULT_GENERAL_SETTINGS.confirmDestructiveActions,
    ),
    showStatusNotifications: parseStoredBoolean(
      raw[GENERAL_SETTING_KEYS.showStatusNotifications],
      DEFAULT_GENERAL_SETTINGS.showStatusNotifications,
    ),
  };
}

export function allowsStatusNotification(variant: StatusVariant): boolean {
  if (variant === "error" || variant === "warning") return true;
  return applied.showStatusNotifications;
}

/**
 * Apply settings loaded from the database.
 * Returns false when the user already changed a setting, so a slow load
 * cannot put the old value back on screen.
 */
export function applyLoadedGeneralSettings(settings: GeneralSettings): boolean {
  if (dirtySinceLoad) {
    loadState = "ready";
    emitLoadState();
    return false;
  }
  applied = { ...settings };
  confirmed = { ...settings };
  loadState = "ready";
  emitLoadState();
  return true;
}

function clearLoadTimer(): void {
  if (loadTimer !== null) {
    clearTimeout(loadTimer);
    loadTimer = null;
  }
}

/**
 * Read both settings. Callers share a read that is still inside the timeout.
 * Retry after the timeout starts a new read. The old database call keeps running,
 * and its late result is ignored because its id no longer matches.
 * Retry does not start a second database open. An open that has not finished
 * stays shared, because that open cannot be cancelled.
 */
export function reloadGeneralSettings(): Promise<GeneralSettingsLoadState> {
  if (activeLoad && !loadAbandoned) return activeLoad;

  const requestId = ++loadRequestId;
  loadAbandoned = false;
  beginGeneralSettingsLoad();
  clearLoadTimer();
  loadTimer = setTimeout(() => {
    if (requestId !== loadRequestId) return;
    if (loadState !== "pending") return;
    loadAbandoned = true;
    failGeneralSettingsLoad();
  }, GENERAL_SETTINGS_LOAD_TIMEOUT_MS);

  const run = readGeneralSettings(requestId).finally(() => {
    if (activeLoad === run) activeLoad = null;
    if (requestId === loadRequestId) clearLoadTimer();
  });
  activeLoad = run;
  return run;
}

/** Start the app's first read. Later calls do not open another read. */
export function startGeneralSettingsLoadOnce(): Promise<GeneralSettingsLoadState> {
  if (startupStarted) {
    return activeLoad ?? Promise.resolve(getGeneralSettingsLoadState());
  }
  startupStarted = true;
  return reloadGeneralSettings();
}

async function readGeneralSettings(
  requestId: number,
): Promise<GeneralSettingsLoadState> {
  try {
    const saved = await getGeneralSettings();
    if (requestId !== loadRequestId) return getGeneralSettingsLoadState();
    applyLoadedGeneralSettings(saved);
    return getGeneralSettingsLoadState();
  } catch (error: unknown) {
    if (requestId !== loadRequestId) return getGeneralSettingsLoadState();
    console.error("Failed to load general settings", error);
    failGeneralSettingsLoad();
    return "failed";
  }
}

function enqueueSave(snapshot: GeneralSettings): Promise<GeneralSaveOutcome> {
  const job = saveQueue.then(async (): Promise<GeneralSaveOutcome> => {
    const writePromise = writeGeneralSettings(snapshot);
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let writeError: unknown = null;
    const writeResult = writePromise.then(
      () => "written" as const,
      (error: unknown) => {
        writeError = error;
        return "failed" as const;
      },
    );
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      saveTimer = setTimeout(() => {
        resolve("timeout");
      }, GENERAL_SETTINGS_SAVE_TIMEOUT_MS);
    });

    let timedOut = false;
    try {
      const raced = await Promise.race([writeResult, timeoutPromise]);
      if (raced === "timeout") {
        // The write is still running. A second write must wait so this one
        // cannot finish afterwards and replace a newer choice.
        timedOut = true;
        notifySaveOutcome("failed-timed-out");
      }
      const settled = raced === "timeout" ? await writeResult : raced;
      if (settled === "failed") throw writeError;
      confirmed = { ...snapshot };
      if (timedOut) notifySaveOutcome("timeout-resolved");
      return "saved";
    } catch (error: unknown) {
      console.error("Failed to save general settings", error);
      if (timedOut) notifySaveOutcome("timeout-resolved");
      if (applied === snapshot) {
        applied = { ...confirmed };
        notifySaveOutcome("failed-rolled-back");
        return "failed-rolled-back";
      }
      return "failed-superseded";
    } finally {
      if (saveTimer !== null) clearTimeout(saveTimer);
      savesInFlight = Math.max(0, savesInFlight - 1);
      emitLoadState();
    }
  });
  saveQueue = job.then(
    () => undefined,
    () => undefined,
  );
  return job;
}

/**
 * Update the in-memory settings immediately, then save both values together.
 * Saves run one at a time so two quick toggles cannot finish out of order.
 * A failed newest save restores the last values that were actually stored.
 */
export function commitGeneralChange(patch: Partial<GeneralSettings>): {
  next: GeneralSettings;
  saved: Promise<GeneralSaveOutcome>;
} {
  if (loadState !== "ready") {
    notifySaveOutcome("failed-not-ready");
    return {
      next: { ...applied },
      saved: Promise.resolve("failed-not-ready"),
    };
  }

  const next: GeneralSettings = { ...applied, ...patch };
  dirtySinceLoad = true;
  applied = next;
  savesInFlight += 1;
  emitLoadState();
  return { next, saved: enqueueSave(next) };
}

export function resetGeneralSettings(): {
  next: GeneralSettings;
  saved: Promise<GeneralSaveOutcome>;
} {
  return commitGeneralChange({ ...DEFAULT_GENERAL_SETTINGS });
}

export async function getGeneralSettings(): Promise<GeneralSettings> {
  const database = await getDatabase();
  const rows = await database.select<{ key: string; value: string }[]>(
    "SELECT key, value FROM app_settings WHERE key IN (?, ?)",
    [
      GENERAL_SETTING_KEYS.confirmDestructiveActions,
      GENERAL_SETTING_KEYS.showStatusNotifications,
    ],
  );

  const raw: Partial<Record<string, string>> = {};
  for (const row of rows) {
    raw[row.key] = row.value;
  }
  return normalizeGeneralSettings(raw);
}

async function writeGeneralSettings(settings: GeneralSettings): Promise<void> {
  const database = await getDatabase();
  await database.execute(
    `INSERT INTO app_settings (key, value) VALUES (?, ?), (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [
      GENERAL_SETTING_KEYS.confirmDestructiveActions,
      settings.confirmDestructiveActions ? "true" : "false",
      GENERAL_SETTING_KEYS.showStatusNotifications,
      settings.showStatusNotifications ? "true" : "false",
    ],
  );
}
