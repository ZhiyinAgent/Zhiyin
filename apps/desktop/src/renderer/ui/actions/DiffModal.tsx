import { useEffect, useId, useRef, useState } from "react";
import type { FileChange } from "@zhiyin/contract";
import { ChangeReview } from "./ChangeReview.js";
import { Icon } from "../shared/index.js";
import styles from "./actions.module.css";

/**
 * What a change would actually do, shown as a difference rather than as the
 * call that would produce it.
 *
 * It is a modal because reviewing a change is the whole task while it is
 * happening: the reader should be able to scroll a long diff without losing
 * the request underneath, and should leave the same way they arrived. Focus is
 * moved in and returned on close, and Escape closes it, because the person
 * doing this may be doing it with a keyboard and cannot be stranded here.
 *
 * A change the tool could not carry says so in place of a diff. Showing
 * nothing at all would let an approval look reviewed when it was not.
 */
export function DiffModal({
  changes,
  initialPath,
  onClose,
}: {
  changes: readonly FileChange[];
  /** The file to open on; the first one otherwise. */
  initialPath?: string;
  onClose: () => void;
}) {
  const [openPath, setOpenPath] = useState(initialPath ?? changes[0]?.path);
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const current = changes.find((change) => change.path === openPath);

  useEffect(() => {
    const returnTo = document.activeElement;
    dialog.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (returnTo instanceof HTMLElement) returnTo.focus();
    };
  }, [onClose]);

  return (
    <div
      className={styles["diff-modal__scrim"]}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles["diff-modal"]}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialog}
      >
        <header className={styles["diff-modal__header"]}>
          <h2 id={titleId}>
            {changes.length === 1
              ? "Review this change"
              : `Review ${changes.length} changes`}
          </h2>
          <button
            className="button button--quiet"
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        {changes.length > 1 && (
          <div
            className={styles["diff-modal__files"]}
            role="tablist"
            aria-label="Changed files"
          >
            {changes.map((change) => (
              <button
                key={change.path}
                type="button"
                role="tab"
                aria-selected={change.path === openPath}
                onClick={() => setOpenPath(change.path)}
              >
                <Icon name="file" />
                <span>{change.path}</span>
              </button>
            ))}
          </div>
        )}

        <div className={styles["diff-modal__body"]}>
          {current && (
            <ChangeReview
              change={current}
              omittedNote="Approving it means approving a change you have not seen in full."
            />
          )}
        </div>
      </div>
    </div>
  );
}
