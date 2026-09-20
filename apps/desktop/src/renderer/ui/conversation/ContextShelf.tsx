import { Icon } from "../shared/index.js";
import styles from "./conversation.module.css";

export type SessionContext =
  | {
      kind: "workspace";
      project: string;
      files: { name: string; meta: string }[];
      changes: string;
    }
  | {
      kind: "browser";
      title: string;
      url: string;
    };

export function ContextShelf({
  context,
  onTakeBrowserControl,
  onReviewChanges,
}: {
  context: SessionContext;
  onTakeBrowserControl?: () => void;
  onReviewChanges?: () => void;
}) {
  if (context.kind === "browser") {
    return (
      <aside className={styles["context-shelf"]} aria-label="Session context">
        <header className={styles["context-shelf__header"]}>
          <div>
            <p className="eyebrow">Browser</p>
            <h2>{context.title}</h2>
          </div>
          <Icon name="globe" />
        </header>
        <div className={styles["browser-source"]}>
          <span className={styles["browser-source__icon"]}>
            <Icon name="globe" />
          </span>
          <span>
            <small>Current page</small>
            <strong>{context.title}</strong>
            <span>{context.url}</span>
          </span>
        </div>
        {onTakeBrowserControl && (
          <button
            className={`button ${styles["button--wide"]}`}
            type="button"
            onClick={onTakeBrowserControl}
          >
            Take control of browser
          </button>
        )}
      </aside>
    );
  }

  return (
    <aside className={styles["context-shelf"]} aria-label="Session context">
      <header className={styles["context-shelf__header"]}>
        <div>
          <p className="eyebrow">Workspace</p>
          <h2>{context.project}</h2>
        </div>
        <Icon name="folder" />
      </header>
      <div className={styles["context-shelf__section"]}>
        <div className={styles["section-label"]}>
          <span>Open in this session</span>
          <span>{context.files.length}</span>
        </div>
        <ul className={styles["file-list"]}>
          {context.files.map((file) => (
            <li key={file.name}>
              <span className={styles["file-list__icon"]}>
                <Icon name="file" />
              </span>
              <span>
                <strong>{file.name}</strong>
                <small>{file.meta}</small>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className={styles["change-summary"]}>
        <div>
          <span>Working changes</span>
          <strong>{context.changes}</strong>
        </div>
        {onReviewChanges && (
          <button
            className="button button--quiet button--small"
            type="button"
            onClick={onReviewChanges}
          >
            Review
          </button>
        )}
      </div>
      <div className={styles["context-shelf__note"]}>
        <Icon name="spark" />
        <p>Only files touched in this session appear here.</p>
      </div>
    </aside>
  );
}
