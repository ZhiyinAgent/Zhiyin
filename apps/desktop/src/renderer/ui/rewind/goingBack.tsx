import { useId, useState, type ReactNode } from "react";
import type {
  RewindCommitResult,
  RewindMemoryEffect,
  RewindPreview,
} from "@zhiyin/contract";
import {
  counted,
  Dialog,
  PathName,
  UndoChoices,
  type UndoChoice,
} from "../shared/index.js";
import styles from "./rewind.module.css";

/** Everything is undone unless the person clears it. */
const everything: UndoChoice = { files: true, memory: true };

/** A memory entry as the person knows it: its number and title. */
function entryName(write: {
  readonly number?: number;
  readonly title: string;
}): string {
  return write.number === undefined
    ? write.title
    : `#${write.number} ${write.title}`;
}

/** What becomes of one memory write, as the review says it before the choice is made. */
function memoryWords(effect: RewindMemoryEffect, undo: boolean): string {
  if (effect.status === "decided")
    return "Stays, as you already decided on it.";
  if (effect.status === "changed")
    return effect.reason ?? "Stays as it is, as it was changed since.";
  return undo ? "Taken back." : "Stays kept.";
}

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
    memory: "keep" | "undo",
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
 * What the discarded commands changed, found by listing their folder, less the
 * files the review already lists: a file a command created is removed with
 * the others when Zhiyin recorded it. Of the rest no copy was kept, so it
 * stays as it is whatever is chosen.
 */
function commandChangesOf(
  actions: RewindPreview["discardedActions"],
  reviewed: ReadonlySet<string>,
) {
  const paths = new Set<string>();
  let more = 0;
  const unlisted: { id: string; target: string; reason: string }[] = [];
  for (const action of actions) {
    const changes = action.commandChanges;
    if (changes?.status === "checked") {
      for (const file of changes.files)
        if (!reviewed.has(file.path)) paths.add(file.path);
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

/**
 * Which kinds of change going back can undo: files when one can be put back,
 * memory when an entry can be taken back.
 */
function offered(preview: RewindPreview) {
  return {
    files: preview.files.some((file) => file.status === "recoverable"),
    memory: preview.memory.some((effect) => effect.status === "undoable"),
  };
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
  const [choice, setChoice] = useState<UndoChoice>(everything);

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
      reviewed.memory.length > 0 ||
      reviewed.discardedActions.some(mayHaveChanged)
    ) {
      setChoice(everything);
      setAsking({ preview: reviewed, intent, text: words });
      return;
    }
    await commit(reviewed, words, everything);
  }

  async function commit(
    reviewed: RewindPreview,
    words: string,
    chosen: UndoChoice,
  ) {
    setBusy(true);
    setError("");
    const { files, memory } = offered(reviewed);
    try {
      const result = await onCommit(
        taskId,
        reviewed.id,
        files && chosen.files ? "restore" : "keep",
        memory && chosen.memory ? "undo" : "keep",
      );
      setAsking(undefined);
      await onSend(result, words);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The conversation did not go back. Try again.",
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
          choice={choice}
          onChoice={setChoice}
          onCancel={() => {
            if (busy) return;
            setAsking(undefined);
            setError("");
          }}
          onConfirm={() => void commit(asking.preview, asking.text, choice)}
        />
      )}
    </>
  );

  return { busy, send, question };
}

/**
 * The one question going back asks: what it removes, whether to undo its
 * file changes and its memory changes, and what stays as it is whatever is
 * chosen.
 */
function GoingBackQuestion({
  preview,
  intent,
  busy,
  error,
  choice,
  onChoice,
  onCancel,
  onConfirm,
}: {
  preview: RewindPreview;
  intent: Intent;
  busy: boolean;
  error: string;
  choice: UndoChoice;
  onChoice: (choice: UndoChoice) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const later = preview.laterUserMessages;
  const listedFiles = new Set(preview.files.map((file) => file.path));
  const commands = commandChangesOf(preview.discardedActions, listedFiles);
  const recoverable = preview.files.filter(
    (file) => file.status === "recoverable",
  );
  const kept = preview.files.filter((file) => file.status !== "recoverable");
  const can = offered(preview);
  const restore = can.files && choice.files;
  const undoMemory = can.memory && choice.memory;
  const undoable = preview.memory.filter(
    (effect) => effect.status === "undoable",
  );
  // What may have changed something that going back does not put back: not
  // a file listed above, a command whose changes are listed on their own, or
  // what was kept in memory, listed on its own.
  const remaining = preview.discardedActions.filter(
    (action) =>
      mayHaveChanged(action) &&
      !action.commandChanges &&
      !action.memory &&
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

      <UndoChoices
        files={{
          offered: can.files,
          detail: (
            <>
              Undoes {counted(recoverable.length, "change")} Zhiyin made after
              this message.
              {commands.count > 0 &&
                ` ${byCommand[0]!.toUpperCase()}${byCommand.slice(1)} ${commands.count === 1 ? "stays as it is" : "stay as they are"}.`}
            </>
          ),
        }}
        memory={{
          offered: can.memory,
          detail: `Takes back ${counted(undoable.length, "entry", "entries")} kept in memory after this message.`,
        }}
        choice={choice}
        onChange={onChoice}
        disabled={busy}
      />
      {!can.files &&
        (commands.count > 0 || remaining.length > 0 || kept.length > 0) && (
          <p className={styles.note}>
            Files stay as they are
            {commands.count > 0 ? `, including ${byCommand}` : ""}.
          </p>
        )}

      {preview.files.length > 0 && (
        <Effects title="Files Zhiyin changed">
          {preview.files.map((file) => (
            <li key={file.path}>
              <PathName path={file.path} className={styles.path} />
              <span>
                {file.status === "recoverable"
                  ? file.action === "remove"
                    ? restore
                      ? "Created after this message. Removed."
                      : "Created after this message. Stays."
                    : restore
                      ? "Put back as it was."
                      : "Stays as it is now."
                  : file.status === "conflict"
                    ? "You changed this file afterwards, so it is left as it is."
                    : (file.reason ??
                      "No copy was kept, so it stays as it is.")}
              </span>
            </li>
          ))}
        </Effects>
      )}

      {preview.memory.length > 0 && (
        <Effects title="Memory kept after this message">
          {preview.memory.map((effect) => (
            <li key={effect.writeId}>
              <strong>{entryName(effect)}</strong>
              <span>{memoryWords(effect, undoMemory)}</span>
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
                and {counted(commands.more, "more file")}, which stay as they
                are too
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
