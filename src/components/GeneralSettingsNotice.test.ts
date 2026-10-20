import { describe, expect, it, vi } from "vitest";

vi.mock("../services/database", () => ({
  getDatabase: vi.fn(),
}));

import {
  GENERAL_SETTINGS_SLOW_LOAD_MS,
  generalSettingsNoticeCopy,
} from "./GeneralSettingsNotice";

describe("general settings notice copy", () => {
  it("hides the notice when settings are ready", () => {
    expect(generalSettingsNoticeCopy("ready", 0)).toBeNull();
  });

  it("hides the loading notice until the read has been pending for three seconds", () => {
    expect(generalSettingsNoticeCopy("pending", 0)).toBeNull();
    expect(
      generalSettingsNoticeCopy("pending", GENERAL_SETTINGS_SLOW_LOAD_MS - 1),
    ).toBeNull();
  });

  it("says still loading after three seconds and still hides retry", () => {
    expect(
      generalSettingsNoticeCopy("pending", GENERAL_SETTINGS_SLOW_LOAD_MS),
    ).toEqual({
      message: "Still loading...",
      showRetry: false,
    });
  });

  it("offers retry only after a failed read", () => {
    expect(generalSettingsNoticeCopy("failed", 0)).toEqual({
      message:
        "General settings could not be loaded. Changes are paused so a saved choice is not overwritten. Try again, or close the app and open it again.",
      showRetry: true,
    });
    expect(generalSettingsNoticeCopy("failed", GENERAL_SETTINGS_SLOW_LOAD_MS))
      .toEqual({
        message:
          "General settings could not be loaded. Changes are paused so a saved choice is not overwritten. Try again, or close the app and open it again.",
        showRetry: true,
      });
  });
});
