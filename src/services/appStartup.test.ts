import { beforeEach, describe, expect, it, vi } from "vitest";
import { revealAppWindow } from "./appStartup";
import { bindAppearanceEffects, resetAppearanceForTests } from "./appearance";
import {
  defaultSettings,
  hydrateSettings,
  resetSettingsStoreForTests,
} from "./settings";

const { setZoom, revealMainWindow, select } = vi.hoisted(() => ({
  setZoom: vi.fn(async (_factor: number) => undefined),
  revealMainWindow: vi.fn(async (_command: string) => undefined),
  select: vi.fn(async () => [] as { key: string; value: string }[]),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string) => revealMainWindow(command),
}));

vi.mock("./database", () => ({
  getDatabase: async () => ({
    execute: vi.fn(async () => ({ rowsAffected: 1 })),
    select,
  }),
}));

describe("revealAppWindow", () => {
  beforeEach(() => {
    resetSettingsStoreForTests();
    resetAppearanceForTests();
    setZoom.mockReset();
    setZoom.mockResolvedValue(undefined);
    revealMainWindow.mockReset();
    revealMainWindow.mockResolvedValue(undefined);
    select.mockReset();
    bindAppearanceEffects();
  });

  it("applies the saved zoom before showing the window", async () => {
    const order: string[] = [];
    setZoom.mockImplementation(async (factor: number) => {
      order.push(`zoom:${factor}`);
    });
    revealMainWindow.mockImplementation(async () => {
      order.push("reveal");
    });
    select.mockResolvedValue([
      { key: "fontFamily", value: "inter" },
      { key: "fontSizePx", value: "16" },
      { key: "zoomPercent", value: "150" },
    ]);

    hydrateSettings(defaultSettings());
    await revealAppWindow();

    expect(order[order.length - 2]).toBe("zoom:1.5");
    expect(order[order.length - 1]).toBe("reveal");
    expect(revealMainWindow).toHaveBeenCalledTimes(1);
    expect(revealMainWindow).toHaveBeenCalledWith("reveal_main_window");
  });

  it("shows the window when zoom IPC fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setZoom.mockRejectedValue(new Error("zoom failed"));
    select.mockResolvedValue([]);
    hydrateSettings(defaultSettings());

    await revealAppWindow();

    expect(revealMainWindow).toHaveBeenCalledTimes(1);
    expect(revealMainWindow).toHaveBeenCalledWith("reveal_main_window");
    errorSpy.mockRestore();
  });

  it("shows the cached zoom when the database read does not finish in time", async () => {
    vi.useFakeTimers();
    try {
      select.mockImplementation(() => new Promise(() => undefined));
      hydrateSettings({ ...defaultSettings(), zoomPercent: 130 });
      await vi.advanceTimersByTimeAsync(0);

      const reveal = revealAppWindow();
      await vi.advanceTimersByTimeAsync(800);
      await reveal;

      expect(setZoom).toHaveBeenCalledWith(1.3);
      expect(revealMainWindow).toHaveBeenCalledTimes(1);
      expect(revealMainWindow).toHaveBeenCalledWith("reveal_main_window");
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for a zoom that was requested while the first call was still running", async () => {
    let releaseFirst: (value?: undefined) => void = () => undefined;
    const firstZoom = new Promise<undefined>((resolve) => {
      releaseFirst = resolve;
    });
    let releaseSecond: (value?: undefined) => void = () => undefined;
    const secondZoom = new Promise<undefined>((resolve) => {
      releaseSecond = resolve;
    });
    let calls = 0;
    setZoom.mockImplementation(() => {
      calls += 1;
      return calls === 1 ? firstZoom : secondZoom;
    });

    let releaseLoad: (rows: { key: string; value: string }[]) => void = () =>
      undefined;
    select.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseLoad = resolve;
        }),
    );

    hydrateSettings({ ...defaultSettings(), zoomPercent: 100 });
    const shown = revealAppWindow();
    await vi.waitFor(() => expect(setZoom).toHaveBeenCalledWith(1));

    releaseLoad([
      { key: "fontFamily", value: "inter" },
      { key: "fontSizePx", value: "16" },
      { key: "zoomPercent", value: "150" },
    ]);
    releaseFirst();
    await vi.waitFor(() => expect(setZoom).toHaveBeenCalledWith(1.5));

    expect(revealMainWindow).not.toHaveBeenCalled();

    releaseSecond();
    await shown;

    expect(revealMainWindow).toHaveBeenCalledTimes(1);
    expect(revealMainWindow).toHaveBeenCalledWith("reveal_main_window");
    expect(setZoom.mock.calls.map((call) => call[0])).toEqual([1, 1.5]);
  });

  it("shows the window when the follow-up zoom call fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let releaseFirst: (value?: undefined) => void = () => undefined;
    const firstZoom = new Promise<undefined>((resolve) => {
      releaseFirst = resolve;
    });
    setZoom.mockImplementationOnce(() => firstZoom);
    setZoom.mockRejectedValueOnce(new Error("zoom failed"));

    let releaseLoad: (rows: { key: string; value: string }[]) => void = () =>
      undefined;
    select.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseLoad = resolve;
        }),
    );

    hydrateSettings({ ...defaultSettings(), zoomPercent: 100 });
    const shown = revealAppWindow();
    await vi.waitFor(() => expect(setZoom).toHaveBeenCalledWith(1));

    releaseLoad([
      { key: "zoomPercent", value: "150" },
    ]);
    releaseFirst();
    await shown;

    expect(revealMainWindow).toHaveBeenCalledTimes(1);
    expect(revealMainWindow).toHaveBeenCalledWith("reveal_main_window");
    expect(setZoom.mock.calls.map((call) => call[0])).toEqual([1, 1.5]);
    errorSpy.mockRestore();
  });
});
