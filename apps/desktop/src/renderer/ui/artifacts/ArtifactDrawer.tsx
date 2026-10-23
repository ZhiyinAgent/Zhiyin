import { useEffect, useId, useLayoutEffect, useRef } from "react";
import type {
  ArtifactExport,
  ArtifactPreview,
  TaskArtifact,
} from "@zhiyin/contract";
import { ArtifactPanel } from "./ArtifactPanel.js";
import styles from "./artifacts.module.css";

/**
 * The files a task produced, kept to one side rather than in the thread.
 *
 * The point in the conversation where a file was written is where the
 * *action* belongs, but not the file: a deliverable is what the person came
 * for, and it should be reachable at any moment, not scrolled back to.
 *
 * It closes on Escape and returns focus, because it covers part of the
 * conversation while it is open and must not be a place to get stuck.
 */
export function ArtifactDrawer({
  conversationId,
  artifacts,
  open,
  onClose,
  onPreview,
  onExport,
  onShowBeside,
  folder,
}: {
  /** Whose files these are: another conversation's start with none open. */
  conversationId: string;
  /** That conversation's folder. */
  folder?: string | undefined;
  artifacts: readonly TaskArtifact[];
  open: boolean;
  onClose: () => void;
  onPreview: (path: string) => Promise<ArtifactPreview>;
  onExport: (path: string) => Promise<ArtifactExport>;
  onShowBeside?: (path: string) => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const titleId = useId();
  // The shell hands a new function each time it draws; focus moves only as
  // the drawer opens and closes.
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const returnTo = document.activeElement;
    panel.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      // A dialog open over the drawer answers Escape itself.
      if (
        event.key === "Escape" &&
        !document.querySelector('[role="dialog"][aria-modal]')
      )
        close.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (returnTo instanceof HTMLElement) returnTo.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <aside
      className={styles["files-drawer"]}
      aria-labelledby={titleId}
      tabIndex={-1}
      ref={panel}
    >
      <header className={styles["files-drawer__header"]}>
        <h2 id={titleId}>Files produced</h2>
        <button
          className="button button--quiet button--small"
          type="button"
          onClick={onClose}
        >
          Close
        </button>
      </header>
      <div className={styles["files-drawer__body"]}>
        {artifacts.length ? (
          <ArtifactPanel
            key={conversationId}
            artifacts={artifacts}
            onPreview={onPreview}
            onExport={onExport}
            folder={folder}
            {...(onShowBeside ? { onShowBeside } : {})}
          />
        ) : (
          <p className={styles["files-drawer__empty"]}>
            Nothing yet. Files this task creates or replaces appear here.
          </p>
        )}
      </div>
    </aside>
  );
}
