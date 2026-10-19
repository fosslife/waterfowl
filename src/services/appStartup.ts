import { getCurrentWindow } from "@tauri-apps/api/window";
import { whenZoomSettled } from "./appearance";
import { startSettingsLoad } from "./settings";

/**
 * How long to wait for SQLite before showing the window at the cached zoom.
 * Rust also shows the window after 2 seconds if this function never finishes,
 * so a crashed page cannot leave the window hidden.
 *
 * The zoom IPC is applied while the window is still hidden. It needs macOS 11+
 * or iOS 14+, and Android does not support it. A zoom call that never returns
 * is covered by the Rust fallback, which can show one frame at the WebView's
 * default zoom.
 */
export const STARTUP_LOAD_WAIT_MS = 800;

export async function revealAppWindow(): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const waitForLoad = new Promise<void>((resolve) => {
    timeoutId = setTimeout(resolve, STARTUP_LOAD_WAIT_MS);
  });

  try {
    await Promise.race([
      startSettingsLoad().then(
        () => undefined,
        () => undefined,
      ),
      waitForLoad,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }

  await whenZoomSettled();

  try {
    await getCurrentWindow().show();
  } catch (error: unknown) {
    console.error("Failed to show the window", error);
  }
}
