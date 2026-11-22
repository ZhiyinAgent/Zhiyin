/**
 * What one program changed in its folder, against the copy taken before it
 * ran: each file it created, changed or deleted, as the store records it and
 * as an action shows it.
 *
 * Programs in one folder can overlap, as a shell command that carries on as a
 * job does while later turns run. A file a later run copied and then changed
 * is that run's: the earlier program is credited only with what the file held
 * when the later run copied it. A later run still going claims a file that
 * changed since its copy the same way. So going back on the earlier turn
 * never puts back what a later one did.
 */

import { join } from "node:path";
import type {
  CommandFileChange,
  CommandFileChanges,
  ListedFile,
} from "@zhiyin/contract";
import type { CapturedFile } from "./records.js";
import { fileDigest, isLinkDigest, linkDigest } from "./workspace-files.js";

/** Files named on one action; the rest are counted. */
const namedOnAction = 200;
const mib = 1024 * 1024;

/**
 * A file as a copy found it, with its digest when that is known. `watched`:
 * not saved yet, and saved as it is first written; `unstored`: its digest is
 * known, as a run of the same turn left it, but the store holds no copy,
 * since a turn keeps a file only as the turn found it (ADR 0031); `turn`, for
 * such a file, is the turn that was.
 */
export type Known = ListedFile & {
  readonly digest?: string;
  readonly watched?: true;
  readonly unstored?: true;
  readonly turn?: number;
  /** For a file changed since its turn began: the version the turn found, saved at its first write. */
  readonly turnStart?: { readonly digest: string; readonly bytes: number };
};

/** A copy of a folder taken before a run, and what that run then recorded. */
export type RunCopy = {
  readonly root: string;
  /** When the copy was taken, in the order copies were taken. */
  readonly seq: number;
  readonly files: ReadonlyMap<string, Known>;
  /** The paths it recorded as changed, once it ended; absent while it runs. */
  readonly recorded?: ReadonlySet<string>;
};

/** A limit as a person reads it. */
export const sizeOf = (bytes: number) =>
  bytes >= 1024 * mib
    ? `${(bytes / (1024 * mib)).toFixed(1)} GiB`
    : bytes % mib === 0
      ? `${bytes / mib} MiB`
      : bytes >= mib
        ? `${(bytes / mib).toFixed(1)} MiB`
        : `${bytes} bytes`;

/**
 * Whether what the run found can be put back: a link, by what it names, or a
 * file whose bytes the store holds, as the run's copy or as its turn found
 * it. A file known only by its digest has none.
 */
function savedBefore(before: Known): boolean {
  if (isLinkDigest(before.digest)) return true;
  return !before.unstored || before.turnStart !== undefined;
}

/** Whether a file now is other than a copy found it. */
function differs(now: ListedFile | undefined, then: Known | undefined) {
  if (!now || !then) return now !== then;
  return (
    now.size !== then.size ||
    now.modified !== then.modified ||
    now.link !== then.link
  );
}

export async function runChanges(options: {
  readonly run: RunCopy;
  /** Why each file of the run's copy was not copied. */
  readonly uncopied: ReadonlyMap<string, string>;
  /** The folder's files now; those of the copy alone when it could not be listed. */
  readonly current: ReadonlyMap<string, ListedFile>;
  /** Why the folder could not be listed after the run, when it could not. */
  readonly unlisted?: string;
  /** Copies of the same folder taken after this run's. */
  readonly later: readonly RunCopy[];
  /**
   * The files the drive's change journal says were written since the run's
   * copy, whatever their size and time say.
   */
  readonly written?: ReadonlySet<string>;
}): Promise<{
  readonly files: readonly CapturedFile[];
  readonly shown: CommandFileChanges;
}> {
  const { run, uncopied, current, later } = options;
  const written = options.written ?? new Set<string>();
  /**
   * What the store holds of the file before the run: a copy, or for a file
   * changed since its turn began, the file as the turn found it, or only its
   * digest.
   */
  const kept = (before: Known) =>
    isLinkDigest(before.digest)
      ? {}
      : !before.unstored
        ? { content: before.digest!, bytes: before.size }
        : before.turnStart
          ? {
              content: before.turnStart.digest,
              bytes: before.turnStart.bytes,
              turnStart: true as const,
            }
          : { linkOnly: true as const };
  const ordered = [...later].sort((a, b) => a.seq - b.seq);
  const files: CapturedFile[] = [];
  const shown: CommandFileChange[] = [];
  const paths = [...new Set([...current.keys(), ...run.files.keys()])].sort();
  for (const path of paths) {
    const before = run.files.get(path);
    const now = current.get(path);
    // A later run's file from when it copied it, when the file is that run's.
    const claimed = ordered.find((copy) =>
      copy.recorded
        ? copy.recorded.has(path)
        : differs(now, copy.files.get(path)),
    );
    const after: Known | undefined = claimed ? claimed.files.get(path) : now;
    if (!before && !after) continue;
    if (
      before &&
      after &&
      !differs(after, before) &&
      (claimed || !written.has(path))
    )
      continue;
    // What the file held then: known from the later copy, or read now.
    // A link is known by what it names; nothing it leads to is read.
    const afterDigest = !after
      ? undefined
      : claimed
        ? after.digest
        : after.link !== undefined
          ? linkDigest(after.link)
          : await fileDigest(run.root, join(run.root, path)).catch(
              () => undefined,
            );
    if (!before) {
      shown.push({ path, change: "created" });
      files.push(
        afterDigest
          ? {
              path,
              status: "protected",
              before: "absent",
              after: "file",
              afterDigest,
            }
          : {
              path,
              status: "unprotected",
              before: "absent",
              reason:
                "The file the run made could not be read, so it is left in place.",
            },
      );
      continue;
    }
    if (!after) {
      shown.push({
        path,
        change: "deleted",
        ...(before.digest && savedBefore(before) ? { kept: true } : {}),
      });
      files.push(
        before.digest
          ? {
              path,
              status: "protected",
              before: "file",
              beforeDigest: before.digest,
              ...kept(before),
              after: "absent",
            }
          : {
              path,
              status: "unprotected",
              before: "unknown",
              reason:
                uncopied.get(path) ?? "No copy of it was taken before the run.",
            },
      );
      continue;
    }
    // Touched, its contents as they were.
    if (afterDigest && afterDigest === before.digest) continue;
    shown.push({
      path,
      change: "updated",
      ...(before.digest && afterDigest && savedBefore(before)
        ? { kept: true }
        : {}),
    });
    files.push(
      before.digest && afterDigest
        ? {
            path,
            status: "protected",
            before: "file",
            beforeDigest: before.digest,
            ...kept(before),
            after: "file",
            afterDigest,
          }
        : {
            path,
            status: "unprotected",
            before: "unknown",
            reason:
              uncopied.get(path) ??
              "The file was not saved before the run, or could not be read after it, so it cannot be checked before it is put back.",
          },
    );
  }
  return {
    files,
    shown: {
      status: "checked",
      files: shown.slice(0, namedOnAction),
      ...(shown.length > namedOnAction
        ? { more: shown.length - namedOnAction }
        : {}),
      ...(options.unlisted ? { unlisted: options.unlisted } : {}),
    },
  };
}

/**
 * What one program changed across the folders it was given, as its action
 * records and shows it: a workspace file by its path there, a file in a
 * folder outside it by its whole path. An action names as many files as one
 * folder's would, and counts the rest.
 */
export function joinedChanges(
  copies: readonly {
    readonly root: string;
    readonly outside: boolean;
    readonly files: readonly CapturedFile[];
    readonly shown: CommandFileChanges;
  }[],
): { readonly files: CapturedFile[]; readonly shown: CommandFileChanges } {
  const files: CapturedFile[] = [];
  const shown: CommandFileChange[] = [];
  let more = 0;
  const unlisted: string[] = [];
  for (const copy of copies) {
    const whole = (path: string) =>
      copy.outside ? join(copy.root, path) : path;
    for (const file of copy.files)
      files.push({ ...file, path: whole(file.path).replaceAll("\\", "/") });
    if (copy.shown.status !== "checked") continue;
    for (const file of copy.shown.files)
      shown.push({ ...file, path: whole(file.path) });
    more += copy.shown.more ?? 0;
    if (copy.shown.unlisted)
      unlisted.push(
        copy.outside
          ? `In ${copy.root}: ${copy.shown.unlisted}`
          : copy.shown.unlisted,
      );
  }
  more += Math.max(0, shown.length - namedOnAction);
  return {
    files,
    shown: {
      status: "checked",
      files: shown.slice(0, namedOnAction),
      ...(more ? { more } : {}),
      ...(unlisted.length ? { unlisted: unlisted.join(" ") } : {}),
    },
  };
}
