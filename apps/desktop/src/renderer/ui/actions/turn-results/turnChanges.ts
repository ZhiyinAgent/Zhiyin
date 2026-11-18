/**
 * What a turn did to files, worked out from its actions, with no drawing in
 * it: one entry per file from its first version in the turn to its last, what
 * the panel says about commands beyond their files, and whether undo could
 * put a file back.
 */

import type {
  CommandFileChange,
  FileChange,
  TaskAction,
} from "@zhiyin/contract";
import { ranToItsEnd } from "@zhiyin/conversation-rules";
import { lineCounts } from "../change-review/lineCounts.js";

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
   * contents is known. Only a file a command created can be undone, by
   * removing it.
   */
  readonly declared: boolean;
  /** Seen changing while a command ran, or while one that finished later did. */
  readonly command?: "during" | "later";
};

type Seen = {
  first?: FileChange;
  last?: FileChange;
  /** What listings around commands saw, first and last. */
  listed?: { first: CommandFileChange; last: CommandFileChange };
  command?: "during" | "later";
  /** Its contents now, when known; kept as it leaves by a move, for where it goes. */
  now?: string;
  /** How the file here now came by a move, when it did. */
  arrival?: Arrival;
};

/** What the turn knew of a file before it changed it, wherever it was then. */
type Beginning = {
  /** The turn made it, so it had no contents before. */
  readonly made: boolean;
  /** Its contents as the turn found it, when known. */
  origin?: string;
};

/** A file moved here in the turn, and where from. */
type Arrival = Beginning & { readonly from: string };

/** What the turn knew of the file at this path before changing it. */
function beginning(file: Seen | undefined): Beginning {
  if (file?.arrival) {
    const { made, origin } = file.arrival;
    return origin === undefined ? { made } : { made, origin };
  }
  const first = file?.first;
  // A path the turn left by a move and filled again holds a file it made;
  // one whose only change so far is the move leaving it held one from before.
  if (
    first?.change === "created" ||
    (first?.change === "moved" && first !== file?.last)
  )
    return { made: true };
  return first?.before === undefined
    ? { made: false }
    : { made: false, origin: first.before };
}

/** Follows one declared change at its path, carrying a moved file's contents to where it goes. */
function follow(
  file: Seen,
  change: FileChange,
  byPath: ReadonlyMap<string, Seen>,
): void {
  if (change.change === "created" && change.from !== undefined) {
    const source = byPath.get(change.from);
    file.arrival = { from: change.from, ...beginning(source) };
    if (source?.now === undefined) delete file.now;
    else file.now = source.now;
    return;
  }
  // The first change after a file arrived says what it held as it came.
  const { arrival, last } = file;
  if (
    arrival &&
    !arrival.made &&
    arrival.origin === undefined &&
    last?.change === "created" &&
    last.from !== undefined &&
    change.before !== undefined
  )
    arrival.origin = change.before;
  if (change.change === "created") delete file.arrival;
  if (change.change === "moved") return;
  if (change.after === undefined) delete file.now;
  else file.now = change.after;
}

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
    if (!ranToItsEnd(action)) continue;
    for (const change of action.changes ?? []) {
      const file = seen(change.path);
      follow(file, change, byPath);
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
    const change = merged(file.first, file.last, file);
    const counted = lineCounts(change, file.first, file.last);
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
export function commandNotes(actions: readonly TaskAction[]): {
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
  // The same files changedFiles lists, found without comparing any.
  return (
    actions.some(
      (action) =>
        (action.commandChanges?.status === "checked" &&
          action.commandChanges.files.length > 0) ||
        (ranToItsEnd(action) && (action.changes?.length ?? 0) > 0),
    ) || commandNotes(actions).notes.length > 0
  );
}

const tooLargeTwice =
  "This file changed more than once and is too large to show as one change. Each action’s details show its own.";

function merged(first: FileChange, last: FileChange, file: Seen): FileChange {
  const { arrival } = file;
  if (first === last && !arrival) return first;
  // A file moving on takes its contents with it; they are shown where it is.
  if (last.change === "moved")
    return {
      path: last.path,
      change: "moved",
      ...(last.to !== undefined ? { to: last.to } : {}),
    };
  const left = first.change === "moved" ? first.to : undefined;
  if (
    last.change !== "recycled" &&
    last.change !== "deleted" &&
    (arrival || left !== undefined)
  )
    return movedHere(last, file.now, arrival, left);
  const created = first.change === "created";
  const kind =
    last.change === "recycled" || last.change === "deleted"
      ? last.change
      : created
        ? "created"
        : "updated";
  // A large file carries only each change’s own lines, and two of those do
  // not make the change from the first version to the last.
  if (first.diff || last.diff)
    return {
      path: last.path,
      change: kind,
      omitted: tooLargeTwice,
    };
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

/**
 * A file moved here, or one at a path a move left, as new at this path: from
 * what the turn found wherever it was to what it holds now, when both are
 * known.
 */
function movedHere(
  last: FileChange,
  now: string | undefined,
  arrival: Arrival | undefined,
  left: string | undefined,
): FileChange {
  const ends = {
    path: last.path,
    change: "created" as const,
    ...(left !== undefined ? { to: left } : {}),
    ...(arrival ? { from: arrival.from } : {}),
  };
  if (last.omitted !== undefined || last.diff)
    return { ...ends, omitted: last.omitted ?? tooLargeTwice };
  const made = arrival?.made ?? true;
  const before = made ? undefined : arrival?.origin;
  if (now === undefined || (!made && before === undefined)) return ends;
  return { ...ends, ...(before !== undefined ? { before } : {}), after: now };
}

/**
 * Whether undo could put this file back: a copy exists, or the turn created
 * it, a command too. The undo's own review says what each file comes to.
 */
export function undoable(file: TurnFile): boolean {
  if (!file.declared) return file.change.change === "created";
  return (
    !file.noCopy &&
    (file.change.change === "created" ||
      file.change.change === "updated" ||
      file.change.change === "moved")
  );
}
