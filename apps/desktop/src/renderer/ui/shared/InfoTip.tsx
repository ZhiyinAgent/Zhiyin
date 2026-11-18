import type { ReactNode } from "react";
import { Icon } from "./Icon.js";
import styles from "./shared.module.css";
import { usePopover } from "./usePopover.js";

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
  // Below the button, else above it; opening Details makes it taller, and
  // it is placed again to stay inside the window.
  const {
    open,
    panelId: id,
    root,
    onKeyDown,
    trigger,
    toggle,
    panel,
  } = usePopover({
    placement: { side: "below", gap: 6, edge: 8, inset: -12, byTop: true },
  });

  return (
    <div
      className={styles["info-tip"]}
      ref={root}
      // Only the explanation closes, not a dialog it sits in.
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        ref={trigger}
        className={styles["info-tip__button"]}
        aria-label={`About ${topic}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => toggle()}
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
