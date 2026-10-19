/**
 * One settings store for every section.
 * SQLite `app_settings(key, value)` is the source of truth.
 * localStorage is a copy of the last confirmed save, used to paint before SQLite answers.
 * `intended` is what the user asked for. `confirmed` is what a write has finished.
 * A failed write puts the screen back on `confirmed`, never on a queued value that did not save.
 */

import { getDatabase } from "./database";
import {
  SETTING_KEYS,
  type SettingKey,
  type Settings,
  defaultSettings,
  mergeSettings,
  normalizeSettings,
  serializeSetting,
} from "./settings.schema";

export {
  defaultSettings,
  normalizeSettings,
  type Settings,
} from "./settings.schema";

export const SETTINGS_CACHE_KEY = "waterfowl.settings.v1";
export const LEGACY_APPEARANCE_CACHE_KEY = "waterfowl.appearance.v1";

export const SETTINGS_SAVE_ERROR =
  "Couldn't save settings. The last saved settings are still in use.";

export const SETTINGS_LOAD_ERROR_SAVED_COPY =
  "Couldn't load saved settings. Showing the copy saved on this computer.";

export const SETTINGS_LOAD_ERROR_DEFAULTS =
  "Couldn't load saved settings. Showing default settings.";

type Listener = () => void;

let confirmed: Settings = defaultSettings();
let intended: Settings = defaultSettings();
let applied: Settings = defaultSettings();
let saveError: string | null = null;
let loadError: string | null = null;
let loadPromise: Promise<Settings> | null = null;
/** True only after a database read succeeds. A failed read must not publish the cache. */
let loadSettled = false;
/**
 * True only when `readSettingsCache` returned a usable cache and that cache was painted.
 * In-memory defaults do not count, even when they match a cache that was never read.
 */
let hydratedFromCache = false;
const dirtyKeys = new Set<SettingKey>();
/** Keys written successfully since this process started. A late read must not undo them. */
const savedSinceLoad = new Set<SettingKey>();
const listeners = new Set<Listener>();

let saveQueue: Promise<void> = Promise.resolve();
let draining = false;
let pending = false;

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAppliedSettings(): Settings {
  return { ...applied };
}

/** Same object until the store emits. For useSyncExternalStore. */
export function getAppliedSettingsSnapshot(): Settings {
  return applied;
}

export function getConfirmedSettings(): Settings {
  return { ...confirmed };
}

export function getSettingsSaveError(): string | null {
  return saveError;
}

export function getSettingsLoadError(): string | null {
  return loadError;
}

function sameSettings(left: Settings, right: Settings): boolean {
  return SETTING_KEYS.every((key) => left[key] === right[key]);
}

function changedKeys(from: Settings, to: Settings): SettingKey[] {
  return SETTING_KEYS.filter((key) => from[key] !== to[key]);
}

function browserStorage(): Storage | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    return storage;
  } catch (error: unknown) {
    console.error("Failed to reach localStorage", error);
    return null;
  }
}

function recordToStrings(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const strings: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean"
    ) {
      strings[key] = String(entry);
    }
  }
  return strings;
}

function parseCachePayload(raw: string): Settings | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const body = parsed as { version?: unknown; values?: unknown };
  if (body.version !== 1) return null;
  const values = recordToStrings(body.values);
  if (!values) return null;
  return normalizeSettings(values);
}

function parseLegacyAppearance(raw: string): Settings | null {
  try {
    const values = recordToStrings(JSON.parse(raw));
    if (!values) return null;
    return normalizeSettings(values);
  } catch {
    return null;
  }
}

export function readSettingsCache(): Settings | null {
  const store = browserStorage();
  if (!store) return null;
  try {
    const current = store.getItem(SETTINGS_CACHE_KEY);
    if (current !== null) {
      return parseCachePayload(current);
    }
    const legacy = store.getItem(LEGACY_APPEARANCE_CACHE_KEY);
    if (!legacy) return null;
    return parseLegacyAppearance(legacy);
  } catch (error: unknown) {
    console.error("Failed to read settings cache", error);
    return null;
  }
}

export function writeSettingsCache(settings: Settings): void {
  const store = browserStorage();
  if (!store) return;
  try {
    const values: Record<string, string> = {};
    for (const key of SETTING_KEYS) {
      values[key] = serializeSetting(key, settings[key]);
    }
    store.setItem(
      SETTINGS_CACHE_KEY,
      JSON.stringify({ version: 1, values }),
    );
  } catch (error: unknown) {
    console.error("Failed to cache settings", error);
  }
}

/** Paint the last confirmed cache before SQLite responds. Does not count as an edit. */
export function hydrateSettings(settings: Settings): void {
  const safe = mergeSettings(defaultSettings(), settings);
  confirmed = safe;
  intended = { ...safe };
  applied = { ...safe };
  emit();
}

/**
 * Paint a usable cache, or the built-in defaults when the cache is missing or rejected.
 * The load error uses this result, so defaults are not described as a saved copy.
 */
export function hydrateFromStoredCache(): void {
  const cached = readSettingsCache();
  hydratedFromCache = cached !== null;
  hydrateSettings(cached ?? defaultSettings());
}

/**
 * Placeholders follow the keys we are writing.
 * Key names and values are bound parameters. Only schema keys are written.
 */
function upsertStatement(
  keys: SettingKey[],
  settings: Settings,
): { sql: string; params: string[] } {
  const tuples = keys.map(() => "(?, ?)").join(", ");
  const sql =
    `INSERT INTO app_settings (key, value) VALUES ${tuples} ` +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value";
  const params: string[] = [];
  for (const key of keys) {
    params.push(key, serializeSetting(key, settings[key]));
  }
  return { sql, params };
}

async function persistPatch(settings: Settings, keys: SettingKey[]): Promise<void> {
  if (keys.length === 0) return;
  const { sql, params } = upsertStatement(keys, settings);
  const database = await getDatabase();
  await database.execute(sql, params);
}

function assignSetting<K extends SettingKey>(
  target: Settings,
  key: K,
  value: Settings[K],
): void {
  target[key] = value;
}

function overlayKeys(
  base: Settings,
  keys: Set<SettingKey>,
  source: Settings,
): Settings {
  const next = { ...base };
  for (const key of keys) {
    assignSetting(next, key, source[key]);
  }
  return next;
}

function rememberSave(snapshot: Settings, keys: SettingKey[]): void {
  confirmed = overlayKeys(confirmed, new Set(keys), snapshot);
  for (const key of keys) {
    savedSinceLoad.add(key);
    if (intended[key] === confirmed[key]) dirtyKeys.delete(key);
  }
  if (sameSettings(intended, confirmed)) saveError = null;
  if (loadSettled && dirtyKeys.size === 0 && sameSettings(intended, confirmed)) {
    writeSettingsCache(confirmed);
  }
}

async function runSave(): Promise<void> {
  const snapshot = { ...intended };
  const keys = changedKeys(confirmed, snapshot);
  if (keys.length === 0) {
    if (sameSettings(intended, confirmed)) saveError = null;
    emit();
    return;
  }

  try {
    await persistPatch(snapshot, keys);
    rememberSave(snapshot, keys);
  } catch (error: unknown) {
    console.error("Failed to save settings", error);
    // A newer edit is already queued. Do not roll the screen back to this snapshot.
    if (pending) return;
    applied = { ...confirmed };
    saveError = SETTINGS_SAVE_ERROR;
  }
  emit();
}

function scheduleSave(): void {
  pending = true;
  if (draining) return;
  draining = true;
  saveQueue = saveQueue
    .then(async () => {
      try {
        while (pending) {
          pending = false;
          await runSave();
        }
      } finally {
        draining = false;
        if (pending) scheduleSave();
      }
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

export function commitSettings(patch: Partial<Settings>): void {
  for (const key of SETTING_KEYS) {
    if (patch[key] !== undefined) dirtyKeys.add(key);
  }
  intended = mergeSettings(intended, patch);
  applied = { ...intended };
  saveError = null;
  emit();
  scheduleSave();
}

/** Try the latest intended settings again, including edits made after the failure. */
export function retrySettingsSave(): void {
  applied = { ...intended };
  saveError = null;
  emit();
  scheduleSave();
}

/** Read SQLite again after a failed load. Edits made since startup stay in place. */
export function retrySettingsLoad(): void {
  if (loadPromise) return;
  void startSettingsLoad();
}

export function startSettingsLoad(): Promise<Settings> {
  if (loadPromise) return loadPromise;

  loadPromise = loadFromDatabase()
    .then((saved) => {
      const nextConfirmed = overlayKeys(saved, savedSinceLoad, confirmed);
      const nextIntended = overlayKeys(nextConfirmed, dirtyKeys, intended);
      confirmed = nextConfirmed;
      intended = nextIntended;
      applied = { ...nextIntended };
      loadSettled = true;
      loadError = null;
      if (dirtyKeys.size > 0) {
        scheduleSave();
      } else if (sameSettings(applied, confirmed)) {
        writeSettingsCache(confirmed);
      }
      emit();
      return { ...applied };
    })
    .catch((error: unknown) => {
      console.error("Failed to load settings", error);
      // Leave loadSettled false so a later save cannot publish a cache that never saw the database.
      loadPromise = null;
      loadError = hydratedFromCache
        ? SETTINGS_LOAD_ERROR_SAVED_COPY
        : SETTINGS_LOAD_ERROR_DEFAULTS;
      emit();
      return { ...applied };
    });

  return loadPromise;
}

async function loadFromDatabase(): Promise<Settings> {
  const database = await getDatabase();
  const rows = await database.select<{ key: string; value: string }[]>(
    "SELECT key, value FROM app_settings",
  );
  const raw: Record<string, string> = {};
  for (const row of rows) {
    if (typeof row.key === "string" && typeof row.value === "string") {
      raw[row.key] = row.value;
    }
  }
  return normalizeSettings(raw);
}

/** Test helper. Production code does not call this. */
export function resetSettingsStoreForTests(): void {
  confirmed = defaultSettings();
  intended = defaultSettings();
  applied = defaultSettings();
  saveError = null;
  loadError = null;
  loadPromise = null;
  loadSettled = false;
  hydratedFromCache = false;
  dirtyKeys.clear();
  savedSinceLoad.clear();
  listeners.clear();
  saveQueue = Promise.resolve();
  draining = false;
  pending = false;
}
