import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "./Icon.js";
import styles from "./shared.module.css";
import { useDismiss } from "./useDismiss.js";

/** Space kept between the explanation and the window's edge. */
const margin = 8;

/**
 * A short answer to "what is this, and do I need it?", beside the choice it
 * explains. It opens on a press — mouse, touch, Enter or Space — and never on
 * focus alone, because it can hold a link, and what appeared as focus passed
 * would be gone before the link could be reached. It follows its button in
 * the page, so Tab goes from the button into it.
 */
export function InfoTip({
  topic,
  children,
  setup,
  details,
}: {
  /** What is explained, as in "About connectors". */
  topic: string;
  /** At most two sentences. */
  children: ReactNode;
  /** The one page that says how to get what this needs. */
  setup?: { readonly label?: string; readonly open: () => void };
  /** What it can reach and how to take that back, for whoever looks. */
  details?: ReactNode;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useDismiss(open, [root], () => setOpen(false));

  useLayoutEffect(() => {
    if (!open) return;
    function position() {
      if (!trigger.current || !panel.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const { width, height } = panel.current.getBoundingClientRect();
      const below = anchor.bottom + 6;
      const above = anchor.top - 6 - height;
      const bottom = window.innerHeight - margin;
      // Below the button, else above it, else as low as it still fits.
      const top = Math.max(
        margin,
        below + height <= bottom
          ? below
          : above >= margin
            ? above
            : bottom - height,
      );
      const left = Math.max(
        margin,
        Math.min(anchor.left - 12, window.innerWidth - width - margin),
      );
      panel.current.style.top = `${top}px`;
      panel.current.style.left = `${left}px`;
    }
    position();
    // Opening Details makes it taller, and it is placed again to stay inside.
    const grown =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(position);
    if (panel.current) grown?.observe(panel.current);
    window.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    return () => {
      grown?.disconnect();
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", position, true);
    };
  }, [open]);

  return (
    <div
      className={styles["info-tip"]}
      ref={root}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        // Only the explanation closes, not a dialog it sits in.
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }}
    >
      <button
        type="button"
        ref={trigger}
        className={styles["info-tip__button"]}
        aria-label={`About ${topic}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        <Icon name="info" />
      </button>
      {open && (
        <div ref={panel} id={id} className={styles["info-tip__panel"]}>
          <p>{children}</p>
          {setup && (
            <button
              type="button"
              className={styles["info-tip__link"]}
              onClick={setup.open}
            >
              {setup.label ?? "How to set up"}
            </button>
          )}
          {details && (
            <details>
              <summary>Details</summary>
              <p>{details}</p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
