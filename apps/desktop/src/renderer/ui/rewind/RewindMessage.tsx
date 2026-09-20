import { useState, type ReactNode } from "react";
import type { RewindCommitResult, RewindPreview } from "@zhiyin/contract";
import { Dialog, Icon } from "../shared/index.js";
import styles from "./rewind.module.css";

type RewindMessageProps = {
  taskId: string;
  messageId: string;
  /** The message as the conversation draws it; rewind adds its control. */
  bubble: ReactNode;
  disabled?: boolean;
  onPreview: (taskId: string, messageId: string) => Promise<RewindPreview>;
  onCommit: (
    taskId: string,
    rewindId: string,
    files: "keep" | "restore",
  ) => Promise<RewindCommitResult>;
  onCommitted: (draft: string, result: RewindCommitResult) => void;
};

const keepsCurrentFiles = "keep" as const;

export function RewindMessage({
  taskId,
  messageId,
  bubble,
  disabled = false,
  onPreview,
  onCommit,
  onCommitted,
}: RewindMessageProps) {
  const [preview, setPreview] = useState<RewindPreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fileChoice, setFileChoice] = useState<"keep" | "restore">(
    keepsCurrentFiles,
  );

  async function review() {
    setBusy(true);
    setError("");
    try {
      setPreview(await onPreview(taskId, messageId));
      setFileChoice(keepsCurrentFiles);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "This rewind could not be reviewed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await onCommit(taskId, preview.id, fileChoice);
      const draft = preview.draft;
      setPreview(undefined);
      onCommitted(draft, result);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The conversation was not rewound. Review it again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.message}>
      {bubble}
      <button
        type="button"
        className={styles.action}
        aria-label="Rewind to this message"
        disabled={disabled || busy}
        onClick={() => void review()}
      >
        <Icon name="rewind" />
        Rewind
      </button>
      {!preview && error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {preview && (
        <Dialog
          title="Rewind conversation"
          onClose={() => {
            if (!busy) {
              setPreview(undefined);
              setError("");
            }
          }}
          footer={
            <>
              <button
                type="button"
                className="button button--quiet"
                disabled={busy}
                onClick={() => setPreview(undefined)}
              >
                Keep conversation
              </button>
              <button
                type="button"
                className="button button--accent"
                disabled={busy}
                onClick={() => void commit()}
              >
                Rewind conversation
              </button>
            </>
          }
        >
          <p>
            This removes the selected message and{" "}
            {preview.discardedMessages - 1}
            {preview.discardedMessages - 1 === 1
              ? " later message"
              : " later messages"}
            {preview.discardedActions.length
              ? `, plus ${preview.discardedActions.length} recorded ${preview.discardedActions.length === 1 ? "action" : "actions"}`
              : ""}
            .
          </p>
          {preview.files.some((file) => file.status === "recoverable") ? (
            <fieldset className={styles.choice}>
              <legend>Workspace files</legend>
              <label>
                <input
                  type="radio"
                  name={`rewind-files-${preview.id}`}
                  checked={fileChoice === "keep"}
                  onChange={() => setFileChoice(keepsCurrentFiles)}
                />
                <span>
                  <strong>Keep current files</strong>
                  Only rewind the conversation.
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name={`rewind-files-${preview.id}`}
                  checked={fileChoice === "restore"}
                  onChange={() => setFileChoice("restore")}
                />
                <span>
                  <strong>Restore recoverable files</strong>
                  Restore exact earlier bytes and remove files created by
                  discarded work.
                </span>
              </label>
            </fieldset>
          ) : (
            <p>Current workspace files will stay as they are.</p>
          )}
          {preview.files.length > 0 && (
            <section
              className={styles.effects}
              aria-label="Workspace file recovery"
            >
              <h3>Workspace file recovery</h3>
              <ul>
                {preview.files.map((file) => (
                  <li key={file.path}>
                    <strong>{file.path}</strong>
                    <span>
                      {file.status === "recoverable"
                        ? file.action === "remove"
                          ? "Created by discarded work · can be removed"
                          : "Earlier contents retained · can be restored"
                        : file.status === "conflict"
                          ? "Changed since the agent action · will not be overwritten"
                          : (file.reason ?? "No recovery copy is available")}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {preview.discardedActions.length > 0 && (
            <section
              className={styles.effects}
              aria-label="Effects that remain"
            >
              <h3>Effects that may remain</h3>
              <ul>
                {preview.discardedActions.map((action) => (
                  <li key={action.id}>
                    <strong>{action.action}</strong>
                    <span>{action.target}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}
