import { useLayoutEffect, type ReactNode } from "react";
import { startGeneralSettingsLoadOnce } from "@services/generalSettings";

export function GeneralSettingsBootstrap({ children }: { children: ReactNode }) {
  // Layout runs before passive effects, so a fast read can apply saved
  // choices before later startup status messages are created.
  useLayoutEffect(() => {
    void startGeneralSettingsLoadOnce();
  }, []);

  return children;
}
