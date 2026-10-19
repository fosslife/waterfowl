/**
 * Registry of values stored in SQLite `app_settings`.
 * Adding a setting means one entry here, plus the control that edits it.
 * Strings are parsed at the database and cache boundary.
 * In-memory values stay numbers or font ids and are checked with sanitize.
 */

export const FONT_IDS = ["inter", "jetbrains"] as const;

export type FontFamilyId = (typeof FONT_IDS)[number];

export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 18;
export const ZOOM_MIN = 80;
export const ZOOM_MAX = 150;

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isFontFamilyId(value: string): value is FontFamilyId {
  return (FONT_IDS as readonly string[]).includes(value);
}

function parseBoundedNumber(
  raw: string | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return clampNumber(value, min, max);
}

function sanitizeBoundedNumber(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return clampNumber(value, min, max);
}

export const settingsSchema = {
  fontFamily: {
    default: "inter",
    parse(raw: string | undefined): FontFamilyId {
      if (raw && isFontFamilyId(raw)) return raw;
      return "inter";
    },
    sanitize(value: FontFamilyId): FontFamilyId {
      return isFontFamilyId(value) ? value : "inter";
    },
    serialize(value: FontFamilyId): string {
      return value;
    },
  },
  fontSizePx: {
    default: 16,
    parse(raw: string | undefined): number {
      return parseBoundedNumber(raw, FONT_SIZE_MIN, FONT_SIZE_MAX, 16);
    },
    sanitize(value: number): number {
      return sanitizeBoundedNumber(value, FONT_SIZE_MIN, FONT_SIZE_MAX, 16);
    },
    serialize(value: number): string {
      return String(value);
    },
  },
  zoomPercent: {
    default: 100,
    parse(raw: string | undefined): number {
      return parseBoundedNumber(raw, ZOOM_MIN, ZOOM_MAX, 100);
    },
    sanitize(value: number): number {
      return sanitizeBoundedNumber(value, ZOOM_MIN, ZOOM_MAX, 100);
    },
    serialize(value: number): string {
      return String(value);
    },
  },
} as const;

export type SettingKey = keyof typeof settingsSchema;

export type Settings = {
  [K in SettingKey]: ReturnType<(typeof settingsSchema)[K]["parse"]>;
};

export const SETTING_KEYS = Object.keys(settingsSchema) as SettingKey[];

export function defaultSettings(): Settings {
  return {
    fontFamily: settingsSchema.fontFamily.default,
    fontSizePx: settingsSchema.fontSizePx.default,
    zoomPercent: settingsSchema.zoomPercent.default,
  };
}

/** Keep known keys. Unknown database keys are ignored and never deleted. */
export function normalizeSettings(
  raw: Record<string, string | undefined>,
): Settings {
  return {
    fontFamily: settingsSchema.fontFamily.parse(raw.fontFamily),
    fontSizePx: settingsSchema.fontSizePx.parse(raw.fontSizePx),
    zoomPercent: settingsSchema.zoomPercent.parse(raw.zoomPercent),
  };
}

export function mergeSettings(base: Settings, patch: Partial<Settings>): Settings {
  return {
    fontFamily:
      patch.fontFamily === undefined
        ? base.fontFamily
        : settingsSchema.fontFamily.sanitize(patch.fontFamily),
    fontSizePx:
      patch.fontSizePx === undefined
        ? base.fontSizePx
        : settingsSchema.fontSizePx.sanitize(patch.fontSizePx),
    zoomPercent:
      patch.zoomPercent === undefined
        ? base.zoomPercent
        : settingsSchema.zoomPercent.sanitize(patch.zoomPercent),
  };
}

export function serializeSetting<K extends SettingKey>(
  key: K,
  value: Settings[K],
): string {
  switch (key) {
    case "fontFamily":
      return settingsSchema.fontFamily.serialize(value as Settings["fontFamily"]);
    case "fontSizePx":
      return settingsSchema.fontSizePx.serialize(value as Settings["fontSizePx"]);
    case "zoomPercent":
      return settingsSchema.zoomPercent.serialize(value as Settings["zoomPercent"]);
  }
}
