// Foundations first: the theme, reset and shared basics load before any
// module stylesheet, so a module rule of equal weight always wins over them.
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { core } from "./core.js";
import { dressWindow, lookInAddress } from "./ui/app/index.js";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

// Before the first frame: the main process put the person's look in the
// page's address, so the window never opens in another.
dressWindow(document.documentElement, lookInAddress(location.search));

createRoot(root).render(
  <StrictMode>
    <App
      core={core}
      // Set by the main process when it reloads a window whose page crashed.
      restarted={new URLSearchParams(location.search).has("restarted")}
    />
  </StrictMode>,
);
