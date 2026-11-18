import { Fragment, useState } from "react";
import type { WorkspaceIssue } from "@zhiyin/contract";
import { ConfirmChoice, Icon } from "../shared/index.js";
import styles from "./notices.module.css";

type Handlers = {
  retry?: (() => void) | undefined;
  onDelete?: ((conversationId: string) => void) | undefined;
  /** Asks about the conversations waiting for an update. */
  onUpdate?: (() => void) | undefined;
  onDismiss?:
    ((message: string, conversationId: string | undefined) => void) | undefined;
  /** Shows the kept copy selected in its folder. */
  onShowKept?: ((path: string) => void) | undefined;
};

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
  stacked = false,
  ...handlers
}: {
  issues: readonly WorkspaceIssue[] | undefined;
  openConversationId?: string | null | undefined;
  /** Several take turns in a region of their own. */
  stacked?: boolean;
} & Handlers) {
  return issues
    ?.filter(
      (issue) =>
        !issue.conversationId || issue.conversationId === openConversationId,
    )
    .map((issue) => (
      <IssueNotice
        key={issue.message}
        issue={issue}
        stacked={stacked}
        {...handlers}
      />
    ));
}

/**
 * One report. Deleting the conversation it concerns is asked first, as the
 * side column asks, and the question says whether a copy of it stays.
 */
function IssueNotice({
  issue,
  stacked,
  retry,
  onDelete,
  onUpdate,
  onDismiss,
  onShowKept,
}: { issue: WorkspaceIssue; stacked: boolean } & Handlers) {
  const [confirming, setConfirming] = useState(false);
  const conversationId = issue.canDelete ? issue.conversationId : undefined;
  const deletable = conversationId !== undefined && onDelete !== undefined;
  const update = issue.canUpdate ? onUpdate : undefined;
  const showKept = issue.keptAt && onShowKept;
  return (
    <div
      className={`${styles.issue}${stacked ? ` ${styles["issue--stacked"]}` : ""}`}
      role="alert"
    >
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
        {confirming && deletable ? (
          <div
            className={styles.issue__confirm}
            role="group"
            aria-label="Delete this conversation?"
          >
            <ConfirmChoice
              question="Delete this conversation?"
              detail={
                issue.keptAt
                  ? "The copy in the folder above stays."
                  : "No copy of it was kept, so it cannot be brought back."
              }
              act="Delete conversation"
              small
              onKeep={() => setConfirming(false)}
              onAct={() => {
                setConfirming(false);
                onDelete(conversationId);
              }}
            />
          </div>
        ) : (
          (deletable || update || retry || showKept) && (
            <div className={styles.issue__actions}>
              {showKept && (
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
              {deletable && (
                <button
                  className="button"
                  type="button"
                  onClick={() => setConfirming(true)}
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
          )
        )}
      </div>
      {onDismiss && (
        <button
          className={styles.issue__dismiss}
          type="button"
          aria-label="Dismiss"
          onClick={() => onDismiss(issue.message, issue.conversationId)}
        >
          <Icon name="x" />
        </button>
      )}
    </div>
  );
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
