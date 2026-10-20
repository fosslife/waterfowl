import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installMiniDom,
  reactHandler,
  releaseMountedRoots,
  restoreMiniDom,
  textOf,
  trackMountedRoot,
  walkElements,
} from "../../../test/miniDom";
import type { MiniElement, MiniNode, MiniWindow } from "../../../test/miniDom";

let miniWindow: MiniWindow = installMiniDom();

const { defaultInvoke, deleteConnection, invoke, navigate, refreshConnections, toasts } =
  vi.hoisted(() => {
    const defaultInvoke = async (command: string) => {
      if (command === "get_schemas") return ["public"];
      if (command === "get_schema_objects") {
        return { tables: [], views: [], functions: [], sequences: [] };
      }
      if (command === "get_database_info") {
        return {
          version: "16",
          database_name: "app",
          database_size: "1 MB",
          total_tables: 0,
          total_views: 0,
          total_functions: 0,
          total_sequences: 0,
        };
      }
      return undefined;
    };
    return {
      deleteConnection: vi.fn(async () => undefined),
      invoke: vi.fn(defaultInvoke),
      defaultInvoke,
      navigate: vi.fn(),
      refreshConnections: vi.fn(async () => undefined),
      toasts: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
        toast: vi.fn(),
      },
    };
  });

vi.mock("react-router-dom", () => ({
  useParams: () => ({ id: "conn-1" }),
  useNavigate: () => navigate,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
}));

vi.mock("@context/ToastContext", () => ({
  useToast: () => toasts,
}));

vi.mock("@context/ConnectionsContext", () => ({
  useConnections: () => ({
    connections: [
      {
        id: "conn-1",
        name: "Demo",
        host: "localhost",
        port: "5432",
        database: "app",
      },
    ],
    refreshConnections,
  }),
}));

vi.mock("@services/connections", () => ({
  deleteConnection,
  getConnection: async () => ({
    id: "conn-1",
    name: "Demo",
    host: "localhost",
    port: "5432",
    username: "sam",
    password: "secret",
    database_name: "app",
    driver: "postgres",
    default_schema: "public",
  }),
  recordConnectionUsage: async () => undefined,
}));

vi.mock("@components/SqlEditorTab", () => ({ SqlEditorTab: () => null }));
vi.mock("./TablePanel", () => ({ TablePanel: () => null }));
vi.mock("./ViewPanel", () => ({ ViewPanel: () => null }));
vi.mock("./FunctionPanel", () => ({ FunctionPanel: () => null }));
vi.mock("./SequencePanel", () => ({ SequencePanel: () => null }));

describe("connection screen delete", () => {
  beforeAll(() => {
    miniWindow = installMiniDom();
  });

  beforeEach(() => {
    vi.resetModules();
    deleteConnection.mockReset();
    deleteConnection.mockResolvedValue(undefined);
    invoke.mockReset();
    invoke.mockImplementation(defaultInvoke);
    navigate.mockClear();
    refreshConnections.mockClear();
    toasts.success.mockClear();
    toasts.error.mockClear();
  });

  afterEach(() => {
    releaseMountedRoots();
  });

  afterAll(async () => {
    await restoreMiniDom();
  });

  async function mount(confirmDestructiveActions: boolean) {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const settings = await import("../../../services/generalSettings");
    settings.applyLoadedGeneralSettings({
      confirmDestructiveActions,
      showStatusNotifications: true,
    });
    const page = await import("./ConnectionDetails");
    const container = miniWindow.document.createElement("div");
    miniWindow.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    trackMountedRoot(root, container);
    await React.act(async () => {
      root.render(React.createElement(page.ConnectionDetails));
    });
    await vi.waitFor(() => {
      if (!buttonByTitle(container, "Delete Connection")) {
        throw new Error("delete button is not on screen");
      }
    });
    return { React, root, container };
  }

  function buttonByTitle(
    container: MiniElement,
    title: string,
  ): MiniElement | undefined {
    let found: MiniElement | undefined;
    walkElements(container as unknown as MiniNode, (element) => {
      if (element.tagName === "BUTTON" && element.title === title) found = element;
    });
    return found;
  }

  function buttonByText(container: MiniElement, label: string): MiniElement {
    let found: MiniElement | undefined;
    walkElements(container as unknown as MiniNode, (element) => {
      if (element.tagName === "BUTTON" && textOf(element).trim() === label) {
        found = element;
      }
    });
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  }

  function press(button: MiniElement): void {
    const onClick = reactHandler(button, "onClick");
    if (!onClick) throw new Error("Button has no click handler");
    onClick({ target: button });
  }

  it("runs one deletion when the trash button is activated twice and confirmation is off", async () => {
    let releaseDelete: () => void = () => {};
    deleteConnection.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          releaseDelete = () => resolve(undefined);
        }),
    );
    const screen = await mount(false);
    const trash = buttonByTitle(screen.container, "Delete Connection");
    if (!trash) throw new Error("Missing delete button");

    await screen.React.act(async () => {
      press(trash);
      press(trash);
    });
    await vi.waitFor(() => {
      expect(deleteConnection).toHaveBeenCalledTimes(1);
    });
    expect(deleteConnection).toHaveBeenCalledWith("conn-1");

    releaseDelete();
    await vi.waitFor(() => {
      expect(toasts.success).toHaveBeenCalledWith("Connection deleted");
    });
    expect(toasts.error).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("runs one deletion when Delete is activated twice and confirmation is on", async () => {
    let releaseDelete: () => void = () => {};
    deleteConnection.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          releaseDelete = () => resolve(undefined);
        }),
    );
    const screen = await mount(true);
    const trash = buttonByTitle(screen.container, "Delete Connection");
    if (!trash) throw new Error("Missing delete button");

    await screen.React.act(async () => {
      press(trash);
    });
    const confirm = buttonByText(screen.container, "Delete");
    await screen.React.act(async () => {
      press(confirm);
      press(confirm);
    });

    await vi.waitFor(() => {
      expect(deleteConnection).toHaveBeenCalledTimes(1);
    });
    releaseDelete();
    await vi.waitFor(() => {
      expect(toasts.success).toHaveBeenCalledTimes(1);
    });
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("lets a failed deletion be retried and does not report success as an error", async () => {
    deleteConnection
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(undefined);
    const screen = await mount(false);
    const trash = () => {
      const button = buttonByTitle(screen.container, "Delete Connection");
      if (!button) throw new Error("Missing delete button");
      return button;
    };

    await screen.React.act(async () => {
      press(trash());
    });
    await vi.waitFor(() => {
      expect(toasts.error).toHaveBeenCalledTimes(1);
    });
    expect(toasts.success).not.toHaveBeenCalled();

    await screen.React.act(async () => {
      press(trash());
    });
    await vi.waitFor(() => {
      expect(deleteConnection).toHaveBeenCalledTimes(2);
      expect(toasts.success).toHaveBeenCalledWith("Connection deleted");
    });
    expect(toasts.error).toHaveBeenCalledTimes(1);
  });

  it("names the delete button on the connection failure screen", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "establish_connection") throw new Error("offline");
      return defaultInvoke(command);
    });
    const screen = await mount(true);

    await vi.waitFor(() => {
      if (!textOf(screen.container).includes("Connection Failed")) {
        throw new Error("connection failure screen is not visible");
      }
    });

    const trash = buttonByTitle(screen.container, "Delete Connection");
    if (!trash) throw new Error("Missing delete button");
    expect(trash.title).toBe("Delete Connection");
    expect(trash.getAttribute("aria-label")).toBe("Delete Connection");
    expect(deleteConnection).not.toHaveBeenCalled();
  });
});
