import { useId, useState } from "react";
import type {
  CommandFileChange,
  DocumentComparison,
  FileChange,
  RewindCommitResult,
  TaskAction,
  TaskUndo,
  UndoPreview,
} from "@zhiyin/contract";
import { diffLines } from "@zhiyin/contract";
import { Dialog, Icon, PathName } from "../shared/index.js";
import { comparable, DiffModal } from "./DiffModal.js";
import styles from "./actions.module.css";

/** One file a turn changed, from its first version in the turn to its last. */
export type TurnFile = {
  readonly path: string;
  readonly change: FileChange;
  /** Lines, when both versions are known. */
  readonly added?: number;
  readonly removed?: number;
  /** Why no copy was kept, when none was. */
  readonly noCopy?: string;
  /**
   * False when only a listing around a command saw it change: nothing of its
   * contents is known, and nothing can put it back.
   */
  readonly declared: boolean;
  /** Seen changing while a command ran, or while one that finished later did. */
  readonly command?: "during" | "later";
};

/** Rows shown before the rest are asked for. */
const shownAtFirst = 5;

type Seen = {
  first?: FileChange;
  last?: FileChange;
  /** What listings around commands saw, first and last. */
  listed?: { first: CommandFileChange; last: CommandFileChange };
  command?: "during" | "later";
};

/**
 * The files a turn's actions changed, one row per file. Only actions that ran
 * count; a file changed twice is shown from before the first change to after
 * the last. A file seen changing while a command ran is listed too, without
 * contents.
 */
export function changedFiles(actions: readonly TaskAction[]): TurnFile[] {
  const byPath = new Map<string, Seen>();
  const noCopy = new Map<string, string>();
  const seen = (path: string) => {
    const found = byPath.get(path) ?? {};
    byPath.set(path, found);
    return found;
  };
  for (const action of actions) {
    // Present only for a command that started, which may have changed files
    // however it ended.
    const listed = action.commandChanges;
    if (listed?.status === "checked")
      for (const change of listed.files) {
        const file = seen(change.path);
        file.listed = { first: file.listed?.first ?? change, last: change };
        file.command =
          file.command === "later" || listed.job ? "later" : "during";
      }
    if (action.status !== "completed" && action.status !== "reported") continue;
    for (const change of action.changes ?? []) {
      const file = seen(change.path);
      file.first ??= change;
      file.last = change;
    }
    for (const file of action.recovery?.files ?? [])
      if (file.status === "unprotected" && !noCopy.has(file.path))
        noCopy.set(
          file.path,
          file.reason ?? "No copy was kept before the change.",
        );
  }
  return [...byPath.entries()].map(([path, file]) => {
    const command = file.command ? { command: file.command } : {};
    if (!file.first || !file.last)
      return {
        path,
        change: { path, change: listedKind(file.listed!) },
        declared: false,
        ...command,
      };
    const change = merged(file.first, file.last);
    const counted =
      change.after !== undefined &&
      (change.before !== undefined || change.change === "created")
        ? diffLines(change.before ?? "", change.after)
        : undefined;
    const reason = noCopy.get(path);
    return {
      path,
      change,
      declared: true,
      ...(counted ? { added: counted.added, removed: counted.removed } : {}),
      ...(reason ? { noCopy: reason } : {}),
      ...command,
    };
  });
}

/** What became of a file over the turn, from what the listings saw. */
function listedKind(listed: {
  first: CommandFileChange;
  last: CommandFileChange;
}): CommandFileChange["change"] {
  if (listed.last.change === "deleted") return "deleted";
  return listed.first.change === "created" ? "created" : listed.last.change;
}

/**
 * What the panel says about commands beyond their files: one still running,
 * folders not checked, and files changed beyond those named.
 */
function commandNotes(actions: readonly TaskAction[]): {
  readonly notes: readonly string[];
  readonly more: number;
} {
  const notes = new Set<string>();
  let more = 0;
  for (const { commandChanges: listed } of actions) {
    if (listed?.status === "running")
      notes.add(
        "A command is still running; what it changes is listed when it ends.",
      );
    else if (listed?.status === "unchecked")
      notes.add(`Files changed by commands are not listed. ${listed.reason}`);
    else if (listed?.more) more += listed.more;
  }
  if (more)
    notes.add(
      more === 1
        ? "1 more file changed while a command ran."
        : `${more} more files changed while commands ran.`,
    );
  return { notes: [...notes], more };
}

/** Whether the turn has anything to say about files, and so a panel. */
export function touchesFiles(actions: readonly TaskAction[]): boolean {
  return (
    changedFiles(actions).length > 0 || commandNotes(actions).notes.length > 0
  );
}

function merged(first: FileChange, last: FileChange): FileChange {
  if (first === last) return first;
  const created = first.change === "created";
  const kind =
    last.change === "recycled" || last.change === "deleted"
      ? last.change
      : created
        ? "created"
        : "updated";
  return {
    path: last.path,
    change: kind,
    ...(first.before !== undefined ? { before: first.before } : {}),
    ...(last.after !== undefined ? { after: last.after } : {}),
    ...(last.omitted || first.omitted
      ? { omitted: last.omitted ?? first.omitted }
      : {}),
  };
}

/** Whether undo could put this file back: a copy exists, or it was created. */
function undoable(file: TurnFile): boolean {
  return (
    file.declared &&
    !file.noCopy &&
    (file.change.change === "created" || file.change.change === "updated")
  );
}

const undoneWords: Record<
  RewindCommitResult["files"][number]["status"],
  string
> = {
  restored: "Put back",
  removed: "Removed",
  conflict: "You changed it afterwards, so it was left as it is",
  unprotected: "Not put back: no copy was kept",
};

function previewWords(file: UndoPreview["files"][number]): string {
  if (file.status === "conflict")
    return "You changed this file afterwards, so it will not be touched.";
  if (file.status === "unprotected")
    return file.reason
      ? `Stays as it is. ${file.reason}`
      : "Stays as it is, as no copy was kept.";
  return file.action === "remove"
    ? "Removed, as this turn created it."
    : "Goes back to how it was.";
}

function rowNote(file: TurnFile): string | undefined {
  if (!file.declared)
    return file.command === "later"
      ? "Changed by a command that finished later, so no copy was kept"
      : "Changed by a command, so no copy was kept";
  if (file.command) return "A command changed it too";
  if (file.change.change === "recycled") return "In the Recycle Bin";
  if (file.change.change === "deleted") return "Deleted permanently";
  if (file.noCopy) return `No copy: ${file.noCopy}`;
  return undefined;
}

type TurnFilesProps = {
  /** The turn's actions; those that changed no file are passed over. */
  actions: readonly TaskAction[];
  /** The undo already made of this turn, if any. */
  undone?: TaskUndo;
  running: boolean;
  onPreviewUndo?: () => Promise<UndoPreview>;
  onCommitUndo?: (undoId: string) => Promise<RewindCommitResult>;
  /** What the turn did to a PDF, as its words before and after. */
  onCompareDocument?: (path: string) => Promise<DocumentComparison>;
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
  const headingId = useId();
  // A working turn's changes are its action rows; a summary under them would
  // read as the turn's conclusion before it has one.
  if (running || (!files.length && !notes.length)) return null;

  const count = files.length + more;
  const added = files.reduce((sum, file) => sum + (file.added ?? 0), 0);
  const removed = files.reduce((sum, file) => sum + (file.removed ?? 0), 0);
  const shown = showAll ? files : files.slice(0, shownAtFirst);
  const outcome = new Map(undone?.files.map((file) => [file.path, file]));
  const canUndo =
    !undone && Boolean(onPreviewUndo && onCommitUndo) && files.some(undoable);
  // Once undone, the earlier version is back and there is no change to read.
  const compareDocument = undone ? undefined : onCompareDocument;

  async function review() {
    if (!onPreviewUndo) return;
    setBusy(true);
    setError("");
    try {
      setPreview(await onPreviewUndo());
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
    if (!preview || !onCommitUndo) return;
    setBusy(true);
    setError("");
    try {
      await onCommitUndo(preview.id);
      setPreview(undefined);
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
              ? Boolean(compareDocument && !file.noCopy)
              : file.change.before !== undefined ||
                file.change.after !== undefined ||
                Boolean(file.change.omitted);
            return (
              <li key={file.path} className={styles["turn-files__row"]}>
                <span
                  className={`${styles["turn-files__kind"]} ${styles[`turn-files__kind--${file.change.change}`]}`}
                  aria-label={kindLabel[file.change.change]}
                  data-tip={kindLabel[file.change.change]}
                >
                  <Icon name={kindIcon[file.change.change]} />
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
                    aria-label={`Review ${file.path}`}
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
      {reviewing && (
        <DiffModal
          changes={files
            .filter((file) => file.declared)
            .map((file) => file.change)}
          initialPath={reviewing}
          {...(compareDocument ? { compareDocument } : {})}
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
                disabled={busy}
                onClick={() => void undo()}
              >
                Undo changes
              </button>
            </>
          }
        >
          <p className={styles["turn-files__lead"]}>
            The conversation stays as it is. Only these files change, and a file
            you changed afterwards is never overwritten.
            {files.some((file) => !file.declared) &&
              " Files a command changed stay as they are, as no copy was kept of them."}
          </p>
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
                <span>{previewWords(file)}</span>
              </li>
            ))}
          </ul>
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

const kindLabel: Record<FileChange["change"], string> = {
  created: "Created",
  updated: "Changed",
  recycled: "Moved to the Recycle Bin",
  deleted: "Deleted",
};

const kindIcon: Record<FileChange["change"], "plus" | "pencil" | "trash"> = {
  created: "plus",
  updated: "pencil",
  recycled: "trash",
  deleted: "trash",
};
