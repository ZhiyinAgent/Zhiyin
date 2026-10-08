import { Fragment } from "react";
import type { WorkspaceIssue } from "@zhiyin/contract";
import { Icon } from "../shared/index.js";
import styles from "./app.module.css";

/**
 * What the core has reported as wrong, each once, with only the actions that
 * can change it: deleting a damaged conversation, updating one an earlier
 * version saved, and trying again only when the history itself could not be
 * loaded. Where a copy was kept stands on its own line, so a long path never
 * breaks the sentence. A report about one conversation shows only while that
 * conversation is the open one.
 */
export function IssueNotices({
  issues,
  openConversationId,
  retry,
  onDelete,
  onUpdate,
  onDismiss,
  onShowKept,
}: {
  issues: readonly WorkspaceIssue[] | undefined;
  openConversationId?: string | null | undefined;
  retry?: (() => void) | undefined;
  onDelete?: ((conversationId: string) => void) | undefined;
  /** Asks about the conversations waiting for an update. */
  onUpdate?: (() => void) | undefined;
  onDismiss?: ((message: string) => void) | undefined;
  /** Shows the kept copy selected in its folder. */
  onShowKept?: ((path: string) => void) | undefined;
}) {
  return issues
    ?.filter(
      (issue) =>
        !issue.conversationId || issue.conversationId === openConversationId,
    )
    .map((issue) => {
      const conversationId = issue.canDelete ? issue.conversationId : undefined;
      const update = issue.canUpdate ? onUpdate : undefined;
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
            {((conversationId && onDelete) ||
              update ||
              retry ||
              (issue.keptAt && onShowKept)) && (
              <div className={styles.issue__actions}>
                {issue.keptAt && onShowKept && (
                  <button
                    className="button"
                    type="button"
                    onClick={() => onShowKept(issue.keptAt as string)}
                  >
                    Show in folder
                  </button>
                )}
                {update && (
                  <button className="button" type="button" onClick={update}>
                    Update conversations…
                  </button>
                )}
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
