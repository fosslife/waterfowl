/**
 * Run an action once. A second call while it is running does nothing.
 * A failure unlocks another attempt. Success stays locked.
 */
export async function runGuardedDelete(
  lock: { current: boolean },
  action: () => Promise<void>,
): Promise<void> {
  if (lock.current) return;
  lock.current = true;
  try {
    await action();
  } catch (error) {
    lock.current = false;
    throw error;
  }
}
