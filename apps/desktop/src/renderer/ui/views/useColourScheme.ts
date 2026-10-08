import { useSyncExternalStore } from "react";
import type { ColourScheme } from "./mermaidRuntime.js";

const lightQuery = "(prefers-color-scheme: light)";

function subscribe(changed: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(lightQuery);
  query.addEventListener("change", changed);
  return () => query.removeEventListener("change", changed);
}

function current(): ColourScheme {
  return typeof window.matchMedia === "function" &&
    window.matchMedia(lightQuery).matches
    ? "light"
    : "dark";
}

/**
 * The theme the window is showing, for what has to be drawn in colours rather
 * than styled with them. It follows the stylesheet's own light rule, so the two
 * cannot disagree.
 */
export function useColourScheme(): ColourScheme {
  return useSyncExternalStore(subscribe, current, () => "dark");
}
