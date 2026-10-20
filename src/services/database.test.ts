import { beforeEach, describe, expect, it, vi } from "vitest";

const { load } = vi.hoisted(() => ({
  load: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load },
}));

type FakeDatabase = {
  execute: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
};

function fakeDatabase(): FakeDatabase {
  return {
    execute: vi.fn(async () => ({ rowsAffected: 0 })),
    select: vi.fn(async () => []),
  };
}

describe("getDatabase", () => {
  beforeEach(() => {
    vi.resetModules();
    load.mockReset();
  });

  it("shares one open while that open is still running", async () => {
    load.mockImplementation(() => new Promise<FakeDatabase>(() => undefined));
    const { getDatabase } = await import("./database");

    const first = getDatabase();
    const second = getDatabase();

    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith("sqlite:waterfowl.db");
    expect(first).toBe(second);
  });

  it("opens once when two callers wait for the same success", async () => {
    let finishOpen: (database: FakeDatabase) => void = () => undefined;
    load.mockImplementation(
      () =>
        new Promise<FakeDatabase>((resolve) => {
          finishOpen = resolve;
        }),
    );
    const { getDatabase } = await import("./database");
    const database = fakeDatabase();

    const first = getDatabase();
    const second = getDatabase();
    finishOpen(database);

    await expect(first).resolves.toBe(database);
    await expect(second).resolves.toBe(database);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("starts a new open after the previous open fails", async () => {
    const database = fakeDatabase();
    load.mockRejectedValueOnce(new Error("database locked"));
    load.mockResolvedValueOnce(database);
    const { getDatabase } = await import("./database");

    await expect(getDatabase()).rejects.toThrow("database locked");
    await expect(getDatabase()).resolves.toBe(database);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("starts a new open after migrations fail", async () => {
    const broken = fakeDatabase();
    broken.execute.mockRejectedValueOnce(new Error("disk full"));
    const healthy = fakeDatabase();
    load.mockResolvedValueOnce(broken);
    load.mockResolvedValueOnce(healthy);
    const { getDatabase } = await import("./database");

    await expect(getDatabase()).rejects.toThrow("disk full");
    await expect(getDatabase()).resolves.toBe(healthy);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
