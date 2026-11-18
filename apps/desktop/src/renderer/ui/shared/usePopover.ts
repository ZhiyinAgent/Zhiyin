import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { placePopover, type PopoverPlacement } from "./placePopover.js";
import { useDismiss } from "./useDismiss.js";

type Options<Panel extends HTMLElement> = {
  /** Held by the caller instead, with what it opens beside it. */
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  /**
   * Placed against its anchor, from its own measured size, while it is open:
   * as the window is resized, anything scrolls or it grows. Without one, its
   * stylesheet places it.
   */
  readonly placement?: PopoverPlacement;
  /** What it is placed against, when not the button that opens it. */
  readonly anchor?: () => Element | null | undefined;
  /** Once it is drawn and placed, such as to put focus in it. */
  readonly onOpened?: (panel: NoInfer<Panel>) => void;
  /** What it shows; another is placed afresh, as if just opened. */
  readonly content?: unknown;
};

/**
 * What floats from a button: a menu, or a popover such as an explanation or a
 * slider. It opens and closes, closes on a press outside it (useDismiss), and
 * on Escape, with focus back on what opened it. Escape inside it closes it
 * alone, leaving a drawer or dialog around it open; Escape elsewhere closes it
 * too.
 *
 * The caller draws the frame (`root`, given `onKeyDown`), the button
 * (`trigger`) and, while `open`, the panel (`panel`, named by `panelId`),
 * which may be drawn elsewhere in the page.
 */
export function usePopover<Panel extends HTMLElement = HTMLDivElement>(
  options: Options<Panel> = {},
) {
  const [held, setHeld] = useState(false);
  const open = options.open ?? held;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<Panel>(null);
  /** What opened it last, when not the trigger: focus goes back there. */
  const opener = useRef<HTMLElement | null>(null);
  const panelId = useId();
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });

  const setOpen = useCallback((next: boolean) => {
    const change = latest.current.onOpenChange;
    if (change) change(next);
    else setHeld(next);
  }, []);
  const close = useCallback(() => setOpen(false), [setOpen]);

  /** Closes it and gives focus back to what opened it. */
  const dismiss = useCallback(() => {
    close();
    (opener.current ?? trigger.current)?.focus();
  }, [close]);

  useDismiss(open, [root, panel], close);

  // Placed before it is painted, then focus may go in: an item focused before
  // it is placed could scroll what is around it.
  const content = options.content;
  useLayoutEffect(() => {
    const element = panel.current;
    if (!open || !element) return;
    const place = () => {
      const { placement, anchor } = latest.current;
      const at = (anchor?.() ?? trigger.current)?.getBoundingClientRect();
      if (!placement || !at) return;
      const view = { width: window.innerWidth, height: window.innerHeight };
      // Widened first where it must be, then measured at that width.
      const { minWidth } = placePopover(
        at,
        { width: 0, height: 0 },
        view,
        placement,
      );
      if (minWidth !== undefined) element.style.minWidth = `${minWidth}px`;
      // Measured whole: the room it had last time does not limit it now.
      element.style.maxHeight = "";
      const spot = placePopover(
        at,
        element.getBoundingClientRect(),
        view,
        placement,
      );
      // The edge it is not held by is let go, never left to its stylesheet:
      // pinned there too, it would be stretched to the window's edge.
      element.style.top = spot.top === undefined ? "auto" : `${spot.top}px`;
      element.style.bottom =
        spot.bottom === undefined ? "auto" : `${spot.bottom}px`;
      element.style.position = "fixed";
      element.style.left = `${spot.left}px`;
      element.style.maxHeight = `${spot.maxHeight}px`;
      element.dataset["opens"] = spot.opens;
    };
    place();
    latest.current.onOpened?.(element);
    if (!latest.current.placement) return;
    const grown =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(place);
    grown?.observe(element);
    window.addEventListener("resize", place);
    // Capture: what scrolls under it, such as the composer, does not bubble.
    document.addEventListener("scroll", place, true);
    return () => {
      grown?.disconnect();
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [open, content]);

  // Escape pressed where its frame does not hear it, such as with focus left
  // on the page.
  useEffect(() => {
    if (!open) return;
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const focus = document.activeElement;
      const inside =
        !focus ||
        focus === document.body ||
        root.current?.contains(focus) ||
        panel.current?.contains(focus);
      if (inside) dismiss();
      else close();
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open, dismiss, close]);

  return {
    open,
    setOpen,
    /** Opens it, or closes it when open; `from` is where focus goes back to. */
    toggle: (from?: HTMLElement) => {
      opener.current = from ?? null;
      setOpen(!open);
    },
    /** Where focus goes back to when it closes, when not the trigger. */
    openedFrom: (from: HTMLElement | null) => {
      opener.current = from;
    },
    close,
    dismiss,
    root,
    trigger,
    panel,
    panelId,
    /** For its frame: Escape inside it closes it alone. */
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key !== "Escape" || !open) return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    },
  };
}
