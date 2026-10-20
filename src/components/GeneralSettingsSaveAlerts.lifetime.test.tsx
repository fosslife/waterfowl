import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installMiniDom,
  releaseMountedRoots,
  restoreMiniDom,
  textOf,
  trackMountedRoot,
} from "../test/miniDom";
import type { MiniElement, MiniWindow } from "../test/miniDom";

const { execute } = vi.hoisted(() => ({
  execute: vi.fn(async () => ({ rowsAffected: 2 })),
}));

vi.mock("../services/database", () => ({
  getDatabase: async () => ({ execute, select: async () => [] }),
}));

let miniWindow: MiniWindow = installMiniDom();

describe("slow-save warning lifetime", () => {
  beforeAll(() => {
    miniWindow = installMiniDom();
  });

  beforeEach(() => {
    vi.resetModules();
    execute.mockReset();
  });

  afterEach(() => {
    releaseMountedRoots();
    vi.useRealTimers();
  });

  afterAll(async () => {
    await restoreMiniDom();
  });

  async function mount() {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const settings = await import("../services/generalSettings");
    const toastContext = await import("../context/ToastContext");
    const alerts = await import("./GeneralSettingsSaveAlerts");
    settings.applyLoadedGeneralSettings(settings.DEFAULT_GENERAL_SETTINGS);

    const holder: { error?: (message: string, duration?: number) => string | undefined } =
      {};
    function Probe() {
      holder.error = toastContext.useToast().error;
      return null;
    }

    const container = miniWindow.document.createElement("div");
    miniWindow.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    trackMountedRoot(root, container);
    const renderTree = (showAlerts: boolean) => {
      root.render(
        React.createElement(
          toastContext.ToastProvider,
          null,
          showAlerts ? React.createElement(alerts.GeneralSettingsSaveAlerts) : null,
          React.createElement(Probe),
        ),
      );
    };
    await React.act(async () => {
      renderTree(true);
    });
    return { React, settings, container, holder, renderTree };
  }

  async function flushSaveStart(): Promise<void> {
    for (let step = 0; step < 8; step += 1) {
      await Promise.resolve();
    }
  }

  function visibleText(container: MiniElement): string {
    return textOf(container);
  }

  it("keeps the warning visible past 14 seconds, then removes it when the save succeeds", async () => {
    vi.useFakeTimers();
    let releaseWrite: (value: { rowsAffected: number }) => void = () => {};
    execute.mockImplementation(
      () =>
        new Promise<{ rowsAffected: number }>((resolve) => {
          releaseWrite = resolve;
        }),
    );
    const screen = await mount();
    const change = screen.settings.commitGeneralChange({
      showStatusNotifications: false,
    });
    await flushSaveStart();

    await screen.React.act(async () => {
      await vi.advanceTimersByTimeAsync(
        screen.settings.GENERAL_SETTINGS_SAVE_TIMEOUT_MS,
      );
    });
    expect(visibleText(screen.container)).toContain(
      "Saving is taking longer than expected. Your settings are still being saved.",
    );
    expect(visibleText(screen.container)).not.toMatch(/previous choice|stays in effect/);

    await screen.React.act(async () => {
      await vi.advanceTimersByTimeAsync(6001);
    });
    expect(screen.settings.isGeneralSettingsSaveInFlight()).toBe(true);
    expect(visibleText(screen.container)).toContain(
      "Saving is taking longer than expected",
    );

    await screen.React.act(async () => {
      releaseWrite({ rowsAffected: 2 });
      await change.saved;
    });
    expect(visibleText(screen.container)).not.toContain(
      "Saving is taking longer than expected",
    );
  });

  it("removes the warning when the save fails and leaves the rollback message", async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let rejectWrite: (error: Error) => void = () => {};
    execute.mockImplementation(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectWrite = reject;
        }),
    );
    const screen = await mount();
    const change = screen.settings.commitGeneralChange({
      showStatusNotifications: false,
    });
    await flushSaveStart();
    await screen.React.act(async () => {
      await vi.advanceTimersByTimeAsync(
        screen.settings.GENERAL_SETTINGS_SAVE_TIMEOUT_MS,
      );
    });

    await screen.React.act(async () => {
      rejectWrite(new Error("disk full"));
      await change.saved;
    });
    const text = visibleText(screen.container);
    expect(text).not.toContain("Saving is taking longer than expected");
    expect(text).toContain("Could not save general settings. Your previous choice was restored.");

    await screen.React.act(async () => {
      await vi.advanceTimersByTimeAsync(5999);
    });
    expect(visibleText(screen.container)).toContain("previous choice was restored");
    await screen.React.act(async () => {
      await vi.advanceTimersByTimeAsync(201);
    });
    expect(visibleText(screen.container)).not.toContain("previous choice was restored");
    errorSpy.mockRestore();
  });

  it("does not remove an unrelated error when the slow-save warning is dismissed", async () => {
    vi.useFakeTimers();
    let releaseWrite: (value: { rowsAffected: number }) => void = () => {};
    execute.mockImplementation(
      () =>
        new Promise<{ rowsAffected: number }>((resolve) => {
          releaseWrite = resolve;
        }),
    );
    const screen = await mount();
    const change = screen.settings.commitGeneralChange({
      confirmDestructiveActions: false,
    });
    await flushSaveStart();
    await screen.React.act(async () => {
      await vi.advanceTimersByTimeAsync(
        screen.settings.GENERAL_SETTINGS_SAVE_TIMEOUT_MS,
      );
    });
    await screen.React.act(async () => {
      screen.holder.error?.("Schema failed");
    });

    await screen.React.act(async () => {
      releaseWrite({ rowsAffected: 2 });
      await change.saved;
    });
    const text = visibleText(screen.container);
    expect(text).not.toContain("Saving is taking longer than expected");
    expect(text).toContain("Schema failed");
  });

  it("still removes a normal error toast after six seconds", async () => {
    vi.useFakeTimers();
    const screen = await mount();
    await screen.React.act(async () => {
      screen.holder.error?.("Schema failed");
    });
    await screen.React.act(async () => {
      await vi.advanceTimersByTimeAsync(5999);
    });
    expect(visibleText(screen.container)).toContain("Schema failed");
    await screen.React.act(async () => {
      await vi.advanceTimersByTimeAsync(201);
    });
    expect(visibleText(screen.container)).not.toContain("Schema failed");
  });

  it("removes a pending slow-save warning when the alert listener unmounts", async () => {
    vi.useFakeTimers();
    execute.mockImplementation(() => new Promise<{ rowsAffected: number }>(() => {}));
    const screen = await mount();
    screen.settings.commitGeneralChange({ showStatusNotifications: false });
    await flushSaveStart();
    await screen.React.act(async () => {
      await vi.advanceTimersByTimeAsync(
        screen.settings.GENERAL_SETTINGS_SAVE_TIMEOUT_MS,
      );
    });
    expect(visibleText(screen.container)).toContain(
      "Saving is taking longer than expected",
    );

    await screen.React.act(async () => {
      screen.renderTree(false);
    });
    expect(visibleText(screen.container)).not.toContain(
      "Saving is taking longer than expected",
    );
  });
});
