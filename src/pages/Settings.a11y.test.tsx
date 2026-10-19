import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Settings } from "./Settings";
import {
  LEGACY_APPEARANCE_CACHE_KEY,
  SETTINGS_CACHE_KEY,
  SETTINGS_LOAD_ERROR_DEFAULTS,
  SETTINGS_LOAD_ERROR_SAVED_COPY,
  SETTINGS_SAVE_ERROR,
  commitSettings,
  hydrateFromStoredCache,
  resetSettingsStoreForTests,
  startSettingsLoad,
} from "@services/settings";

const { execute, select } = vi.hoisted(() => ({
  execute: vi.fn(async () => ({ rowsAffected: 1 })),
  select: vi.fn(async () => [] as { key: string; value: string }[]),
}));

vi.mock("../services/database", () => ({
  getDatabase: async () => ({
    execute,
    select,
  }),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom: vi.fn(async () => undefined) }),
}));

describe("Settings accessibility", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    resetSettingsStoreForTests();
    execute.mockReset();
    execute.mockResolvedValue({ rowsAffected: 1 });
    select.mockReset();
    select.mockResolvedValue([]);
    await startSettingsLoad();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  async function renderSettings(): Promise<void> {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/settings"]}>
          <Settings />
        </MemoryRouter>,
      );
    });
  }

  it("uses a real settings link and names each control from its heading", async () => {
    await renderSettings();

    const link = container.querySelector('a[href="/settings"]');
    expect(link?.getAttribute("aria-current")).toBe("page");
    expect(link?.textContent).toContain("Appearance");

    expect(container.querySelector("#setting-font")?.textContent).toBe("Font");
    expect(
      container.querySelector('[aria-labelledby="setting-font"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-labelledby="setting-font-size"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-labelledby="setting-zoom"]'),
    ).not.toBeNull();
    expect(container.querySelector("select[aria-label]")).toBeNull();
    expect(container.querySelector("nav")?.getAttribute("aria-label")).toBe(
      "Settings sections",
    );
    expect(container.textContent).toContain("JetBrains Mono (monospace)");
    expect(container.textContent).toContain("both apply");
  });

  it("shows one retry surface when a save fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    execute.mockRejectedValue(new Error("disk full"));
    await renderSettings();

    const font = container.querySelector(
      '[aria-labelledby="setting-font"]',
    ) as HTMLSelectElement;
    await act(async () => {
      font.value = "jetbrains";
      font.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(container.querySelector("[role='alert']")?.textContent).toContain(
        SETTINGS_SAVE_ERROR,
      );
    });
    expect(container.querySelectorAll("[role='alert']")).toHaveLength(1);

    execute.mockResolvedValue({ rowsAffected: 1 });
    await act(async () => {
      container.querySelector("[role='alert'] button")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await vi.waitFor(() => {
      expect(container.querySelector("[role='alert']")).toBeNull();
    });
    errorSpy.mockRestore();
  });

  it("does not miss a settings update that happens before passive effects", async () => {
    function UpdateDuringLayout() {
      useLayoutEffect(() => {
        commitSettings({ fontSizePx: 18 });
      }, []);
      return (
        <MemoryRouter initialEntries={["/settings"]}>
          <Settings />
        </MemoryRouter>
      );
    }

    await act(async () => {
      root.render(<UpdateDuringLayout />);
    });

    const size = container.querySelector(
      '[aria-labelledby="setting-font-size"]',
    ) as HTMLSelectElement;
    expect(size.value).toBe("18");
  });
});

describe("Settings load error", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    resetSettingsStoreForTests();
    localStorage.clear();
    execute.mockReset();
    execute.mockResolvedValue({ rowsAffected: 1 });
    select.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  async function showFailedLoad(): Promise<void> {
    select.mockRejectedValueOnce(new Error("database locked"));
    hydrateFromStoredCache();
    await startSettingsLoad();
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/settings"]}>
          <Settings />
        </MemoryRouter>,
      );
    });
  }

  it("shows the saved-copy message when the current cache is usable", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(
      SETTINGS_CACHE_KEY,
      JSON.stringify({
        version: 1,
        values: { fontFamily: "jetbrains", fontSizePx: "14", zoomPercent: "120" },
      }),
    );

    await showFailedLoad();

    expect(container.textContent).toContain(SETTINGS_LOAD_ERROR_SAVED_COPY);
    expect(container.textContent).not.toContain(SETTINGS_LOAD_ERROR_DEFAULTS);
    const font = container.querySelector(
      '[aria-labelledby="setting-font"]',
    ) as HTMLSelectElement;
    expect(font.value).toBe("jetbrains");
    errorSpy.mockRestore();
  });

  it("shows the saved-copy message when only the legacy cache is usable", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(
      LEGACY_APPEARANCE_CACHE_KEY,
      JSON.stringify({ fontFamily: "jetbrains", fontSizePx: 14, zoomPercent: 110 }),
    );

    await showFailedLoad();

    expect(container.textContent).toContain(SETTINGS_LOAD_ERROR_SAVED_COPY);
    const font = container.querySelector(
      '[aria-labelledby="setting-font"]',
    ) as HTMLSelectElement;
    expect(font.value).toBe("jetbrains");
    errorSpy.mockRestore();
  });

  it("shows the defaults message when no cache exists", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await showFailedLoad();

    expect(container.textContent).toContain(SETTINGS_LOAD_ERROR_DEFAULTS);
    expect(container.textContent).not.toContain(SETTINGS_LOAD_ERROR_SAVED_COPY);
    errorSpy.mockRestore();
  });

  it("shows the defaults message when the cache is malformed", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(SETTINGS_CACHE_KEY, "{");
    localStorage.setItem(
      LEGACY_APPEARANCE_CACHE_KEY,
      JSON.stringify({ fontFamily: "jetbrains", fontSizePx: 14, zoomPercent: 110 }),
    );

    await showFailedLoad();

    expect(container.textContent).toContain(SETTINGS_LOAD_ERROR_DEFAULTS);
    const font = container.querySelector(
      '[aria-labelledby="setting-font"]',
    ) as HTMLSelectElement;
    expect(font.value).toBe("inter");
    errorSpy.mockRestore();
  });

  it("retries a failed load without dropping a newer edit", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await showFailedLoad();
    expect(container.textContent).toContain(SETTINGS_LOAD_ERROR_DEFAULTS);

    const zoom = container.querySelector(
      '[aria-labelledby="setting-zoom"]',
    ) as HTMLSelectElement;
    await act(async () => {
      zoom.value = "140";
      zoom.dispatchEvent(new Event("change", { bubbles: true }));
    });

    select.mockResolvedValueOnce([
      { key: "fontFamily", value: "jetbrains" },
      { key: "fontSizePx", value: "12" },
      { key: "zoomPercent", value: "100" },
    ]);
    await act(async () => {
      container.querySelector("[role='alert'] button")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await vi.waitFor(() => {
      expect(container.textContent).not.toContain(SETTINGS_LOAD_ERROR_DEFAULTS);
    });

    const font = container.querySelector(
      '[aria-labelledby="setting-font"]',
    ) as HTMLSelectElement;
    const size = container.querySelector(
      '[aria-labelledby="setting-font-size"]',
    ) as HTMLSelectElement;
    expect(font.value).toBe("jetbrains");
    expect(size.value).toBe("12");
    expect(zoom.value).toBe("140");
    errorSpy.mockRestore();
  });
});
