import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./shared.module.css";
import { useDismiss } from "./useDismiss.js";

export function Dialog({
  title,
  children,
  footer,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  useDismiss(true, [dialog], onClose, { closeOnBlur: false });

  useEffect(() => {
    const returnTo =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    dialog.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = [
        ...dialog.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnTo?.focus();
    };
  }, [onClose]);

  return (
    <div className={styles["dialog-shell__scrim"]}>
      <div
        ref={dialog}
        className={`${styles["dialog-shell"]} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className={styles["dialog-shell__header"]}>
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="text-button" onClick={onClose}>
            Close
          </button>
        </header>
        <div className={styles["dialog-shell__body"]}>{children}</div>
        {footer && (
          <footer className={styles["dialog-shell__footer"]}>{footer}</footer>
        )}
      </div>
    </div>
  );
}
