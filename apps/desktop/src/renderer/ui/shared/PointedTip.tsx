import { useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon.js";
import styles from "./shared.module.css";

/**
 * A small "i" button whose sentence shows above it, with an arrow down to it,
 * while the button is pointed at or focused. The sentence is drawn over the
 * whole window, so nothing beside the button clips it. The button's size and
 * place in its line are the caller's, through `className`.
 */
export function PointedTip({
  label,
  className,
  children,
}: {
  /** The button's name, as in "Why it waits". */
  label: string;
  className?: string | undefined;
  /** What the button explains. */
  children: ReactNode;
}) {
  const id = useId();
  const [at, setAt] = useState<{ x: number; y: number }>();
  const show = (target: HTMLElement) => {
    const box = target.getBoundingClientRect();
    setAt({ x: box.left + box.width / 2, y: box.top });
  };
  const hide = () => setAt(undefined);
  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={label}
        data-own-tip
        aria-describedby={at ? id : undefined}
        onMouseEnter={(event) => show(event.currentTarget)}
        onMouseLeave={hide}
        onFocus={(event) => show(event.currentTarget)}
        onBlur={hide}
      >
        <Icon name="info" />
      </button>
      {at &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className={styles["pointed-tip"]}
            style={{ left: at.x, top: at.y }}
          >
            {children}
          </span>,
          document.body,
        )}
    </>
  );
}
