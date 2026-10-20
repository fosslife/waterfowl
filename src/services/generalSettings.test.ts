import { beforeEach, describe, expect, it, vi } from "vitest";

type SettingsRow = { key: string; value: string };

const { execute, select } = vi.hoisted(() => ({
  execute: vi.fn(
    async (_query: string, _bindValues?: unknown[]) => ({ rowsAffected: 2 }),
  ),
  select: vi.fn(async () => [] as SettingsRow[]),
}));

vi.mock("./database", () => ({
  getDatabase: async () => ({ execute, select }),
}));

describe("general settings", () => {
  beforeEach(() => {
    vi.resetModules();
    execute.mockReset();
    execute.mockResolvedValue({ rowsAffected: 2 });
    select.mockReset();
    select.mockResolvedValue([]);
  });

  async function importReady() {
    const settings = await import("./generalSettings");
    settings.applyLoadedGeneralSettings(settings.DEFAULT_GENERAL_SETTINGS);
    return settings;
  }

  async function flushSaveStart() {
    for (let step = 0; step < 8; step += 1) {
      await Promise.resolve();
    }
  }

  it("loads both defaults when no rows are saved", async () => {
    const { getGeneralSettings, DEFAULT_GENERAL_SETTINGS } = await import(
      "./generalSettings"
    );
    await expect(getGeneralSettings()).resolves.toEqual(
      DEFAULT_GENERAL_SETTINGS,
    );
  });

  it("loads saved true and false values", async () => {
    select.mockResolvedValue([
      { key: "general.confirmDestructiveActions", value: "false" },
      { key: "general.showStatusNotifications", value: "true" },
    ]);
    const { getGeneralSettings } = await import("./generalSettings");
    await expect(getGeneralSettings()).resolves.toEqual({
      confirmDestructiveActions: false,
      showStatusNotifications: true,
    });
  });

  it("falls back when a stored value is missing or not exactly true or false", async () => {
    const { normalizeGeneralSettings, DEFAULT_GENERAL_SETTINGS } = await import(
      "./generalSettings"
    );
    expect(normalizeGeneralSettings({})).toEqual(DEFAULT_GENERAL_SETTINGS);
    expect(
      normalizeGeneralSettings({
        "general.confirmDestructiveActions": "yes",
        "general.showStatusNotifications": "1",
      }),
    ).toEqual(DEFAULT_GENERAL_SETTINGS);
    expect(
      normalizeGeneralSettings({
        "general.confirmDestructiveActions": "",
        "general.showStatusNotifications": "TRUE",
      }),
    ).toEqual(DEFAULT_GENERAL_SETTINGS);
  });

  it("saves only true or false on the general keys", async () => {
    const { commitGeneralChange } = await importReady();
    const change = commitGeneralChange({ confirmDestructiveActions: false });
    await expect(change.saved).resolves.toBe("saved");
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO app_settings"),
      [
        "general.confirmDestructiveActions",
        "false",
        "general.showStatusNotifications",
        "true",
      ],
    );
  });

  it("restores the previous value when a save fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    execute.mockRejectedValue(new Error("disk full"));
    const { commitGeneralChange, getAppliedGeneralSettings } = await importReady();
    const change = commitGeneralChange({ showStatusNotifications: false });
    await expect(change.saved).resolves.toBe("failed-rolled-back");
    expect(getAppliedGeneralSettings().showStatusNotifications).toBe(true);
    errorSpy.mockRestore();
  });

  it("does not let a late load overwrite a newer choice", async () => {
    const {
      commitGeneralChange,
      applyLoadedGeneralSettings,
      getAppliedGeneralSettings,
      DEFAULT_GENERAL_SETTINGS,
    } = await importReady();
    commitGeneralChange({ confirmDestructiveActions: false });
    const applied = applyLoadedGeneralSettings(DEFAULT_GENERAL_SETTINGS);
    expect(applied).toBe(false);
    expect(getAppliedGeneralSettings().confirmDestructiveActions).toBe(false);
  });

  it("hides success and info when notifications are off, and keeps errors and warnings", async () => {
    const { commitGeneralChange, allowsStatusNotification } = await importReady();
    expect(allowsStatusNotification("success")).toBe(true);
    commitGeneralChange({ showStatusNotifications: false });
    expect(allowsStatusNotification("success")).toBe(false);
    expect(allowsStatusNotification("info")).toBe(false);
    expect(allowsStatusNotification("error")).toBe(true);
    expect(allowsStatusNotification("warning")).toBe(true);
  });

  it("writes the next snapshot only after the previous save finishes", async () => {
    const calls: unknown[][] = [];
    let releaseFirstWrite = () => {};
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    execute.mockImplementation(async (_query: string, bindValues?: unknown[]) => {
      calls.push(bindValues ?? []);
      if (calls.length === 1) await firstWrite;
      return { rowsAffected: 2 };
    });

    const { commitGeneralChange } = await importReady();
    const first = commitGeneralChange({ confirmDestructiveActions: false });
    const second = commitGeneralChange({ showStatusNotifications: false });

    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    releaseFirstWrite();
    await expect(first.saved).resolves.toBe("saved");
    await expect(second.saved).resolves.toBe("saved");
    expect(calls[1]).toEqual([
      "general.confirmDestructiveActions",
      "false",
      "general.showStatusNotifications",
      "false",
    ]);
  });

  it("keeps a newer edit when an older save fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    execute.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new Error("disk full");
      return { rowsAffected: 2 };
    });

    const { commitGeneralChange, getAppliedGeneralSettings } = await importReady();
    const first = commitGeneralChange({ confirmDestructiveActions: false });
    const second = commitGeneralChange({ showStatusNotifications: false });
    await expect(first.saved).resolves.toBe("failed-superseded");
    await expect(second.saved).resolves.toBe("saved");
    expect(getAppliedGeneralSettings()).toEqual({
      confirmDestructiveActions: false,
      showStatusNotifications: false,
    });
    errorSpy.mockRestore();
  });

  it("resets only the two general values in one write", async () => {
    const { commitGeneralChange, resetGeneralSettings, getAppliedGeneralSettings } =
      await importReady();
    commitGeneralChange({
      confirmDestructiveActions: false,
      showStatusNotifications: false,
    });
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    execute.mockClear();

    const reset = resetGeneralSettings();
    await expect(reset.saved).resolves.toBe("saved");
    expect(getAppliedGeneralSettings()).toEqual({
      confirmDestructiveActions: true,
      showStatusNotifications: true,
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.any(String), [
      "general.confirmDestructiveActions",
      "true",
      "general.showStatusNotifications",
      "true",
    ]);
  });

  it("does not write or block a later load while settings are still loading", async () => {
    const {
      beginGeneralSettingsLoad,
      commitGeneralChange,
      applyLoadedGeneralSettings,
      getAppliedGeneralSettings,
      getGeneralSettingsLoadState,
    } = await import("./generalSettings");

    beginGeneralSettingsLoad();
    const blocked = commitGeneralChange({ confirmDestructiveActions: false });
    await expect(blocked.saved).resolves.toBe("failed-not-ready");
    expect(execute).not.toHaveBeenCalled();
    expect(getAppliedGeneralSettings().confirmDestructiveActions).toBe(true);

    const applied = applyLoadedGeneralSettings({
      confirmDestructiveActions: false,
      showStatusNotifications: true,
    });
    expect(applied).toBe(true);
    expect(getGeneralSettingsLoadState()).toBe("ready");
    expect(getAppliedGeneralSettings().confirmDestructiveActions).toBe(false);
  });

  it("does not write after a failed load until a later read succeeds", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    select.mockRejectedValue(new Error("settings unreadable"));
    const {
      reloadGeneralSettings,
      commitGeneralChange,
      getAppliedGeneralSettings,
      getGeneralSettingsLoadState,
    } = await import("./generalSettings");

    await expect(reloadGeneralSettings()).resolves.toBe("failed");
    const blocked = commitGeneralChange({ showStatusNotifications: false });
    await expect(blocked.saved).resolves.toBe("failed-not-ready");
    expect(execute).not.toHaveBeenCalled();
    expect(getAppliedGeneralSettings().showStatusNotifications).toBe(true);

    select.mockResolvedValue([
      { key: "general.confirmDestructiveActions", value: "false" },
      { key: "general.showStatusNotifications", value: "false" },
    ]);
    await expect(reloadGeneralSettings()).resolves.toBe("ready");
    expect(getGeneralSettingsLoadState()).toBe("ready");
    expect(getAppliedGeneralSettings()).toEqual({
      confirmDestructiveActions: false,
      showStatusNotifications: false,
    });
    errorSpy.mockRestore();
  });

  it("shares one database read when loading is requested twice", async () => {
    let releaseSelect: (rows: SettingsRow[]) => void = () => {};
    select.mockImplementation(
      () =>
        new Promise<SettingsRow[]>((resolve) => {
          releaseSelect = resolve;
        }),
    );
    const { reloadGeneralSettings } = await import("./generalSettings");

    const first = reloadGeneralSettings();
    const second = reloadGeneralSettings();
    await vi.waitFor(() => {
      expect(select).toHaveBeenCalledTimes(1);
    });

    releaseSelect([
      { key: "general.confirmDestructiveActions", value: "false" },
      { key: "general.showStatusNotifications", value: "true" },
    ]);
    await expect(first).resolves.toBe("ready");
    await expect(second).resolves.toBe("ready");
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("does not read again from the one-time startup helper", async () => {
    const { startGeneralSettingsLoadOnce } = await import("./generalSettings");

    await startGeneralSettingsLoadOnce();
    select.mockClear();
    await startGeneralSettingsLoadOnce();
    expect(select).not.toHaveBeenCalled();
  });

  it("reports the finished status to a listener attached after loading", async () => {
    select.mockResolvedValue([
      { key: "general.confirmDestructiveActions", value: "false" },
      { key: "general.showStatusNotifications", value: "true" },
    ]);
    const {
      reloadGeneralSettings,
      subscribeGeneralSettings,
      getGeneralSettingsLoadState,
      getAppliedGeneralSettings,
    } = await import("./generalSettings");

    await reloadGeneralSettings();
    let observed: string | null = null;
    subscribeGeneralSettings(() => {
      observed = getGeneralSettingsLoadState();
    });

    expect(observed).toBe("ready");
    expect(getAppliedGeneralSettings()).toEqual({
      confirmDestructiveActions: false,
      showStatusNotifications: true,
    });
  });

  it("loads the saved values when retry runs after a failed read", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    select.mockRejectedValueOnce(new Error("settings unreadable"));
    const {
      reloadGeneralSettings,
      commitGeneralChange,
      getAppliedGeneralSettings,
      getGeneralSettingsLoadState,
    } = await import("./generalSettings");

    await expect(reloadGeneralSettings()).resolves.toBe("failed");
    const blocked = commitGeneralChange({ confirmDestructiveActions: false });
    await expect(blocked.saved).resolves.toBe("failed-not-ready");

    select.mockResolvedValue([
      { key: "general.confirmDestructiveActions", value: "false" },
      { key: "general.showStatusNotifications", value: "false" },
    ]);
    await expect(reloadGeneralSettings()).resolves.toBe("ready");
    expect(getGeneralSettingsLoadState()).toBe("ready");
    expect(getAppliedGeneralSettings()).toEqual({
      confirmDestructiveActions: false,
      showStatusNotifications: false,
    });
    const saved = commitGeneralChange({ showStatusNotifications: true });
    await expect(saved.saved).resolves.toBe("saved");
    errorSpy.mockRestore();
  });

  it("restores the last stored values when two saves fail in a row", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    execute.mockRejectedValue(new Error("disk full"));
    const {
      commitGeneralChange,
      getAppliedGeneralSettings,
      shouldConfirmDestructiveAction,
    } = await importReady();

    const first = commitGeneralChange({ confirmDestructiveActions: false });
    const second = commitGeneralChange({ showStatusNotifications: false });
    await expect(first.saved).resolves.toBe("failed-superseded");
    await expect(second.saved).resolves.toBe("failed-rolled-back");
    expect(getAppliedGeneralSettings()).toEqual({
      confirmDestructiveActions: true,
      showStatusNotifications: true,
    });
    expect(shouldConfirmDestructiveAction()).toBe(true);
    errorSpy.mockRestore();
  });

  it("keeps a later successful save after an earlier save fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const {
      commitGeneralChange,
      getAppliedGeneralSettings,
      shouldConfirmDestructiveAction,
    } = await importReady();

    execute.mockRejectedValueOnce(new Error("disk full"));
    const failed = commitGeneralChange({ confirmDestructiveActions: false });
    await expect(failed.saved).resolves.toBe("failed-rolled-back");
    expect(shouldConfirmDestructiveAction()).toBe(true);

    const saved = commitGeneralChange({ confirmDestructiveActions: false });
    await expect(saved.saved).resolves.toBe("saved");
    expect(getAppliedGeneralSettings().confirmDestructiveActions).toBe(false);
    expect(shouldConfirmDestructiveAction()).toBe(false);
    errorSpy.mockRestore();
  });

  it("keeps delete confirmation on while turning it off is still saving", async () => {
    let releaseWrite: () => void = () => {};
    execute.mockImplementation(
      () =>
        new Promise<{ rowsAffected: number }>((resolve) => {
          releaseWrite = () => resolve({ rowsAffected: 2 });
        }),
    );
    const {
      commitGeneralChange,
      getAppliedGeneralSettings,
      shouldConfirmDestructiveAction,
    } = await importReady();

    const change = commitGeneralChange({ confirmDestructiveActions: false });
    expect(getAppliedGeneralSettings().confirmDestructiveActions).toBe(false);
    expect(shouldConfirmDestructiveAction()).toBe(true);

    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    releaseWrite();
    await expect(change.saved).resolves.toBe("saved");
    expect(shouldConfirmDestructiveAction()).toBe(false);
  });

  it("reports a failed save after the settings screen unsubscribes", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let rejectWrite: (error: Error) => void = () => {};
    execute.mockImplementation(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectWrite = reject;
        }),
    );
    const {
      commitGeneralChange,
      getConfirmedGeneralSettings,
      shouldConfirmDestructiveAction,
      subscribeGeneralSaveOutcomes,
      subscribeGeneralSettings,
    } = await importReady();

    const outcomes: string[] = [];
    const stopReports = subscribeGeneralSaveOutcomes((outcome) => {
      outcomes.push(outcome);
    });
    const stopScreen = subscribeGeneralSettings(() => {
      getConfirmedGeneralSettings();
    });

    const change = commitGeneralChange({ confirmDestructiveActions: false });
    await flushSaveStart();
    expect(execute).toHaveBeenCalledTimes(1);
    stopScreen();
    rejectWrite(new Error("disk full"));
    await expect(change.saved).resolves.toBe("failed-rolled-back");

    expect(outcomes).toEqual(["failed-rolled-back"]);
    expect(getConfirmedGeneralSettings().confirmDestructiveActions).toBe(true);
    expect(shouldConfirmDestructiveAction()).toBe(true);

    let seenAfterReturn: boolean | null = null;
    subscribeGeneralSettings(() => {
      seenAfterReturn =
        getConfirmedGeneralSettings().confirmDestructiveActions;
    });
    expect(seenAfterReturn).toBe(true);
    stopReports();
    errorSpy.mockRestore();
  });

  it("lets retry replace a read that never finishes and ignores the stale result", async () => {
    vi.useFakeTimers();
    try {
      const resolvers: Array<(rows: SettingsRow[]) => void> = [];
      select.mockImplementation(
        () =>
          new Promise<SettingsRow[]>((resolve) => {
            resolvers.push(resolve);
          }),
      );
      const {
        DEFAULT_GENERAL_SETTINGS,
        GENERAL_SETTINGS_LOAD_TIMEOUT_MS,
        commitGeneralChange,
        getAppliedGeneralSettings,
        getConfirmedGeneralSettings,
        getGeneralSettingsLoadState,
        reloadGeneralSettings,
      } = await import("./generalSettings");

      const first = reloadGeneralSettings();
      await vi.advanceTimersByTimeAsync(GENERAL_SETTINGS_LOAD_TIMEOUT_MS);
      expect(getGeneralSettingsLoadState()).toBe("failed");
      expect(getConfirmedGeneralSettings()).toEqual(DEFAULT_GENERAL_SETTINGS);

      const blocked = commitGeneralChange({ confirmDestructiveActions: false });
      await expect(blocked.saved).resolves.toBe("failed-not-ready");
      expect(execute).not.toHaveBeenCalled();

      const second = reloadGeneralSettings();
      await Promise.resolve();
      await Promise.resolve();
      expect(select).toHaveBeenCalledTimes(2);

      resolvers[1]([
        { key: "general.confirmDestructiveActions", value: "true" },
        { key: "general.showStatusNotifications", value: "false" },
      ]);
      await expect(second).resolves.toBe("ready");
      expect(getAppliedGeneralSettings()).toEqual({
        confirmDestructiveActions: true,
        showStatusNotifications: false,
      });

      resolvers[0]([
        { key: "general.confirmDestructiveActions", value: "false" },
        { key: "general.showStatusNotifications", value: "true" },
      ]);
      await expect(first).resolves.toBe("ready");
      expect(getAppliedGeneralSettings()).toEqual({
        confirmDestructiveActions: true,
        showStatusNotifications: false,
      });
      expect(getConfirmedGeneralSettings().showStatusNotifications).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("warns when a save stays pending and still waits before the next write", async () => {
    vi.useFakeTimers();
    const {
      GENERAL_SETTINGS_SAVE_TIMEOUT_MS,
      commitGeneralChange,
      getConfirmedGeneralSettings,
      isGeneralSettingsSaveInFlight,
      shouldConfirmDestructiveAction,
      subscribeGeneralSaveOutcomes,
    } = await importReady();
    const outcomes: string[] = [];
    const stop = subscribeGeneralSaveOutcomes((outcome) => {
      outcomes.push(outcome);
    });

    let releaseFirst: (value: { rowsAffected: number }) => void = () => {};
    let writes = 0;
    execute.mockImplementation(
      () =>
        new Promise<{ rowsAffected: number }>((resolve) => {
          writes += 1;
          if (writes === 1) {
            releaseFirst = () => resolve({ rowsAffected: 2 });
            return;
          }
          resolve({ rowsAffected: 2 });
        }),
    );

    try {
      const first = commitGeneralChange({ confirmDestructiveActions: false });
      const second = commitGeneralChange({ showStatusNotifications: false });
      await flushSaveStart();
      expect(execute).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(GENERAL_SETTINGS_SAVE_TIMEOUT_MS);

      expect(outcomes).toEqual(["failed-timed-out"]);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(getConfirmedGeneralSettings()).toEqual({
        confirmDestructiveActions: true,
        showStatusNotifications: true,
      });
      expect(shouldConfirmDestructiveAction()).toBe(true);
      expect(isGeneralSettingsSaveInFlight()).toBe(true);

      releaseFirst({ rowsAffected: 2 });
      await expect(first.saved).resolves.toBe("saved");
      await expect(second.saved).resolves.toBe("saved");
      expect(execute).toHaveBeenCalledTimes(2);
      expect(getConfirmedGeneralSettings()).toEqual({
        confirmDestructiveActions: false,
        showStatusNotifications: false,
      });
      expect(outcomes).toEqual(["failed-timed-out", "timeout-resolved"]);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it("keeps the previous switches when reset cannot be saved", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { commitGeneralChange, resetGeneralSettings, getAppliedGeneralSettings } =
      await importReady();
    const turnedOff = commitGeneralChange({
      confirmDestructiveActions: false,
      showStatusNotifications: false,
    });
    await turnedOff.saved;
    execute.mockRejectedValueOnce(new Error("disk full"));

    const reset = resetGeneralSettings();
    await expect(reset.saved).resolves.toBe("failed-rolled-back");
    expect(getAppliedGeneralSettings()).toEqual({
      confirmDestructiveActions: false,
      showStatusNotifications: false,
    });
    errorSpy.mockRestore();
  });

  it("shows the chosen value immediately and restores it only when the save fails", async () => {
    let releaseWrite: () => void = () => {};
    let failWrite = false;
    execute.mockImplementation(
      () =>
        new Promise<{ rowsAffected: number }>((resolve, reject) => {
          releaseWrite = () => {
            if (failWrite) reject(new Error("disk full"));
            else resolve({ rowsAffected: 2 });
          };
        }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const {
      commitGeneralChange,
      getAppliedGeneralSettings,
      getConfirmedGeneralSettings,
      shouldConfirmDestructiveAction,
    } = await importReady();

    const change = commitGeneralChange({ confirmDestructiveActions: false });
    expect(getAppliedGeneralSettings().confirmDestructiveActions).toBe(false);
    expect(getConfirmedGeneralSettings().confirmDestructiveActions).toBe(true);
    expect(shouldConfirmDestructiveAction()).toBe(true);

    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    failWrite = true;
    releaseWrite();
    await expect(change.saved).resolves.toBe("failed-rolled-back");
    expect(getAppliedGeneralSettings().confirmDestructiveActions).toBe(true);
    expect(shouldConfirmDestructiveAction()).toBe(true);
    errorSpy.mockRestore();
  });

  it("uses safe defaults until startup load finishes, then honors saved notifications", async () => {
    let releaseSelect: (rows: SettingsRow[]) => void = () => {};
    select.mockImplementation(
      () =>
        new Promise<SettingsRow[]>((resolve) => {
          releaseSelect = resolve;
        }),
    );
    const {
      allowsStatusNotification,
      shouldConfirmDestructiveAction,
      startGeneralSettingsLoadOnce,
    } = await import("./generalSettings");

    const pending = startGeneralSettingsLoadOnce();
    expect(allowsStatusNotification("success")).toBe(true);
    expect(allowsStatusNotification("error")).toBe(true);
    expect(shouldConfirmDestructiveAction()).toBe(true);

    await vi.waitFor(() => {
      expect(select).toHaveBeenCalledTimes(1);
    });
    releaseSelect([
      { key: "general.confirmDestructiveActions", value: "true" },
      { key: "general.showStatusNotifications", value: "false" },
    ]);
    await expect(pending).resolves.toBe("ready");
    expect(allowsStatusNotification("success")).toBe(false);
    expect(allowsStatusNotification("info")).toBe(false);
    expect(allowsStatusNotification("error")).toBe(true);
    expect(allowsStatusNotification("warning")).toBe(true);
    expect(shouldConfirmDestructiveAction()).toBe(true);
  });

  it("clears the timeout warning when that same save fails and rolls back", async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const {
      GENERAL_SETTINGS_SAVE_TIMEOUT_MS,
      commitGeneralChange,
      getAppliedGeneralSettings,
      shouldConfirmDestructiveAction,
      subscribeGeneralSaveOutcomes,
    } = await importReady();
    const outcomes: string[] = [];
    const stop = subscribeGeneralSaveOutcomes((outcome) => {
      outcomes.push(outcome);
    });
    let rejectWrite: (error: Error) => void = () => {};
    execute.mockImplementation(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectWrite = reject;
        }),
    );

    try {
      const change = commitGeneralChange({ showStatusNotifications: false });
      await flushSaveStart();
      await vi.advanceTimersByTimeAsync(GENERAL_SETTINGS_SAVE_TIMEOUT_MS);
      expect(outcomes).toEqual(["failed-timed-out"]);
      expect(getAppliedGeneralSettings().showStatusNotifications).toBe(false);
      expect(shouldConfirmDestructiveAction()).toBe(true);

      rejectWrite(new Error("disk full"));
      await expect(change.saved).resolves.toBe("failed-rolled-back");
      expect(outcomes).toEqual([
        "failed-timed-out",
        "timeout-resolved",
        "failed-rolled-back",
      ]);
      expect(getAppliedGeneralSettings().showStatusNotifications).toBe(true);
      expect(shouldConfirmDestructiveAction()).toBe(true);
    } finally {
      stop();
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
