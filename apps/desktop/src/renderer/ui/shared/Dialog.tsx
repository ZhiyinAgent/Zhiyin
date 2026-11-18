import { useId, useRef, type ReactNode } from "react";
import styles from "./shared.module.css";
import { InsideLayer, useDismiss } from "./useDismiss.js";
import { useModalFocus } from "./useModalFocus.js";
import { WindowLayer } from "./WindowLayer.js";

/**
 * How a dialog is drawn, part by part, for one that is not drawn as the app's
 * usual dialog: a record to read, such as a change or what an action did, is
 * wider and sets its own header.
 */
export type DialogLook = {
  readonly scrim: string;
  readonly dialog: string;
  readonly header: string;
  readonly body: string;
  readonly close: string;
};

const usual: DialogLook = {
  scrim: styles["dialog-shell__scrim"] ?? "",
  dialog: styles["dialog-shell"] ?? "",
  header: styles["dialog-shell__header"] ?? "",
  body: styles["dialog-shell__body"] ?? "",
  close: "text-button",
};

/**
 * The app's modal dialog: drawn over the whole window, named by its title,
 * with Close in its header. Focus moves in and returns on close, Tab stays
 * inside, Escape and a press outside close it, and a dialog opened from inside
 * it closes first.
 */
export function Dialog({
  title,
  heading,
  tabs,
  children,
  footer,
  onClose,
  look = usual,
  className = "",
  scrimClassName = "",
}: {
  title: string;
  /** What the header holds before Close, the title among it; the title alone otherwise. */
  heading?: ((title: ReactNode) => ReactNode) | undefined;
  /** Tabs between the header and the body, which is the panel they control. */
  tabs?: ((panelId: string) => ReactNode) | undefined;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  look?: DialogLook | undefined;
  className?: string;
  /** For the ground drawn under it, as for a dialog drawn on a higher layer. */
  scrimClassName?: string;
}) {
  const titleId = useId();
  const panelId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const layer = useDismiss(true, [dialog], onClose, { closeOnBlur: false });

  useModalFocus(dialog, onClose);

  const named = <h2 id={titleId}>{title}</h2>;
  return (
    <WindowLayer>
      <div className={`${look.scrim} ${scrimClassName}`.trim()}>
        <div
          ref={dialog}
          className={`${look.dialog} ${className}`.trim()}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
        >
          <header className={look.header}>
            {heading ? heading(named) : named}
            <button type="button" className={look.close} onClick={onClose}>
              Close
            </button>
          </header>
          <InsideLayer value={layer}>
            {tabs?.(panelId)}
            <div
              className={look.body}
              id={tabs ? panelId : undefined}
              role={tabs ? "tabpanel" : undefined}
            >
              {children}
            </div>
          </InsideLayer>
          {footer && (
            <footer className={styles["dialog-shell__footer"]}>{footer}</footer>
          )}
        </div>
      </div>
    </WindowLayer>
  );
}
