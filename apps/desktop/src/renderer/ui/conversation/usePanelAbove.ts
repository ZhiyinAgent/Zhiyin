import { useLayoutEffect, useRef, type RefObject } from "react";

/** Space kept between the panel and the window's edges. */
const margin = 12;

/**
 * The ref for a panel that opens above the button that opened it: while open,
 * it is kept there, its left edge on the button's and inside the window, as
 * the window is resized or anything scrolls.
 */
export function usePanelAbove<Panel extends HTMLElement>(
  open: boolean,
  trigger: RefObject<HTMLElement | null>,
): RefObject<Panel | null> {
  const panel = useRef<Panel>(null);
  useLayoutEffect(() => {
    if (!open) return;
    function position() {
      if (!trigger.current || !panel.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const width = panel.current.getBoundingClientRect().width;
      panel.current.style.left = `${Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin))}px`;
      panel.current.style.bottom = `${window.innerHeight - anchor.top + 10}px`;
    }
    position();
    window.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", position, true);
    };
  }, [open, trigger]);
  return panel;
}
