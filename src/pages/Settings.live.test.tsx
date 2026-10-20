import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installMiniDom,
  reactHandler,
  releaseMountedRoots,
  restoreMiniDom,
  trackMountedRoot,
  walkElements,
} from "../test/miniDom";
import type { MiniElement, MiniInput, MiniNode, MiniWindow } from "../test/miniDom";

let miniWindow: MiniWindow = installMiniDom();

const { execute, select } = vi.hoisted(() => ({
  execute: vi.fn(async () => ({ rowsAffected: 2 })),
  select: vi.fn(async () => [] as { key: string; value: string }[]),
}));

vi.mock("../services/database", () => ({
  getDatabase: async () => ({ execute, select }),
}));

const CONFIRM = "Confirm before deleting a connection";
const NOTIFICATIONS = "Show success and information notifications";

describe("mounted settings screen", () => {
  beforeAll(() => {
    miniWindow = installMiniDom();
  });

  beforeEach(() => {
    vi.resetModules();
    execute.mockReset();
    select.mockReset();
    select.mockResolvedValue([]);
  });

  afterEach(() => {
    releaseMountedRoots();
  });

  afterAll(async () => {
    await restoreMiniDom();
  });

  async function mount() {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const settings = await import("../services/generalSettings");
    settings.applyLoadedGeneralSettings(settings.DEFAULT_GENERAL_SETTINGS);
    const page = await import("./Settings");
    const container = miniWindow.document.createElement("div");
    miniWindow.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    trackMountedRoot(root, container);
    await React.act(async () => {
      root.render(React.createElement(page.Settings));
    });
    return { React, root, container, settings };
  }

  function switches(container: MiniElement): MiniInput[] {
    const found: MiniInput[] = [];
    walkElements(container as unknown as MiniNode, (element) => {
      if (element.tagName === "INPUT") found.push(element as MiniInput);
    });
    return found;
  }

  function switchByLabel(container: MiniElement, label: string): MiniInput {
    const input = switches(container).find(
      (item) => item.getAttribute("aria-label") === label,
    );
    if (!input) throw new Error(`Missing switch: ${label}`);
    return input;
  }

  function switchText(input: MiniInput): string {
    return input.parentNode?.parentNode?.childNodes[0]?.textContent ?? "";
  }

  async function moveSwitch(
    input: MiniInput,
    checked: boolean,
    act: typeof import("react").act,
  ): Promise<void> {
    await act(async () => {
      input.checked = checked;
      reactHandler(input, "onChange")?.({ target: input });
    });
  }

  it("updates the open screen as soon as a switch is clicked, then keeps the saved value", async () => {
    let resolveWrite: (value: { rowsAffected: number }) => void = () => {};
    execute.mockImplementation(
      () =>
        new Promise<{ rowsAffected: number }>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    const screen = await mount();
    const input = switchByLabel(screen.container, CONFIRM);
    expect(switchText(input)).toBe("On");
    expect(input.checked).toBe(true);

    await moveSwitch(input, false, screen.React.act);
    const pending = switchByLabel(screen.container, CONFIRM);
    expect(switchText(pending)).toBe("Off");
    expect(pending.checked).toBe(false);
    expect(pending.nextSibling).toBeTruthy();
    expect(screen.settings.shouldConfirmDestructiveAction()).toBe(true);

    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    resolveWrite({ rowsAffected: 2 });
    await vi.waitFor(() => {
      expect(screen.settings.isGeneralSettingsSaveInFlight()).toBe(false);
    });
    const saved = switchByLabel(screen.container, CONFIRM);
    expect(switchText(saved)).toBe("Off");
    expect(saved.checked).toBe(false);
    expect(saved.disabled).toBe(false);
  });

  it("restores the open screen when the latest save fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let rejectWrite: (error: Error) => void = () => {};
    execute.mockImplementation(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectWrite = reject;
        }),
    );
    const screen = await mount();
    const input = switchByLabel(screen.container, CONFIRM);
    await moveSwitch(input, false, screen.React.act);
    expect(switchText(switchByLabel(screen.container, CONFIRM))).toBe("Off");

    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    rejectWrite(new Error("disk full"));
    await vi.waitFor(() => {
      expect(screen.settings.isGeneralSettingsSaveInFlight()).toBe(false);
    });
    const restored = switchByLabel(screen.container, CONFIRM);
    expect(switchText(restored)).toBe("On");
    expect(restored.checked).toBe(true);
    expect(screen.settings.shouldConfirmDestructiveAction()).toBe(true);
    errorSpy.mockRestore();
  });

  it("keeps a newer choice on screen when an older save fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const writes: {
      resolve: (value: { rowsAffected: number }) => void;
      reject: (error: Error) => void;
    }[] = [];
    execute.mockImplementation(
      () =>
        new Promise<{ rowsAffected: number }>((resolve, reject) => {
          writes.push({ resolve, reject });
        }),
    );
    const screen = await mount();
    const confirm = switchByLabel(screen.container, CONFIRM);
    const notifications = switchByLabel(screen.container, NOTIFICATIONS);

    await screen.React.act(async () => {
      confirm.checked = false;
      reactHandler(confirm, "onChange")?.({ target: confirm });
      notifications.checked = false;
      reactHandler(notifications, "onChange")?.({ target: notifications });
    });

    expect(switchText(switchByLabel(screen.container, CONFIRM))).toBe("Off");
    expect(switchText(switchByLabel(screen.container, NOTIFICATIONS))).toBe(
      "Off",
    );

    await vi.waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    writes[0]?.reject(new Error("disk full"));
    await vi.waitFor(() => {
      expect(writes).toHaveLength(2);
    });
    expect(switchText(switchByLabel(screen.container, CONFIRM))).toBe("Off");
    expect(switchText(switchByLabel(screen.container, NOTIFICATIONS))).toBe(
      "Off",
    );

    writes[1]?.resolve({ rowsAffected: 2 });
    await vi.waitFor(() => {
      expect(screen.settings.isGeneralSettingsSaveInFlight()).toBe(false);
    });
    expect(switchText(switchByLabel(screen.container, CONFIRM))).toBe("Off");
    expect(switchText(switchByLabel(screen.container, NOTIFICATIONS))).toBe(
      "Off",
    );
    expect(screen.settings.getConfirmedGeneralSettings()).toEqual({
      confirmDestructiveActions: false,
      showStatusNotifications: false,
    });
    errorSpy.mockRestore();
  });
});
