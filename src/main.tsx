import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { revealAppWindow } from "@services/appStartup";
import { bindAppearanceEffects } from "@services/appearance";
import { hydrateFromStoredCache } from "@services/settings";
import "./styles/global.css";

bindAppearanceEffects();
hydrateFromStoredCache();
void revealAppWindow();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
