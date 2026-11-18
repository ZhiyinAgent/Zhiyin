import { Icon } from "../shared/index.js";
import type { ReactNode } from "react";
import styles from "./session-header.module.css";

type SessionHeaderProps = {
  /** The conversation's project, as a menu, where memory is kept. */
  project?: ReactNode;
  workspace: string;
  title: string;
  viewSelector?: ReactNode;
  /** The conversation's running commands, when any run. */
  running?: ReactNode;
  /** Absent when the task has produced nothing there is anything to show. */
  files?: { count: number; open: boolean; onToggle: () => void } | undefined;
  /** It reaches the window's right-hand edge, under the window controls. */
  windowEdge?: boolean;
};

export function SessionHeader({
  project,
  workspace,
  title,
  files,
  viewSelector,
  running,
  windowEdge = false,
}: SessionHeaderProps) {
  return (
    <header
      className={`${styles["session-header"]}${windowEdge ? ` ${styles["session-header--window-edge"]}` : ""}`}
      aria-label="Task header"
    >
      <div className={styles["session-header__title"]}>
        {project}
        {workspace && <span>{workspace}</span>}
        <strong>{title}</strong>
      </div>
      <div className={styles["session-header__actions"]}>
        {running}
        {viewSelector}
        {files && (
          <button
            className={styles["session-header__files"]}
            type="button"
            aria-expanded={files.open}
            onClick={files.onToggle}
          >
            <Icon name="file" />
            <span>Files</span>
            <span className={styles["session-header__count"]}>
              {files.count}
            </span>
          </button>
        )}
      </div>
    </header>
  );
}
