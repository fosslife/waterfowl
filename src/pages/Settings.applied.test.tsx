import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, select } = vi.hoisted(() => ({
  execute: vi.fn(async () => ({ rowsAffected: 2 })),
  select: vi.fn(async () => [] as { key: string; value: string }[]),
}));

vi.mock("../services/database", () => ({
  getDatabase: async () => ({ execute, select }),
}));

describe("settings switch", () => {
  beforeEach(() => {
    vi.resetModules();
    execute.mockReset();
    select.mockReset();
    select.mockResolvedValue([]);
  });

  async function loadSettingsPage() {
    const settings = await import("../services/generalSettings");
    settings.applyLoadedGeneralSettings(settings.DEFAULT_GENERAL_SETTINGS);
    const page = await import("./Settings");
    return { settings, Settings: page.Settings };
  }

  it("shows the selected value while the write is open and keeps it after success", async () => {
    let resolveWrite: (value: { rowsAffected: number }) => void = () => {};
    execute.mockImplementation(
      () =>
        new Promise<{ rowsAffected: number }>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    const { settings, Settings } = await loadSettingsPage();
    const change = settings.commitGeneralChange({
      confirmDestructiveActions: false,
    });

    const pendingHtml = renderToStaticMarkup(<Settings />);
    expect(pendingHtml).toContain(">Off<");
    expect(settings.shouldConfirmDestructiveAction()).toBe(true);

    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    resolveWrite({ rowsAffected: 2 });
    await expect(change.saved).resolves.toBe("saved");
    const savedHtml = renderToStaticMarkup(<Settings />);
    expect(savedHtml).toContain(">Off<");
    expect(settings.getAppliedGeneralSettings().confirmDestructiveActions).toBe(
      false,
    );
  });

  it("restores the switch label when the save fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let rejectWrite: (error: Error) => void = () => {};
    execute.mockImplementation(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectWrite = reject;
        }),
    );
    const { settings, Settings } = await loadSettingsPage();
    const change = settings.commitGeneralChange({
      confirmDestructiveActions: false,
    });

    expect(renderToStaticMarkup(<Settings />)).toContain(">Off<");
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    rejectWrite(new Error("disk full"));
    await expect(change.saved).resolves.toBe("failed-rolled-back");
    expect(renderToStaticMarkup(<Settings />)).not.toContain(">Off<");
    expect(renderToStaticMarkup(<Settings />)).toContain(">On<");
    errorSpy.mockRestore();
  });
});
