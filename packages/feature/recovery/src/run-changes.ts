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
import { fileDigest } from "./workspace-files.js";

/** Files named on one action; the rest are counted. */
const namedOnAction = 200;
const mib = 1024 * 1024;

/** A file as a copy found it, with its copy's digest when it was copied. */
export type Known = ListedFile & { readonly digest?: string };

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
  bytes % mib === 0 ? `${bytes / mib} MiB` : `${bytes} byte`;

/** Whether a file now is other than a copy found it. */
function differs(now: ListedFile | undefined, then: Known | undefined) {
  if (!now || !then) return now !== then;
  return now.size !== then.size || now.modified !== then.modified;
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
  readonly fileBytes: number;
}): Promise<{
  readonly files: readonly CapturedFile[];
  readonly shown: CommandFileChanges;
}> {
  const { run, uncopied, current, later, fileBytes } = options;
  const limit = sizeOf(fileBytes);
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
    if (before && after && !differs(after, before)) continue;
    // What the file held then: known from the later copy, or read now.
    const afterDigest = !after
      ? undefined
      : claimed
        ? after.digest
        : after.size > fileBytes
          ? undefined
          : await fileDigest(join(run.root, path)).catch(() => undefined);
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
              reason: `The file the run made is larger than the ${limit} recovery limit, so it is left in place.`,
            },
      );
      continue;
    }
    if (!after) {
      shown.push({ path, change: "deleted" });
      files.push(
        before.digest
          ? {
              path,
              status: "protected",
              before: "file",
              beforeDigest: before.digest,
              content: before.digest,
              bytes: before.size,
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
    shown.push({ path, change: "updated" });
    files.push(
      before.digest && afterDigest
        ? {
            path,
            status: "protected",
            before: "file",
            beforeDigest: before.digest,
            content: before.digest,
            bytes: before.size,
            after: "file",
            afterDigest,
          }
        : {
            path,
            status: "unprotected",
            before: "unknown",
            reason:
              uncopied.get(path) ??
              `The file the run left is larger than the ${limit} recovery limit, or was not copied, so it cannot be checked before it is put back.`,
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
