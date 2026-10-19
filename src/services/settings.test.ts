import { beforeEach, describe, expect, it, vi } from "vitest";
import { clampNumber } from "./settings.schema";
import {
  LEGACY_APPEARANCE_CACHE_KEY,
  SETTINGS_CACHE_KEY,
  SETTINGS_LOAD_ERROR_DEFAULTS,
  SETTINGS_SAVE_ERROR,
  commitSettings,
  defaultSettings,
  getAppliedSettings,
  getConfirmedSettings,
  getSettingsLoadError,
  getSettingsSaveError,
  hydrateSettings,
  normalizeSettings,
  readSettingsCache,
  resetSettingsStoreForTests,
  retrySettingsLoad,
  retrySettingsSave,
  startSettingsLoad,
  writeSettingsCache,
} from "./settings";

const { execute, select } = vi.hoisted(() => ({
  execute: vi.fn(async (_query: string, _bindValues?: unknown[]) => ({
    rowsAffected: 1,
  })),
  select: vi.fn(async () => [] as { key: string; value: string }[]),
}));

vi.mock("./database", () => ({
  getDatabase: async () => ({ execute, select }),
}));

describe("normalizeSettings", () => {
  it("returns defaults for an empty row set", () => {
    expect(normalizeSettings({})).toEqual(defaultSettings());
  });

  it("clamps out-of-range font size and zoom", () => {
    expect(
      normalizeSettings({
        fontFamily: "inter",
        fontSizePx: "99",
        zoomPercent: "10",
      }),
    ).toEqual({
      fontFamily: "inter",
      fontSizePx: 18,
      zoomPercent: 80,
    });
  });

  it("rejects non-numeric size and zoom", () => {
    expect(
      normalizeSettings({
        fontFamily: "inter",
        fontSizePx: "nope",
        zoomPercent: "",
      }),
    ).toEqual(defaultSettings());
  });

  it("falls back when font id is unknown and ignores unknown keys", () => {
    expect(
      normalizeSettings({
        fontFamily: "georgia",
        fontSizePx: "14",
        zoomPercent: "100",
        theme: "dark",
      }),
    ).toEqual({
      fontFamily: "inter",
      fontSizePx: 14,
      zoomPercent: 100,
    });
  });
});

describe("clampNumber", () => {
  it("keeps values inside the range", () => {
    expect(clampNumber(15, 12, 18)).toBe(15);
  });

  it("clamps below min and above max", () => {
    expect(clampNumber(8, 12, 18)).toBe(12);
    expect(clampNumber(20, 12, 18)).toBe(18);
  });
});

describe("settings cache", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("writes a versioned cache and reads it back", () => {
    writeSettingsCache({
      fontFamily: "jetbrains",
      fontSizePx: 14,
      zoomPercent: 120,
    });

    expect(JSON.parse(localStorage.getItem(SETTINGS_CACHE_KEY) ?? "")).toEqual({
      version: 1,
      values: {
        fontFamily: "jetbrains",
        fontSizePx: "14",
        zoomPercent: "120",
      },
    });
    expect(readSettingsCache()).toEqual({
      fontFamily: "jetbrains",
      fontSizePx: 14,
      zoomPercent: 120,
    });
  });

  it("returns null when the cache is missing", () => {
    expect(readSettingsCache()).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    localStorage.setItem(SETTINGS_CACHE_KEY, "{");
    expect(readSettingsCache()).toBeNull();
  });

  it("returns null for an outdated cache version", () => {
    localStorage.setItem(
      SETTINGS_CACHE_KEY,
      JSON.stringify({
        version: 0,
        values: { fontSizePx: "18", fontFamily: "jetbrains", zoomPercent: "150" },
      }),
    );
    expect(readSettingsCache()).toBeNull();
  });

  it("keeps valid fields when one stored value is junk", () => {
    localStorage.setItem(
      SETTINGS_CACHE_KEY,
      JSON.stringify({
        version: 1,
        values: {
          fontFamily: "jetbrains",
          fontSizePx: "nope",
          zoomPercent: "130",
        },
      }),
    );
    expect(readSettingsCache()).toEqual({
      fontFamily: "jetbrains",
      fontSizePx: 16,
      zoomPercent: 130,
    });
  });

  it("reads the legacy appearance cache when the new key is absent", () => {
    localStorage.setItem(
      LEGACY_APPEARANCE_CACHE_KEY,
      JSON.stringify({
        fontFamily: "jetbrains",
        fontSizePx: 14,
        zoomPercent: 110,
      }),
    );
    expect(readSettingsCache()).toEqual({
      fontFamily: "jetbrains",
      fontSizePx: 14,
      zoomPercent: 110,
    });
  });

  it("does not throw when storage reads or writes fail", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });

    expect(readSettingsCache()).toBeNull();
    expect(() =>
      writeSettingsCache({
        fontFamily: "inter",
        fontSizePx: 16,
        zoomPercent: 100,
      }),
    ).not.toThrow();

    if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
    errorSpy.mockRestore();
  });
});

describe("settings save", () => {
  beforeEach(async () => {
    execute.mockReset();
    execute.mockResolvedValue({ rowsAffected: 1 });
    select.mockReset();
    select.mockResolvedValue([]);
    resetSettingsStoreForTests();
    localStorage.clear();
    await startSettingsLoad();
  });

  it("loads every row and upserts only the keys in the patch", async () => {
    resetSettingsStoreForTests();
    select.mockResolvedValue([
      { key: "fontFamily", value: "inter" },
      { key: "fontSizePx", value: "16" },
      { key: "zoomPercent", value: "100" },
      { key: "theme", value: "dark" },
    ]);
    await startSettingsLoad();

    commitSettings({ fontFamily: "jetbrains" });
    await vi.waitFor(() => expect(execute).toHaveBeenCalled());

    const [sql, params] = execute.mock.calls[0] as [string, string[]];
    expect(select).toHaveBeenCalledWith("SELECT key, value FROM app_settings");
    expect(sql).not.toContain("theme");
    expect(sql).not.toContain("DELETE");
    expect(sql).not.toContain("jetbrains");
    expect(sql.split("(?, ?)").length - 1).toBe(1);
    expect(params).toEqual(["fontFamily", "jetbrains"]);
  });

  it("writes a second edit only after the first snapshot finishes", async () => {
    const calls: unknown[][] = [];
    let releaseFirstWrite = () => {};
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    execute.mockImplementation(async (_query: string, bindValues?: unknown[]) => {
      calls.push(bindValues ?? []);
      if (calls.length === 1) await firstWrite;
      return { rowsAffected: 1 };
    });

    commitSettings({ fontFamily: "jetbrains" });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    commitSettings({ fontSizePx: 14 });
    expect(execute).toHaveBeenCalledTimes(1);

    releaseFirstWrite();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(calls).toEqual([
      ["fontFamily", "jetbrains"],
      ["fontSizePx", "14"],
    ]);
    expect(getAppliedSettings()).toEqual({
      fontFamily: "jetbrains",
      fontSizePx: 14,
      zoomPercent: 100,
    });
    expect(readSettingsCache()).toEqual(getAppliedSettings());
  });

  it("keeps a newer edit when an older save fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    execute.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new Error("disk full");
      return { rowsAffected: 1 };
    });

    commitSettings({ fontFamily: "jetbrains" });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    commitSettings({ fontSizePx: 14 });
    await vi.waitFor(() =>
      expect(getConfirmedSettings()).toEqual({
        fontFamily: "jetbrains",
        fontSizePx: 14,
        zoomPercent: 100,
      }),
    );

    expect(getAppliedSettings()).toEqual(getConfirmedSettings());
    expect(getSettingsSaveError()).toBeNull();
    expect(readSettingsCache()).toEqual(getAppliedSettings());
    errorSpy.mockRestore();
  });

  it("rolls back to the last confirmed settings when the latest save fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    execute.mockRejectedValue(new Error("disk full"));

    commitSettings({ zoomPercent: 120 });
    expect(getAppliedSettings().zoomPercent).toBe(120);

    await vi.waitFor(() => expect(getSettingsSaveError()).toBe(SETTINGS_SAVE_ERROR));
    expect(getAppliedSettings()).toEqual(defaultSettings());
    expect(getConfirmedSettings()).toEqual(defaultSettings());
    expect(readSettingsCache()).toEqual(defaultSettings());
    errorSpy.mockRestore();
  });

  it("does not restore an intermediate edit that never saved", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let releaseFirstWrite = () => {};
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    let calls = 0;
    execute.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        await firstWrite;
        throw new Error("disk full");
      }
      throw new Error("disk full");
    });

    commitSettings({ fontFamily: "jetbrains" });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    commitSettings({ fontSizePx: 14 });
    releaseFirstWrite();

    await vi.waitFor(() => expect(getSettingsSaveError()).toBe(SETTINGS_SAVE_ERROR));
    expect(getAppliedSettings()).toEqual(defaultSettings());
    expect(readSettingsCache()).toEqual(defaultSettings());
    errorSpy.mockRestore();
  });

  it("retries the latest intent, including an edit made after the failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    execute.mockRejectedValueOnce(new Error("disk full"));

    commitSettings({ zoomPercent: 120 });
    await vi.waitFor(() => expect(getSettingsSaveError()).toBe(SETTINGS_SAVE_ERROR));

    execute.mockResolvedValue({ rowsAffected: 1 });
    commitSettings({ fontFamily: "jetbrains" });
    await vi.waitFor(() =>
      expect(getConfirmedSettings()).toEqual({
        fontFamily: "jetbrains",
        fontSizePx: 16,
        zoomPercent: 120,
      }),
    );

    expect(getAppliedSettings()).toEqual(getConfirmedSettings());
    expect(getSettingsSaveError()).toBeNull();
    expect(readSettingsCache()).toEqual(getAppliedSettings());
    const calls = execute.mock.calls;
    const params = calls[calls.length - 1]?.[1] as string[];
    expect(params).toEqual([
      "fontFamily",
      "jetbrains",
      "zoomPercent",
      "120",
    ]);
    errorSpy.mockRestore();
  });

  it("retries a failed save without a later edit", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    execute.mockRejectedValueOnce(new Error("disk full"));
    commitSettings({ zoomPercent: 130 });
    await vi.waitFor(() => expect(getSettingsSaveError()).toBe(SETTINGS_SAVE_ERROR));

    execute.mockResolvedValue({ rowsAffected: 1 });
    retrySettingsSave();
    await vi.waitFor(() => expect(getConfirmedSettings().zoomPercent).toBe(130));
    expect(getAppliedSettings().zoomPercent).toBe(130);
    expect(getSettingsSaveError()).toBeNull();
    expect(readSettingsCache()?.zoomPercent).toBe(130);
    errorSpy.mockRestore();
  });

  it("does not let a delayed load replace a newer edit", async () => {
    resetSettingsStoreForTests();
    localStorage.clear();
    let releaseLoad = () => {};
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    select.mockImplementation(async () => {
      await loadGate;
      return [
        { key: "fontFamily", value: "jetbrains" },
        { key: "fontSizePx", value: "12" },
        { key: "zoomPercent", value: "100" },
      ];
    });

    const loading = startSettingsLoad();
    commitSettings({ fontSizePx: 18 });
    releaseLoad();
    await loading;

    expect(getAppliedSettings()).toEqual({
      fontFamily: "jetbrains",
      fontSizePx: 18,
      zoomPercent: 100,
    });
  });

  it("keeps going when the cache write throws after a successful save", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });

    commitSettings({ zoomPercent: 140 });
    await vi.waitFor(() => expect(execute).toHaveBeenCalled());
    expect(getSettingsSaveError()).toBeNull();
    expect(getAppliedSettings().zoomPercent).toBe(140);
    expect(getConfirmedSettings().zoomPercent).toBe(140);
    setItem.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("settings load failure", () => {
  beforeEach(() => {
    execute.mockReset();
    execute.mockResolvedValue({ rowsAffected: 1 });
    select.mockReset();
    resetSettingsStoreForTests();
    localStorage.clear();
  });

  it("keeps database rows intact and can retry without dropping a newer edit", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    select.mockRejectedValueOnce(new Error("database locked"));
    hydrateSettings(defaultSettings());

    await startSettingsLoad();

    expect(getSettingsLoadError()).toBe(SETTINGS_LOAD_ERROR_DEFAULTS);
    expect(localStorage.getItem(SETTINGS_CACHE_KEY)).toBeNull();

    commitSettings({ zoomPercent: 140 });
    await vi.waitFor(() => expect(execute).toHaveBeenCalled());
    const [sql, params] = execute.mock.calls[0] as [string, string[]];
    expect(sql.split("(?, ?)").length - 1).toBe(1);
    expect(params).toEqual(["zoomPercent", "140"]);
    expect(localStorage.getItem(SETTINGS_CACHE_KEY)).toBeNull();

    select.mockResolvedValueOnce([
      { key: "fontFamily", value: "jetbrains" },
      { key: "fontSizePx", value: "12" },
      { key: "zoomPercent", value: "100" },
      { key: "theme", value: "dark" },
    ]);
    retrySettingsLoad();
    await vi.waitFor(() =>
      expect(getAppliedSettings().fontFamily).toBe("jetbrains"),
    );

    expect(getSettingsLoadError()).toBeNull();

    expect(getAppliedSettings()).toEqual({
      fontFamily: "jetbrains",
      fontSizePx: 12,
      zoomPercent: 140,
    });
    expect(execute.mock.calls.some((call) => String(call[0]).includes("theme"))).toBe(
      false,
    );
    expect(execute.mock.calls.some((call) => String(call[0]).includes("DELETE"))).toBe(
      false,
    );
    errorSpy.mockRestore();
  });
});
