import { useId, useState, type ReactNode } from "react";
import type { RewindCommitResult, RewindPreview } from "@zhiyin/contract";
import { Dialog, PathName } from "../shared/index.js";
import styles from "./rewind.module.css";

/** Going back to one of the person's messages, to send it again or edited. */
export type GoingBackProps = {
  taskId: string;
  messageId: string;
  /** The message's words, sent again as they are by a resend. */
  text: string;
  onPreview: (taskId: string, messageId: string) => Promise<RewindPreview>;
  onCommit: (
    taskId: string,
    rewindId: string,
    files: "keep" | "restore",
  ) => Promise<RewindCommitResult>;
  /** Sends these words in the message's place, once the rewind is done. */
  onSend: (result: RewindCommitResult, text: string) => Promise<void>;
};

export type Intent = "edit" | "resend";

/**
 * Whether an action the rewind discards may have left something behind. A
 * call that was refused never ran; anything else counts unless the app knows
 * it only read.
 */
function mayHaveChanged(action: RewindPreview["discardedActions"][number]) {
  return (
    !action.readOnly &&
    action.status !== "denied" &&
    action.status !== "blocked"
  );
}

/**
 * What the discarded commands changed, found by listing their folder. No copy
 * of any of it was kept, so all of it stays as it is whatever is chosen.
 */
function commandChangesOf(actions: RewindPreview["discardedActions"]) {
  const paths = new Set<string>();
  let more = 0;
  const unlisted: { id: string; target: string; reason: string }[] = [];
  for (const action of actions) {
    const changes = action.commandChanges;
    if (changes?.status === "checked") {
      for (const file of changes.files) paths.add(file.path);
      more += changes.more ?? 0;
    } else if (changes?.status === "unchecked")
      unlisted.push({
        id: action.id,
        target: action.target,
        reason: changes.reason,
      });
  }
  return { paths: [...paths], more, unlisted, count: paths.size + more };
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The going-back flow, for whichever buttons start it. `send` goes back to the
 * message and sends the words given in its place; `question` is what it asks
 * first, when going back would cost more than this message's own replies.
 */
export function useGoingBack({
  taskId,
  messageId,
  text,
  onPreview,
  onCommit,
  onSend,
}: GoingBackProps) {
  const [asking, setAsking] = useState<{
    preview: RewindPreview;
    intent: Intent;
    text: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [restore, setRestore] = useState(false);

  async function send(intent: Intent, words = text) {
    setBusy(true);
    setError("");
    let reviewed: RewindPreview;
    try {
      reviewed = await onPreview(taskId, messageId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "This message could not be reviewed. Try again.",
      );
      setBusy(false);
      return;
    }
    setBusy(false);
    // Asks only when going back costs more than this message's own replies.
    if (
      reviewed.laterUserMessages > 0 ||
      reviewed.files.length > 0 ||
      reviewed.discardedActions.some(mayHaveChanged)
    ) {
      setRestore(false);
      setAsking({ preview: reviewed, intent, text: words });
      return;
    }
    await commit(reviewed, words, "keep");
  }

  async function commit(
    reviewed: RewindPreview,
    words: string,
    files: "keep" | "restore",
  ) {
    setBusy(true);
    setError("");
    try {
      const result = await onCommit(taskId, reviewed.id, files);
      setAsking(undefined);
      await onSend(result, words);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The conversation was not rewound. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const question: ReactNode = (
    <>
      {!asking && error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {asking && (
        <GoingBackQuestion
          {...asking}
          busy={busy}
          error={error}
          restore={restore}
          onRestore={setRestore}
          onCancel={() => {
            if (busy) return;
            setAsking(undefined);
            setError("");
          }}
          onConfirm={() =>
            void commit(
              asking.preview,
              asking.text,
              restore ? "restore" : "keep",
            )
          }
        />
      )}
    </>
  );

  return { busy, send, question };
}

/**
 * The one question going back asks: what it removes, whether to put files
 * back, and what stays as it is whatever is chosen.
 */
function GoingBackQuestion({
  preview,
  intent,
  busy,
  error,
  restore,
  onRestore,
  onCancel,
  onConfirm,
}: {
  preview: RewindPreview;
  intent: Intent;
  busy: boolean;
  error: string;
  restore: boolean;
  onRestore: (restore: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const restoreDetail = useId();
  const later = preview.laterUserMessages;
  const commands = commandChangesOf(preview.discardedActions);
  const recoverable = preview.files.filter(
    (file) => file.status === "recoverable",
  );
  const kept = preview.files.filter((file) => file.status !== "recoverable");
  // What may have changed something that going back does not put back: not
  // a file listed above, nor a command whose changes are listed on their own.
  const listedFiles = new Set(preview.files.map((file) => file.path));
  const remaining = preview.discardedActions.filter(
    (action) =>
      mayHaveChanged(action) &&
      !action.commandChanges &&
      !listedFiles.has(action.target),
  );
  const byCommand =
    commands.count === 1
      ? "the file changed while a command ran"
      : `the ${commands.count} files changed while a command ran`;

  return (
    <Dialog
      title="Go back to this message?"
      onClose={onCancel}
      footer={
        <>
          <button
            type="button"
            className="button button--quiet"
            disabled={busy}
            onClick={onCancel}
          >
            Keep the conversation
          </button>
          <button
            type="button"
            className="button button--accent"
            disabled={busy}
            onClick={onConfirm}
          >
            {intent === "resend" ? "Go back and resend" : "Go back and send"}
          </button>
        </>
      }
    >
      <p className={styles.lead}>
        Everything after this message is removed
        {later === 1
          ? ", including your later message"
          : later > 1
            ? `, including ${later} of your later messages`
            : ""}
        .{" "}
        {intent === "resend"
          ? "It is then sent again."
          : "Your edited message is then sent in its place."}
      </p>

      {recoverable.length > 0 ? (
        <label className={styles.restore}>
          <input
            type="checkbox"
            checked={restore}
            aria-describedby={restoreDetail}
            onChange={(event) => onRestore(event.target.checked)}
          />
          <span>
            <strong>Put the files back as they were</strong>
            <span id={restoreDetail}>
              Undoes {plural(recoverable.length, "change")} Zhiyin made after
              this message.
              {commands.count > 0 &&
                ` ${byCommand[0]!.toUpperCase()}${byCommand.slice(1)} ${commands.count === 1 ? "stays as it is" : "stay as they are"}.`}
            </span>
          </span>
        </label>
      ) : (
        (commands.count > 0 || remaining.length > 0 || kept.length > 0) && (
          <p className={styles.note}>
            Files stay as they are
            {commands.count > 0 ? `, including ${byCommand}` : ""}.
          </p>
        )
      )}

      {preview.files.length > 0 && (
        <Effects title="Files Zhiyin changed">
          {preview.files.map((file) => (
            <li key={file.path}>
              <PathName path={file.path} className={styles.path} />
              <span>
                {file.status === "recoverable"
                  ? file.action === "remove"
                    ? "Created after this message. Removed if you put files back."
                    : "Put back as it was if you put files back."
                  : file.status === "conflict"
                    ? "You changed this file afterwards, so it is left as it is."
                    : (file.reason ??
                      "No copy was kept, so it stays as it is.")}
              </span>
            </li>
          ))}
        </Effects>
      )}

      {(commands.count > 0 || commands.unlisted.length > 0) && (
        <Effects title="Changed while a command ran">
          {commands.paths.map((path) => (
            <li key={path}>
              <PathName path={path} className={styles.path} />
              <span>No copy was kept, so it stays as it is.</span>
            </li>
          ))}
          {commands.more > 0 && (
            <li>
              <span>
                and {plural(commands.more, "more file")}, which stay as they are
                too
              </span>
            </li>
          )}
          {commands.unlisted.map(({ id, target, reason }) => (
            <li key={id}>
              <span>
                {target}: what it changed was not listed. {reason}
              </span>
            </li>
          ))}
        </Effects>
      )}

      {remaining.length > 0 && (
        <Effects title="Not undone by going back">
          {remaining.map((action) => (
            <li key={action.id}>
              <strong>{action.action}</strong>
              {action.target && <span>{action.target}</span>}
            </li>
          ))}
        </Effects>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

/** One kind of thing going back leaves or changes, as a short list. */
function Effects({ title, children }: { title: string; children: ReactNode }) {
  const heading = useId();
  return (
    <section className={styles.effects} aria-labelledby={heading}>
      <h3 id={heading}>{title}</h3>
      <ul>{children}</ul>
    </section>
  );
}
