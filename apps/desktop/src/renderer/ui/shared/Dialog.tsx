import { useId, useRef, type ReactNode } from "react";
import styles from "./shared.module.css";
import { InsideLayer, useDismiss } from "./useDismiss.js";
import { useModalFocus } from "./useModalFocus.js";
import { WindowLayer } from "./WindowLayer.js";

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
  const layer = useDismiss(true, [dialog], onClose, { closeOnBlur: false });

  useModalFocus(dialog, onClose);

  return (
    <WindowLayer>
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
          <div className={styles["dialog-shell__body"]}>
            <InsideLayer value={layer}>{children}</InsideLayer>
          </div>
          {footer && (
            <footer className={styles["dialog-shell__footer"]}>{footer}</footer>
          )}
        </div>
      </div>
    </WindowLayer>
  );
}
