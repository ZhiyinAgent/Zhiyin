// Foundations first: the theme, reset and shared basics load before any
// module stylesheet, so a module rule of equal weight always wins over them.
import "../ui/foundations.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DemoApp } from "./DemoApp.js";
import { demoScenarioFromSearch } from "./fixtures.js";
// The page around the components loads last, so its frames outweigh a
// component’s own defaults.
import "./demo.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

createRoot(root).render(
  <StrictMode>
    <DemoApp initialScenario={demoScenarioFromSearch(window.location.search)} />
  </StrictMode>,
);
