import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindAppearanceEffects,
  fontStackFor,
  requestZoom,
  resetAppearanceForTests,
  whenZoomSettled,
} from "./appearance";
import {
  commitSettings,
  defaultSettings,
  hydrateSettings,
  resetSettingsStoreForTests,
} from "./settings";

const { setZoom } = vi.hoisted(() => ({
  setZoom: vi.fn(async (_factor: number) => undefined),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom }),
}));

vi.mock("./database", () => ({
  getDatabase: async () => ({
    execute: vi.fn(async () => ({ rowsAffected: 1 })),
    select: vi.fn(async () => []),
  }),
}));

describe("fontStackFor", () => {
  it("returns the stack for Inter", () => {
    expect(fontStackFor("inter")).toContain("Inter");
  });

  it("returns the stack for JetBrains Mono", () => {
    expect(fontStackFor("jetbrains")).toContain("JetBrains Mono");
  });
});

describe("appearance effects", () => {
  beforeEach(() => {
    resetSettingsStoreForTests();
    resetAppearanceForTests();
    document.documentElement.removeAttribute("style");
    setZoom.mockReset();
    setZoom.mockResolvedValue(undefined);
    bindAppearanceEffects();
  });

  it("sets the root font size from the setting and leaves the mono font alone", () => {
    hydrateSettings({ ...defaultSettings(), fontSizePx: 18, fontFamily: "jetbrains" });

    const root = document.documentElement;
    expect(root.style.fontSize).toBe("18px");
    expect(root.style.fontFamily).toBe("");
    expect(root.style.getPropertyValue("--text-base")).toBe("");
    expect(root.style.getPropertyValue("--font-sans")).toContain("JetBrains Mono");
    expect(root.style.getPropertyValue("--font-mono")).toBe("");
  });

  it("does not send zoom when only the font changes", async () => {
    hydrateSettings(defaultSettings());
    await whenZoomSettled();
    setZoom.mockClear();

    commitSettings({ fontFamily: "jetbrains" });
    await whenZoomSettled();

    expect(setZoom).not.toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue("--font-sans")).toContain(
      "JetBrains Mono",
    );
  });

  it("sends only the latest zoom when several changes happen before the IPC starts", async () => {
    requestZoom(110);
    requestZoom(120);
    requestZoom(150);
    await whenZoomSettled();

    expect(setZoom.mock.calls.map((call) => call[0])).toEqual([1.5]);
  });

  it("skips intermediate zoom values that arrive while one call is in flight", async () => {
    let release: (value?: undefined) => void = () => undefined;
    setZoom.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          release = resolve;
        }),
    );

    requestZoom(110);
    await vi.waitFor(() => expect(setZoom).toHaveBeenCalledWith(1.1));
    requestZoom(120);
    requestZoom(150);
    release();
    await vi.waitFor(() => expect(setZoom).toHaveBeenCalledWith(1.5));
    release();
    await whenZoomSettled();

    expect(setZoom.mock.calls.map((call) => call[0])).toEqual([1.1, 1.5]);
  });

  it("does not reject the zoom chain when the IPC fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setZoom.mockRejectedValueOnce(new Error("zoom failed"));

    requestZoom(140);
    await expect(whenZoomSettled()).resolves.toBeUndefined();
    expect(setZoom).toHaveBeenCalledWith(1.4);
    errorSpy.mockRestore();
  });
});
