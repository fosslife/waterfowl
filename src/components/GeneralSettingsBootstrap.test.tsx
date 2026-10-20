import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installMiniDom,
  releaseMountedRoots,
  restoreMiniDom,
  trackMountedRoot,
} from "../test/miniDom";
import type { MiniWindow } from "../test/miniDom";
import { GeneralSettingsBootstrap } from "./GeneralSettingsBootstrap";

let miniWindow: MiniWindow = installMiniDom();

const { startGeneralSettingsLoadOnce } = vi.hoisted(() => ({
  startGeneralSettingsLoadOnce: vi.fn(() => Promise.resolve("pending")),
}));

vi.mock("@services/generalSettings", () => ({
  startGeneralSettingsLoadOnce,
}));

describe("GeneralSettingsBootstrap", () => {
  beforeAll(() => {
    miniWindow = installMiniDom();
  });

  beforeEach(() => {
    startGeneralSettingsLoadOnce.mockClear();
  });

  afterEach(() => {
    releaseMountedRoots();
  });

  afterAll(async () => {
    await restoreMiniDom();
  });

  it("renders the app shell without starting a read during render", () => {
    const html = renderToStaticMarkup(
      <GeneralSettingsBootstrap>
        <div>app-shell</div>
      </GeneralSettingsBootstrap>,
    );

    expect(html).toContain("app-shell");
    expect(startGeneralSettingsLoadOnce).not.toHaveBeenCalled();
  });

  it("starts the settings load when the app shell mounts", async () => {
    const container = miniWindow.document.createElement("div");
    miniWindow.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    trackMountedRoot(root, container);

    await act(async () => {
      root.render(
        <GeneralSettingsBootstrap>
          <div>app-shell</div>
        </GeneralSettingsBootstrap>,
      );
    });

    expect(container.textContent).toContain("app-shell");
    expect(startGeneralSettingsLoadOnce).toHaveBeenCalledTimes(1);
  });
});
