import { useEffect, useId, useRef } from "react";
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
 * They were in the thread, at the point in the conversation where they
 * happened to be written. That is where the *action* belongs, but not the
 * file: a deliverable is what the person came for, and it should be reachable
 * at any moment, not scrolled back to. A panel that stays put also leaves room
 * for the version history these files are going to grow.
 *
 * It closes on Escape and returns focus, because it covers part of the
 * conversation while it is open and must not be a place to get stuck.
 */
export function ArtifactDrawer({
  artifacts,
  open,
  onClose,
  onPreview,
  onExport,
}: {
  artifacts: readonly TaskArtifact[];
  open: boolean;
  onClose: () => void;
  onPreview: (path: string) => Promise<ArtifactPreview>;
  onExport: (path: string) => Promise<ArtifactExport>;
}) {
  const panel = useRef<HTMLElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const returnTo = document.activeElement;
    panel.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (returnTo instanceof HTMLElement) returnTo.focus();
    };
  }, [open, onClose]);

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
            artifacts={artifacts}
            onPreview={onPreview}
            onExport={onExport}
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
