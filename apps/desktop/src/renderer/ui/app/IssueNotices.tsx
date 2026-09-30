import { Fragment } from "react";
import type { WorkspaceIssue } from "@zhiyin/contract";
import { Icon } from "../shared/index.js";
import styles from "./app.module.css";

/**
 * What the core has reported as wrong, each once, with only the actions that
 * can change it: deleting a damaged conversation, and trying again only when
 * the history itself could not be loaded. Where a copy was kept stands on its
 * own line, so a long path never breaks the sentence.
 */
export function IssueNotices({
  issues,
  retry,
  onDelete,
  onDismiss,
}: {
  issues: readonly WorkspaceIssue[] | undefined;
  retry?: (() => void) | undefined;
  onDelete?: ((conversationId: string) => void) | undefined;
  onDismiss?: ((message: string) => void) | undefined;
}) {
  return issues?.map((issue) => {
    const { conversationId } = issue;
    return (
      <div className={styles.issue} role="alert" key={issue.message}>
        <span className={styles.issue__icon} aria-hidden="true">
          <Icon name="alert" />
        </span>
        <div className={styles.issue__body}>
          <p className={styles.issue__message}>{issue.message}</p>
          {issue.keptAt && (
            <p className={styles.issue__kept}>
              A copy was kept in
              <span className={styles.issue__path}>
                {breakable(issue.keptAt)}
              </span>
            </p>
          )}
          {((conversationId && onDelete) || retry) && (
            <div className={styles.issue__actions}>
              {conversationId && onDelete && (
                <button
                  className="button"
                  type="button"
                  onClick={() => onDelete(conversationId)}
                >
                  Delete conversation
                </button>
              )}
              {retry && (
                <button className="button" type="button" onClick={retry}>
                  Try again
                </button>
              )}
            </div>
          )}
        </div>
        {onDismiss && (
          <button
            className={styles.issue__dismiss}
            type="button"
            aria-label="Dismiss"
            onClick={() => onDismiss(issue.message)}
          >
            <Icon name="x" />
          </button>
        )}
      </div>
    );
  });
}

/** A path that wraps only after a folder separator, never inside a name. */
function breakable(path: string) {
  return path.split(/(?<=[\\/])/).map((part, index) => (
    <Fragment key={index}>
      {index > 0 && <wbr />}
      <span>{part}</span>
    </Fragment>
  ));
}
