import { describe, expect, it } from "vitest";
import {
  generalSettingsSaveAlert,
  reduceSaveAlert,
} from "./GeneralSettingsSaveAlerts";

describe("general settings save alerts", () => {
  it("describes failures that must stay visible after Settings closes", () => {
    expect(generalSettingsSaveAlert("failed-rolled-back")).toMatch(/restored/);
    expect(generalSettingsSaveAlert("failed-timed-out")).toBe(
      "Saving is taking longer than expected. Your settings are still being saved.",
    );
    expect(generalSettingsSaveAlert("failed-timed-out")).not.toMatch(
      /previous choice|stays in effect/,
    );
    expect(generalSettingsSaveAlert("failed-not-ready")).toMatch(/not loaded/);
  });

  it("stays quiet when a save succeeds or an older save was replaced", () => {
    expect(generalSettingsSaveAlert("saved")).toBeNull();
    expect(generalSettingsSaveAlert("failed-superseded")).toBeNull();
    expect(generalSettingsSaveAlert("timeout-resolved")).toBeNull();
  });

  it("clears only the timeout warning that belongs to the finished save", () => {
    const created: string[] = [];
    const dismissed: string[] = [];
    const createToast = (message: string) => {
      created.push(message);
      return `toast-${created.length}`;
    };
    const dismissToast = (id: string) => {
      dismissed.push(id);
    };

    let ids = reduceSaveAlert([], "failed-timed-out", createToast, dismissToast);
    ids = reduceSaveAlert(ids, "failed-not-ready", createToast, dismissToast);
    expect(ids).toEqual(["toast-1"]);
    expect(dismissed).toEqual([]);

    ids = reduceSaveAlert(ids, "timeout-resolved", createToast, dismissToast);
    expect(dismissed).toEqual(["toast-1"]);
    expect(ids).toEqual([]);
    expect(created).toHaveLength(2);

    ids = reduceSaveAlert(
      ["toast-9"],
      "failed-rolled-back",
      createToast,
      dismissToast,
    );
    expect(dismissed).toEqual(["toast-1"]);
    expect(ids).toEqual(["toast-9"]);
  });

  it("asks the slow-save warning to stay until that save is dismissed", () => {
    const calls: { message: string; duration?: number }[] = [];
    const createToast = (message: string, duration?: number) => {
      calls.push({ message, duration });
      return `toast-${calls.length}`;
    };

    reduceSaveAlert([], "failed-timed-out", createToast, () => undefined);
    reduceSaveAlert([], "failed-rolled-back", createToast, () => undefined);

    expect(calls[0]).toEqual({
      message: "Saving is taking longer than expected. Your settings are still being saved.",
      duration: 0,
    });
    expect(calls[1]?.duration).toBeUndefined();
    expect(calls[1]?.message).toMatch(/restored/);
  });
});