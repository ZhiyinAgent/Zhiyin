/**
 * What a shell command changed in its folder, found by listing the folder
 * before and after it runs and comparing each file's size and time of last
 * change.
 *
 * A command says nothing about the files it touches, and reading its text
 * finds only the few it names. A listing finds the rest, but only by name: no
 * copy was taken, so nothing here can be shown or put back. It sees what
 * anything else changed in the folder while the command ran, and misses a
 * change that kept both the size and the time. The listing is the one searches
 * use, so the folders they leave out are left out here too.
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { CommandFileChange, CommandFileChanges } from "@zhiyin/contract";
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

export type CommandFiles = {
  /** How to run ripgrep; absent, nothing can be listed. */
  readonly search: RipgrepContext | undefined;
  readonly upTo: number;
  readonly kept: number;
};

type Entry = { readonly size: number; readonly modified: number };
type Listing =
  | { readonly ok: true; readonly files: ReadonlyMap<string, Entry> }
  | { readonly ok: false; readonly reason: string };

const unlisted = "Zhiyin could not list this folder's files.";

/** The folder's files with their size and time of last change, or why not. */
export async function listFiles(
  files: CommandFiles,
  root: string,
): Promise<Listing> {
  if (!files.search) return { ok: false, reason: unlisted };
  const tooMany = {
    ok: false,
    reason: `This folder has more than ${files.upTo.toLocaleString("en-US")} files, too many to check what commands change.`,
  } as const;
  const paths: string[] = [];
  const run = await ripgrep({
    ...files.search,
    args: ["--files", ...selection(false)],
    cwd: root,
    // No path is a kilobyte long, so a listing this size is past the bound.
    maximumOutputBytes: files.upTo * 1024,
    line: (text) => paths.push(printedPath(text)),
  }).catch(() => undefined);
  if (paths.length > files.upTo) return tooMany;
  // ripgrep answers 1 when the folder has no files, and 2 when it could not
  // read some of them: what it could read is still a listing.
  if (!run?.complete || (run.exitCode ?? 2) > 2)
    return { ok: false, reason: unlisted };
  const listed = new Map<string, Entry>();
  for (let start = 0; start < paths.length; start += 64)
    await Promise.all(
      paths.slice(start, start + 64).map(async (path) => {
        // A file gone between the listing and this is gone from the listing.
        const found = await stat(join(root, path)).catch(() => undefined);
        if (found)
          listed.set(path, { size: found.size, modified: found.mtimeMs });
      }),
    );
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
