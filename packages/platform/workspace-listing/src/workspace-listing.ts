/**
 * What a shell command changed in its folder, found by listing the folder
 * before and after it runs and comparing each file's size and time of last
 * change.
 *
 * A command says nothing about the files it touches, and reading its text
 * finds only the few it names. A listing finds the rest, but only by name: no
 * copy was taken, so nothing here can be shown, and only a file the same
 * turns created can be undone, by removing it. It sees what
 * anything else changed in the folder while the command ran, and misses a
 * change that kept both the size and the time. The listing chooses files as
 * searches do, hidden files included: the folders searches skip and the files
 * the workspace's ignore files list are left out here too.
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  CommandFileChange,
  CommandFileChanges,
  ListingPart,
  WorkspaceListing,
} from "@zhiyin/contract";
import { walkFolder } from "./folder-walk.js";
import {
  byPath,
  printedPath,
  ripgrep,
  selection,
  type RipgrepContext,
} from "./ripgrep.js";

/**
 * The most files a folder may hold for commands to be checked. Listing 20,000
 * files and reading each one's size and time measures about 200 ms on a local
 * SSD, and a command is listed twice.
 */
export const defaultCheckedUpTo = 20_000;
/** Files named on one action; the rest are counted. */
export const defaultFilesKept = 200;

export type ListingSetup = {
  /** How to run ripgrep; absent, nothing can be listed. */
  readonly search: RipgrepContext | undefined;
  readonly upTo: number;
  readonly kept: number;
};

/** A file listed: its size, time of last change, and identity on its volume. */
type Entry = {
  readonly size: number;
  readonly modified: number;
  readonly id: string;
};
type Listing = WorkspaceListing;

const unlisted = "Zhiyin could not list this folder's files.";

/** Files whose size and time are read at once while a folder is listed. */
const readAtOnce = 64;

/**
 * The folder's files with their size and time of last change, or why not.
 * A copy taken before a run lists what Git ignores too: that is often the
 * data a script works on. The folders an install or a build makes again, and
 * Git's own, stay out either way. `all` lists every file however many there
 * are, walking the folder itself, as keeping each file as a turn found it
 * needs: what the ignore files list is in, a junction or symbolic link is
 * listed as one and never followed, each folder comes with its identity, and
 * `part` lists only part of the folder. Otherwise a folder past the setup's
 * bound is not listed, and each file's size and time is read as ripgrep
 * names it, a few at once.
 */
export async function listFiles(
  files: ListingSetup,
  root: string,
  {
    ignored = false,
    all = false,
    part,
  }: {
    readonly ignored?: boolean;
    readonly all?: boolean;
    readonly part?: ListingPart;
  } = {},
): Promise<Listing> {
  if (all) return walkFolder(root, part);
  if (!files.search) return { ok: false, reason: unlisted };
  const upTo = files.upTo;
  const tooMany = {
    ok: false,
    reason: `This folder has more than ${files.upTo.toLocaleString("en-US")} files, too many to check what commands change.`,
  } as const;
  const listed = new Map<string, Entry>();
  let named = 0;
  const reading = new Set<Promise<void>>();
  const read = (path: string) => {
    const one = stat(join(root, path), { bigint: true })
      .then(
        (found) => {
          listed.set(path, {
            size: Number(found.size),
            modified: Number(found.mtimeNs) / 1e6,
            id: String(found.ino),
          });
        },
        // A file gone between the listing and this is gone from the listing.
        () => undefined,
      )
      .finally(() => reading.delete(one));
    reading.add(one);
  };
  const run = await ripgrep({
    ...files.search,
    // Hidden files are a person's files like any other, and a command often
    // makes them; the folders a search skips, `.git` among them, stay out.
    args: [
      "--files",
      "--hidden",
      ...selection(false),
      ...(ignored ? ["--no-ignore"] : []),
    ],
    cwd: root,
    // No path is a kilobyte long, so a listing this size is past the bound.
    maximumOutputBytes: files.upTo * 1024,
    line: async (text) => {
      named += 1;
      if (named > upTo) return;
      read(printedPath(text));
      if (reading.size >= readAtOnce) await Promise.race(reading);
    },
  }).catch(() => undefined);
  await Promise.all(reading);
  if (named > upTo) return tooMany;
  // ripgrep answers 1 when the folder has no files, and 2 when it could not
  // read some of them: what it could read is still a listing.
  if (!run?.complete || (run.exitCode ?? 2) > 2)
    return { ok: false, reason: unlisted };
  return { ok: true, files: listed };
}

/** The difference between two listings of one folder. */
export function compareListings(
  before: Listing,
  after: Listing,
  kept: number,
): CommandFileChanges {
  if (!before.ok) return { status: "unchecked", reason: before.reason };
  if (!after.ok) return { status: "unchecked", reason: after.reason };
  const changed: CommandFileChange[] = [];
  for (const [path, entry] of after.files) {
    const earlier = before.files.get(path);
    if (!earlier) changed.push({ path, change: "created" });
    else if (earlier.size !== entry.size || earlier.modified !== entry.modified)
      changed.push({ path, change: "updated" });
  }
  for (const path of before.files.keys())
    if (!after.files.has(path)) changed.push({ path, change: "deleted" });
  changed.sort((left, right) => byPath(left.path, right.path));
  return {
    status: "checked",
    files: changed.slice(0, kept),
    ...(changed.length > kept ? { more: changed.length - kept } : {}),
  };
}
