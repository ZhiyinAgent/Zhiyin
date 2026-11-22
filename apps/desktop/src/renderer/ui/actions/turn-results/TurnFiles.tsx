import { useId, useState } from "react";
import type {
  DocumentComparison,
  RewindCommitResult,
  TaskAction,
  TaskUndo,
  UndoPreview,
} from "@zhiyin/contract";
import {
  counted,
  Dialog,
  Icon,
  PathName,
  UndoChoices,
  visibleText,
  type UndoChoice,
} from "../../shared/index.js";
import { comparable, DiffModal } from "../change-review/DiffModal.js";
import { changeWords, moveWords, shownKind } from "../actionWords.js";
import {
  changedFiles,
  commandNotes,
  undoable,
  type TurnFile,
} from "./turnChanges.js";
import styles from "./turn-results.module.css";

/** Rows shown before the rest are asked for. */
const shownAtFirst = 5;

/** Everything is undone unless the person clears it. */
const everything: UndoChoice = { files: true, memory: true };

const undoneWords: Record<
  RewindCommitResult["files"][number]["status"],
  string
> = {
  restored: "Put back",
  removed: "Removed",
  conflict: "You changed it afterwards, so it was left as it is",
  unprotected: "Not put back: no copy was kept",
};

function previewWords(
  file: UndoPreview["files"][number],
  restoring: boolean,
): string {
  if (file.status === "conflict")
    return "You changed this file afterwards, so it will not be touched.";
  if (file.status === "unprotected")
    return file.reason
      ? `Stays as it is. ${file.reason}`
      : "Stays as it is, as no copy was kept.";
  if (!restoring) return "Stays as this turn left it.";
  return file.action === "remove"
    ? "Removed, as this turn created it."
    : "Goes back to how it was.";
}

/** A memory entry as the person knows it: its number and title. */
function entryName(write: {
  readonly number?: number;
  readonly title: string;
}): string {
  return write.number === undefined
    ? write.title
    : `#${write.number} ${write.title}`;
}

/** What memory refused to take back, said once the undo is done; empty when nothing. */
function refusedWords(result: RewindCommitResult): string {
  const refused = (result.memory ?? []).filter(
    (write) => write.status === "refused",
  );
  if (!refused.length) return "";
  return [
    refused.length === 1
      ? "One memory entry stays kept:"
      : `${refused.length} memory entries stay kept:`,
    ...refused.map((write) => write.reason ?? `${entryName(write)} stays.`),
  ].join(" ");
}

function rowNote(file: TurnFile): string | undefined {
  if (!file.declared && file.change.change === "created")
    return file.command === "later"
      ? "Created by a command that finished later"
      : "Created by a command";
  if (!file.declared && file.kept)
    return file.command === "later"
      ? "Changed by a command that finished later"
      : "Changed by a command";
  if (!file.declared)
    return file.command === "later"
      ? "Changed by a command that finished later, so no copy was kept"
      : "Changed by a command, so no copy was kept";
  if (file.command) return "A command changed it too";
  if (file.change.change === "recycled") return "In the Recycle Bin";
  if (file.change.change === "deleted") return "Deleted permanently";
  const moved = moveWords(file.change);
  if (moved) return moved;
  if (file.noCopy) return `No copy: ${visibleText(file.noCopy)}`;
  return undefined;
}

type TurnFilesProps = {
  /** The turn's actions; those that changed no file are passed over. */
  actions: readonly TaskAction[];
  /** The undo already made of this turn, if any. */
  undone?: TaskUndo | undefined;
  running: boolean;
  onPreviewUndo?: () => Promise<UndoPreview>;
  onCommitUndo?: (
    undoId: string,
    files: "keep" | "restore",
    memory: "keep" | "undo",
  ) => Promise<RewindCommitResult>;
  /** What the turn did to a PDF, as its words before and after. */
  onCompareDocument?:
    ((path: string) => Promise<DocumentComparison>) | undefined;
};

/**
 * What a turn did to the person's files, under the turn: how many, how many
 * lines, each file's difference, and one undo for all of them. A file that
 * cannot be put back says why on its own row, so the undo never promises more
 * than it can do.
 */
export function TurnFiles({
  actions,
  undone,
  running,
  onPreviewUndo,
  onCommitUndo,
  onCompareDocument,
}: TurnFilesProps) {
  const files = changedFiles(actions);
  const { notes, more } = commandNotes(actions);
  const [reviewing, setReviewing] = useState<string>();
  const [showAll, setShowAll] = useState(false);
  const [preview, setPreview] = useState<UndoPreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState<UndoChoice>(everything);
  /** What memory left kept when the undo was made, said once it is done. */
  const [left, setLeft] = useState("");
  const headingId = useId();
  // A working turn's changes are its action rows; a summary under them would
  // read as the turn's conclusion before it has one.
  if (running || (!files.length && !notes.length)) return null;

  // A file moved within the panel is one file, though both its ends are rows.
  const paths = new Set(files.map((file) => file.path));
  const count =
    files.filter(
      (file) =>
        file.change.change !== "moved" ||
        file.change.to === undefined ||
        !paths.has(file.change.to),
    ).length + more;
  const added = files.reduce((sum, file) => sum + (file.added ?? 0), 0);
  const removed = files.reduce((sum, file) => sum + (file.removed ?? 0), 0);
  const shown = showAll ? files : files.slice(0, shownAtFirst);
  const outcome = new Map(undone?.files.map((file) => [file.path, file]));
  const canUndo =
    !undone && Boolean(onPreviewUndo && onCommitUndo) && files.some(undoable);
  // Once undone, the earlier version is back and there is no change to read.
  const compareDocument = undone ? undefined : onCompareDocument;
  const offered = {
    files:
      preview?.files.some((file) => file.status === "recoverable") ?? false,
    memory:
      preview?.memory.some((effect) => effect.status === "undoable") ?? false,
  };
  const ticked =
    (offered.files && choice.files) || (offered.memory && choice.memory);
  // A kind with no box is undone as the review stands: its files, as an undo
  // always has; its memory, not. With every box cleared there is no undo.
  const chosen =
    preview && (ticked || (!offered.files && !offered.memory))
      ? ({
          files: !offered.files || choice.files ? "restore" : "keep",
          memory: offered.memory && choice.memory ? "undo" : "keep",
        } as const)
      : undefined;

  async function review() {
    if (!onPreviewUndo) return;
    setBusy(true);
    setError("");
    setLeft("");
    try {
      setPreview(await onPreviewUndo());
      setChoice(everything);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The changes could not be reviewed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!preview || !onCommitUndo || !chosen) return;
    setBusy(true);
    setError("");
    try {
      const result = await onCommitUndo(
        preview.id,
        chosen.files,
        chosen.memory,
      );
      setPreview(undefined);
      setLeft(refusedWords(result));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The changes were not undone. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles["turn-files"]} aria-labelledby={headingId}>
      <header className={styles["turn-files__header"]}>
        <Icon name="file" aria-hidden="true" />
        <h3 id={headingId}>
          {count === 0
            ? "Changed files"
            : count === 1
              ? "1 file changed"
              : `${count} files changed`}
        </h3>
        {(added > 0 || removed > 0) && (
          <span className={styles["turn-files__counts"]}>
            {added > 0 && (
              <span className={styles["turn-files__added"]}>+{added}</span>
            )}
            {removed > 0 && (
              <span className={styles["turn-files__removed"]}>−{removed}</span>
            )}
          </span>
        )}
        {undone && <span className={styles["turn-files__undone"]}>Undone</span>}
        {canUndo && (
          <button
            type="button"
            className={`text-button ${styles["turn-files__undo"]}`}
            aria-label="Undo these changes"
            disabled={busy}
            onClick={() => void review()}
          >
            <Icon name="rewind" />
            Undo
          </button>
        )}
      </header>
      {files.length > 0 && (
        <ul className={styles["turn-files__rows"]}>
          {shown.map((file) => {
            const result = outcome.get(file.path);
            const note =
              undone && result ? undoneWords[result.status] : rowNote(file);
            const viewable = comparable(file.change)
              ? Boolean(file.declared && compareDocument && !file.noCopy)
              : file.change.before !== undefined ||
                file.change.after !== undefined ||
                file.change.diff !== undefined ||
                Boolean(file.change.omitted);
            const kind = shownKind(file.change);
            // A note naming where a file went may be a whole path, and is
            // given at most half the row, beside the file it is about.
            const movedNote =
              note !== undefined && note === moveWords(file.change);
            return (
              <li
                key={file.path}
                className={`${styles["turn-files__row"]}${movedNote ? ` ${styles["turn-files__row--move"]}` : ""}`}
              >
                <span
                  className={`${styles["turn-files__kind"]} ${styles[`turn-files__kind--${kind}`]}`}
                  aria-label={changeWords[kind].label}
                  data-tip={changeWords[kind].label}
                >
                  <Icon name={changeWords[kind].icon} />
                </span>
                <PathName
                  path={file.path}
                  className={styles["turn-files__path"]}
                />
                {note ? (
                  <span className={styles["turn-files__note"]}>{note}</span>
                ) : (
                  <span className={styles["turn-files__counts"]}>
                    {file.added ? (
                      <span className={styles["turn-files__added"]}>
                        +{file.added}
                      </span>
                    ) : null}
                    {file.removed ? (
                      <span className={styles["turn-files__removed"]}>
                        −{file.removed}
                      </span>
                    ) : null}
                  </span>
                )}
                {viewable && (
                  <button
                    type="button"
                    className={`text-button ${styles["turn-files__review"]}`}
                    aria-label={`Review ${visibleText(file.path)}`}
                    onClick={() => setReviewing(file.path)}
                  >
                    Review
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {files.length > shown.length && (
        <button
          type="button"
          className={`text-button ${styles["turn-files__more"]}`}
          onClick={() => setShowAll(true)}
        >
          Show {files.length - shown.length} more
        </button>
      )}
      {notes.length > 0 && (
        <div className={styles["turn-files__notes"]}>
          {notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      )}
      {!preview && error && (
        <p className={styles["turn-files__error"]} role="alert">
          {error}
        </p>
      )}
      {!preview && left && (
        <p className={styles["turn-files__left"]} role="status">
          {left}
        </p>
      )}
      {reviewing && (
        <DiffModal
          changes={files
            .filter((file) => file.declared)
            .map((file) => file.change)}
          initialPath={reviewing}
          compareDocument={compareDocument}
          onClose={() => setReviewing(undefined)}
        />
      )}
      {preview && (
        <Dialog
          title="Undo these changes"
          onClose={() => {
            if (!busy) setPreview(undefined);
          }}
          footer={
            <>
              <button
                type="button"
                className="button button--quiet"
                disabled={busy}
                onClick={() => setPreview(undefined)}
              >
                Keep them
              </button>
              <button
                type="button"
                className="button button--accent"
                disabled={busy || !chosen}
                onClick={() => void undo()}
              >
                Undo changes
              </button>
            </>
          }
        >
          <p className={styles["turn-files__lead"]}>
            {preview.memory.length > 0
              ? "The conversation stays as it is. Only what you choose below changes, and a file you changed afterwards is never overwritten."
              : "The conversation stays as it is. Only these files change, and a file you changed afterwards is never overwritten."}
            {files.some((file) => !file.declared && !undoable(file)) &&
              " Files a command changed stay as they are, as no copy was kept of them."}
          </p>
          <UndoChoices
            files={{
              offered: offered.files,
              detail: `Puts back ${counted(
                preview.files.filter((file) => file.status === "recoverable")
                  .length,
                "file",
              )} this turn changed.`,
            }}
            memory={{
              offered: offered.memory,
              detail: `Takes back ${counted(
                preview.memory.filter((effect) => effect.status === "undoable")
                  .length,
                "entry",
                "entries",
              )} this turn kept in memory.`,
            }}
            choice={choice}
            onChange={setChoice}
            disabled={busy}
          />
          <ul className={styles["turn-files__preview"]}>
            {preview.files.map((file) => (
              <li key={file.path}>
                <Icon
                  name={
                    file.status !== "recoverable"
                      ? "lock"
                      : file.action === "remove"
                        ? "trash"
                        : "rewind"
                  }
                  aria-hidden="true"
                />
                <PathName path={file.path} />
                <span>{previewWords(file, chosen?.files !== "keep")}</span>
              </li>
            ))}
          </ul>
          {preview.memory.length > 0 && (
            <>
              <h4 className={styles["turn-files__subhead"]}>
                Memory this turn kept
              </h4>
              <ul className={styles["turn-files__preview"]}>
                {preview.memory.map((effect) => (
                  <li key={effect.writeId}>
                    <Icon
                      name={effect.status === "undoable" ? "rewind" : "lock"}
                      aria-hidden="true"
                    />
                    <span>{entryName(effect)}</span>
                    <span>
                      {effect.status === "decided"
                        ? "Stays, as you already decided on it."
                        : effect.status === "changed"
                          ? (effect.reason ??
                            "Stays as it is, as it was changed since.")
                          : chosen?.memory === "undo"
                            ? "Taken back."
                            : "Stays kept."}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {error && (
            <p className={styles["turn-files__error"]} role="alert">
              {error}
            </p>
          )}
        </Dialog>
      )}
    </section>
  );
}
