import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  installMiniDom,
  MiniElement,
  MiniEvent,
  MiniNode,
  releaseMountedRoots,
  restoreMiniDom,
  trackMountedRoot,
} from "./miniDom";
import type { MiniElement as MiniElementType } from "./miniDom";

const GLOBAL_NAMES = [
  "window",
  "document",
  "HTMLElement",
  "Element",
  "Node",
  "HTMLIFrameElement",
  "Event",
  "getComputedStyle",
] as const;

describe("miniDom cleanup", () => {
  let failedContainer: MiniElementType | null = null;
  let failedParentAfter: MiniNode | null = null;
  let failedCleaned = false;
  let failedChecked = false;

  afterEach(() => {
    const pending = failedContainer;
    failedContainer = null;
    releaseMountedRoots();
    if (pending) {
      failedChecked = true;
      failedParentAfter = pending.parentNode;
    }
  });

  afterAll(async () => {
    try {
      expect(failedChecked).toBe(true);
      expect(failedParentAfter).toBeNull();
      expect(failedCleaned).toBe(true);
    } finally {
      await restoreMiniDom();
    }
  });

  it("restores original global descriptors, including ones that were missing", async () => {
    const before = new Map(
      GLOBAL_NAMES.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
    );
    expect(before.get("window")).toBeUndefined();

    function sentinel() {
      return "sentinel";
    }
    const styleWasMissing = before.get("getComputedStyle") === undefined;
    if (styleWasMissing) {
      Object.defineProperty(globalThis, "getComputedStyle", {
        configurable: true,
        writable: true,
        value: sentinel,
      });
    }

    const mini = installMiniDom();
    expect(globalThis.window).toBe(mini);
    expect(globalThis.document).toBe(mini.document);
    expect(globalThis.HTMLElement).toBe(MiniElement);
    expect(globalThis.Element).toBe(MiniElement);
    expect(globalThis.Node).toBe(MiniNode);
    expect(globalThis.Event).toBe(MiniEvent);
    expect(typeof globalThis.HTMLIFrameElement).toBe("function");
    expect(globalThis.getComputedStyle).not.toBe(
      styleWasMissing ? sentinel : before.get("getComputedStyle")?.value,
    );

    await restoreMiniDom();

    if (styleWasMissing) {
      expect(globalThis.getComputedStyle).toBe(sentinel);
      Reflect.deleteProperty(globalThis, "getComputedStyle");
    }

    for (const name of GLOBAL_NAMES) {
      expect(Object.getOwnPropertyDescriptor(globalThis, name)).toEqual(before.get(name));
    }

    await restoreMiniDom();
    for (const name of GLOBAL_NAMES) {
      expect(Object.getOwnPropertyDescriptor(globalThis, name)).toEqual(before.get(name));
    }
  });

  it("unmounts a tracked root once and removes its container", async () => {
    const mini = installMiniDom();
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const container = mini.document.createElement("div");
    mini.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    trackMountedRoot(root, container);
    let cleanups = 0;
    function Probe() {
      React.useEffect(() => {
        return () => {
          cleanups += 1;
        };
      }, []);
      return React.createElement("p", null, "open");
    }
    await React.act(async () => {
      root.render(React.createElement(Probe));
    });
    expect(container.parentNode).toBe(mini.document.body);

    releaseMountedRoots();
    expect(cleanups).toBe(1);
    expect(container.parentNode).toBeNull();
    expect(mini.document.body.childNodes.includes(container)).toBe(false);

    root.unmount();
    releaseMountedRoots();
    expect(cleanups).toBe(1);
  });

  it.fails("leaves a mounted root behind when an assertion fails", async () => {
    const mini = installMiniDom();
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const container = mini.document.createElement("div");
    mini.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    trackMountedRoot(root, container);
    function Probe() {
      React.useEffect(() => {
        return () => {
          failedCleaned = true;
        };
      }, []);
      return React.createElement("p", null, "open");
    }
    await React.act(async () => {
      root.render(React.createElement(Probe));
    });
    failedContainer = container;
    expect(failedCleaned).toBe(false);
    expect(container.parentNode).toBe(mini.document.body);
    expect(true).toBe(false);
  });
});
