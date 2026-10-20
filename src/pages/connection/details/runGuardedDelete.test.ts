import { describe, expect, it } from "vitest";
import { runGuardedDelete } from "./runGuardedDelete";

async function expectOneRunningDelete(): Promise<void> {
  const lock = { current: false };
  let calls = 0;
  let release: () => void = () => {};
  const first = runGuardedDelete(
    lock,
    () =>
      new Promise<void>((resolve) => {
        calls += 1;
        release = resolve;
      }),
  );
  const second = runGuardedDelete(lock, async () => {
    calls += 1;
  });

  expect(calls).toBe(1);
  release();
  await first;
  await second;
  expect(calls).toBe(1);
  expect(lock.current).toBe(true);
}

describe("connection delete guard", () => {
  it("confirmation disabled: a second trash click deletes once", async () => {
    await expectOneRunningDelete();
  });

  it("confirmation enabled: a second Delete click deletes once", async () => {
    await expectOneRunningDelete();
  });

  it("allows another attempt after a failed deletion and stays locked after success", async () => {
    const lock = { current: false };
    let calls = 0;

    await expect(
      runGuardedDelete(lock, async () => {
        calls += 1;
        throw new Error("disk full");
      }),
    ).rejects.toThrow("disk full");
    expect(lock.current).toBe(false);

    await runGuardedDelete(lock, async () => {
      calls += 1;
    });
    expect(calls).toBe(2);
    expect(lock.current).toBe(true);

    await runGuardedDelete(lock, async () => {
      calls += 1;
    });
    expect(calls).toBe(2);
  });
});
