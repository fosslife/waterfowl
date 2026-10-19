/**
 * Appearance side effects only: the font list, and writing font, size, and zoom onto the page.
 * Stored values live in the shared settings store.
 */

import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  ZOOM_MAX,
  ZOOM_MIN,
  type FontFamilyId,
  type Settings,
} from "./settings.schema";
import {
  getAppliedSettings,
  subscribeSettings,
} from "./settings";

export {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  ZOOM_MAX,
  ZOOM_MIN,
  type FontFamilyId,
} from "./settings.schema";

export const FONT_OPTIONS = [
  {
    id: "inter",
    label: "Inter",
    stack: '"Inter", system-ui, -apple-system, sans-serif',
  },
  {
    id: "jetbrains",
    label: "JetBrains Mono (monospace)",
    stack: '"JetBrains Mono", "Fira Code", monospace',
  },
] as const;

export type AppearanceSettings = Pick<
  Settings,
  "fontFamily" | "fontSizePx" | "zoomPercent"
>;

export const FONT_SIZE_PX_OPTIONS = Array.from(
  { length: FONT_SIZE_MAX - FONT_SIZE_MIN + 1 },
  (_, index) => FONT_SIZE_MIN + index,
);

export const ZOOM_PERCENT_OPTIONS = Array.from(
  { length: (ZOOM_MAX - ZOOM_MIN) / 10 + 1 },
  (_, index) => ZOOM_MIN + index * 10,
);

export function fontStackFor(id: FontFamilyId): string {
  const option = FONT_OPTIONS.find((item) => item.id === id);
  return option?.stack ?? FONT_OPTIONS[0].stack;
}

let stopEffects: (() => void) | null = null;
let previous: AppearanceSettings | null = null;
let zoomChain: Promise<void> = Promise.resolve();
let desiredZoom: number | null = null;
let zoomRunning = false;
/** Zoom factor the worker last handed to setZoom. Used to notice a request that arrived as the worker stopped. */
let attemptedZoom: number | null = null;

/**
 * Resolves when the newest requested zoom has finished or failed.
 * A follow-up call scheduled while one call is in flight keeps this promise pending.
 */
export function whenZoomSettled(): Promise<void> {
  const pending = zoomChain;
  return pending.then(() => {
    if (pending !== zoomChain || zoomRunning) {
      return whenZoomSettled();
    }
  });
}

/**
 * Rapid zoom changes share one in-flight call.
 * The call sends whatever zoom is current when it starts, then sends the latest again if it moved.
 */
export function requestZoom(zoomPercent: number): void {
  desiredZoom = zoomPercent;
  if (zoomRunning) return;
  startZoomWorker();
}

function startZoomWorker(): void {
  if (zoomRunning || desiredZoom === null) return;
  zoomRunning = true;
  zoomChain = zoomChain.then(async () => {
    try {
      while (desiredZoom !== null) {
        const latest = desiredZoom;
        attemptedZoom = latest;
        try {
          await getCurrentWebview().setZoom(latest / 100);
        } catch (error: unknown) {
          console.error("Failed to set window zoom", error);
        }
        if (desiredZoom !== latest) continue;
        break;
      }
    } finally {
      zoomRunning = false;
      // A newer request can land after the loop decides to stop and before this flag clears.
      if (desiredZoom !== null && desiredZoom !== attemptedZoom) {
        startZoomWorker();
      }
    }
  });
}

function appearanceOf(settings: Settings): AppearanceSettings {
  return {
    fontFamily: settings.fontFamily,
    fontSizePx: settings.fontSizePx,
    zoomPercent: settings.zoomPercent,
  };
}

/**
 * Font size sets the root size, which is 1rem.
 * `--text-*` and `--space-*` are rem, so they grow with the text instead of staying pinned.
 * `--font-sans` is already the family on `:root` in global.css. `--font-mono` is left alone.
 */
export function applyAppearanceEffects(
  before: AppearanceSettings | null,
  next: AppearanceSettings,
): void {
  const fontChanged = before === null || before.fontFamily !== next.fontFamily;
  const sizeChanged = before === null || before.fontSizePx !== next.fontSizePx;
  const zoomChanged = before === null || before.zoomPercent !== next.zoomPercent;

  if (typeof document !== "undefined") {
    const root = document.documentElement;
    if (fontChanged) {
      root.style.setProperty("--font-sans", fontStackFor(next.fontFamily));
    }
    if (sizeChanged) {
      root.style.fontSize = `${next.fontSizePx}px`;
    }
  }

  if (zoomChanged) requestZoom(next.zoomPercent);
}

/** Follow the shared store. A font edit does not send a zoom IPC when zoom did not change. */
export function bindAppearanceEffects(): void {
  if (stopEffects) return;
  stopEffects = subscribeSettings(() => {
    const next = appearanceOf(getAppliedSettings());
    applyAppearanceEffects(previous, next);
    previous = next;
  });
}

export function resetAppearanceForTests(): void {
  stopEffects?.();
  stopEffects = null;
  previous = null;
  zoomChain = Promise.resolve();
  desiredZoom = null;
  zoomRunning = false;
  attemptedZoom = null;
}
