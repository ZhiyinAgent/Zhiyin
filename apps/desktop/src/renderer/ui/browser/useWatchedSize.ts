import { useEffect, useRef, type RefObject } from "react";
import type { BrowserView } from "@zhiyin/contract";

/** How long a size must hold before it is said, so a drag says it once. */
const settleMs = 150;

/**
 * Says the size an element is drawn at, in the screen's pixels, while it is
 * shown and the window is visible, and null once it is not: the page is
 * streamed at that size, and not at all while nobody can see it.
 */
export function useWatchedSize(
  element: RefObject<HTMLElement | null>,
  shown: boolean,
  onWatch: ((view: BrowserView | null) => void) | undefined,
): void {
  const report = useRef(onWatch);
  useEffect(() => {
    report.current = onWatch;
  });
  useEffect(() => {
    const node = element.current;
    if (!shown || !node) return;
    // Nothing is watched until a size is said.
    let said = "none";
    const say = (view: BrowserView | null) => {
      const key = view ? `${view.width}x${view.height}` : "none";
      if (key === said) return;
      said = key;
      report.current?.(view);
    };
    const measure = () => {
      if (document.visibilityState === "hidden") return say(null);
      const box = node.getBoundingClientRect();
      // Folded away to nothing, it shows nobody the page.
      if (!box.width || !box.height) return say(null);
      const density = window.devicePixelRatio || 1;
      say({
        width: Math.round(box.width * density),
        height: Math.round(box.height * density),
      });
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(measure, settleMs);
    };
    // Moved to a screen of another density, the same panel holds another
    // number of pixels. A query for the density now says when that changes.
    let density: MediaQueryList | undefined;
    const densityChanged = () => {
      watchDensity();
      measure();
    };
    const watchDensity = () => {
      density?.removeEventListener("change", densityChanged);
      density = window.matchMedia?.(
        `(resolution: ${window.devicePixelRatio || 1}dppx)`,
      );
      density?.addEventListener("change", densityChanged);
    };
    measure();
    watchDensity();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(later);
    observer?.observe(node);
    document.addEventListener("visibilitychange", measure);
    return () => {
      clearTimeout(timer);
      observer?.disconnect();
      density?.removeEventListener("change", densityChanged);
      document.removeEventListener("visibilitychange", measure);
      say(null);
    };
  }, [element, shown]);
}
