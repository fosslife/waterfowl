import { useEffect, type ReactNode } from "react";
import { startSettingsLoad } from "@services/settings";

/**
 * Starts the one shared settings read. Calling it again does not open a second read.
 * Unmount does not cancel that read: the values belong to the whole app, and a late
 * result cannot overwrite keys the user has already changed.
 */
export function AppearanceBootstrap({ children }: { children: ReactNode }) {
  useEffect(() => {
    void startSettingsLoad();
  }, []);

  return children;
}
