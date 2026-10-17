import { useEffect, useRef } from "react";

const covered = () => document.querySelector('[aria-modal="true"]') !== null;

/**
 * Windows draws the window controls over the page, out of reach of a dialog's
 * scrim, so the window is told when a dialog covers the page and dims them to
 * match. Every dialog is found by what it is, wherever it was opened from.
 */
export function useDimmedWindowControls(
  dim: (dimmed: boolean) => Promise<void>,
) {
  const told = useRef(dim);
  useEffect(() => {
    told.current = dim;
  });
  useEffect(() => {
    // Unknown until the first look, which is always told: the window may
    // still have them dimmed for a page loaded before this one.
    let dimmed: boolean | undefined;
    const look = () => {
      const now = covered();
      if (now === dimmed) return;
      dimmed = now;
      // Only the controls' colour depends on it.
      void told.current(now).catch(() => {});
    };
    const watcher = new MutationObserver(look);
    watcher.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-modal"],
    });
    look();
    return () => {
      watcher.disconnect();
      if (dimmed) void told.current(false).catch(() => {});
    };
  }, []);
}
