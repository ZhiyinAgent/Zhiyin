import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./shared.module.css";

/**
 * A sentence shown above the point it explains, with an arrow down to it,
 * while a small "i" button is pointed at or focused. Drawn over the whole
 * window, so nothing beside the button clips it.
 */
export function PointedTip({
  id,
  at,
  children,
}: {
  id: string;
  /** The middle of the button's top edge. */
  at: { readonly x: number; readonly y: number };
  children: ReactNode;
}) {
  return createPortal(
    <span
      id={id}
      role="tooltip"
      className={styles["pointed-tip"]}
      style={{ left: at.x, top: at.y }}
    >
      {children}
    </span>,
    document.body,
  );
}
