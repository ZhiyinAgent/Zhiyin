/**
 * Where a recorded path lies on disk, and what it holds now: what capturing,
 * reviewing and restoring each check a file against before they trust it.
 *
 * A junction or a symbolic link is never followed. A link in the folder is
 * known by what it names, as `link:` with its kind and target, in place of a
 * digest of contents, and nothing it leads to is read; a path with a link
 * among the folders on its way names nothing that is read or written. Each
 * file read is opened first, then checked to be the file its path names
 * through real folders only, so a folder swapped for a link meanwhile is
 * caught.
 */

import { createHash } from "node:crypto";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { realStaysInside, staysInside } from "@zhiyin/workspace-containment";
import { linkAt } from "@zhiyin/workspace-listing";

export function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** What stands for a junction or symbolic link where a digest of contents would. */
export const linkDigest = (link: string) => `link:${link}`;

/** Whether a digest names a link, rather than contents. */
export const isLinkDigest = (value: string | undefined): value is string =>
  value?.startsWith("link:") === true;

/** A file read by its path through a link, or swapped for another as it was opened. */
export class ThroughLinkError extends Error {
  constructor() {
    super(
      "A junction or symbolic link is on its way, and a link is never followed.",
    );
    this.name = "ThroughLinkError";
  }
}

/**
 * Whether a junction or symbolic link lies among the folders between `root`
 * and `full`, or is `full` itself with `itself`. A path outside `root` is
 * looked at from its drive's root. Nothing there yet has nothing to follow.
 */
export async function linkOnPath(
  root: string,
  full: string,
  itself = false,
): Promise<boolean> {
  const base = staysInside(root, full) ? root : parse(full).root;
  const parts = relative(base, full).split(/[\\/]/).filter(Boolean);
  let at = base;
  for (const [index, part] of parts.entries()) {
    if (index === parts.length - 1 && !itself) break;
    at = join(at, part);
    const entry = await lstat(at).catch(() => undefined);
    if (!entry) return false;
    if (entry.isSymbolicLink()) return true;
  }
  return false;
}

/**
 * Whether `file`, opened by `full`, is the file `full` names now, reached
 * from `root` through real folders only: no link on the way or as itself,
 * and the same file on the same drive.
 */
export async function openedThroughNoLink(
  root: string,
  full: string,
  file: FileHandle,
): Promise<boolean> {
  if (await linkOnPath(root, full, true)) return false;
  const [opened, named] = await Promise.all([
    file.stat({ bigint: true }),
    lstat(full, { bigint: true }).catch(() => undefined),
  ]);
  return (
    named !== undefined &&
    named.isFile() &&
    opened.ino === named.ino &&
    opened.dev === named.dev
  );
}

/**
 * The SHA-256 of what the file at `full` in `root` holds, read in pieces so a
 * large one fits, from the file opened and checked to be reached through no
 * link. Throws `ThroughLinkError` otherwise.
 */
export async function fileDigest(root: string, full: string): Promise<string> {
  const file = await open(full, "r");
  try {
    if (!(await openedThroughNoLink(root, full, file)))
      throw new ThroughLinkError();
    const hash = createHash("sha256");
    for await (const chunk of file.createReadStream({ autoClose: false }))
      hash.update(chunk as Buffer);
    return hash.digest("hex");
  } finally {
    await file.close();
  }
}

/**
 * What the file at `full` in `root` holds, read from the file opened and
 * checked to be reached through no link. Throws `ThroughLinkError` otherwise.
 */
export async function fileBytes(root: string, full: string): Promise<Buffer> {
  const file = await open(full, "r");
  try {
    if (!(await openedThroughNoLink(root, full, file)))
      throw new ThroughLinkError();
    return await file.readFile();
  } finally {
    await file.close();
  }
}

export async function kind(path: string): Promise<"file" | "absent" | "other"> {
  try {
    const entry = await lstat(path);
    return entry.isFile() ? "file" : "other";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? "absent"
      : "other";
  }
}

/**
 * What the entry at `full` in `root` holds now: a file's digest, a link's
 * `link:` name, `absent`, or `other` for anything else, a folder, or a path
 * with a link on its way.
 */
export async function currentDigest(
  root: string,
  full: string,
): Promise<"absent" | "other" | string> {
  if (await linkOnPath(root, full)) return "other";
  const entry = await lstat(full).catch((error: unknown) =>
    (error as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : undefined,
  );
  if (entry === "absent") return "absent";
  if (!entry) return "other";
  if (entry.isSymbolicLink()) {
    const link = await linkAt(full);
    return link === undefined ? "other" : linkDigest(link);
  }
  if (!entry.isFile()) return "other";
  return fileDigest(root, full).catch((error: unknown) => {
    if (error instanceof ThroughLinkError) return "other";
    // Gone, or its folder moved, since it was looked at.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
    throw error;
  });
}

async function nearestExistingParent(path: string): Promise<string> {
  let candidate = dirname(path);
  while (true) {
    try {
      return await realpath(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
}

/**
 * Why a path could not be looked at. Windows refusing access says so; it is
 * not evidence that the path left the workspace, and is never reported as that.
 */
export function unreadable(path: string, error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EACCES" || code === "EPERM"
    ? `Windows denied access to ${path}.`
    : `${path} could not be read.`;
}

/**
 * A file outside the workspace that a person approved writing, named by the
 * real path the tool declared: kept, and put back, only while that path still
 * leads to itself, through no link.
 */
async function outsideTarget(target: string): Promise<string | undefined> {
  const entry = await kind(target);
  if (entry === "absent")
    return realStaysInside(await nearestExistingParent(target), target)
      ? target
      : undefined;
  return (await realpath(target)) === target ? target : undefined;
}

/**
 * The full path of a recorded path in `root`, only while it stays inside it
 * through real folders, with no junction or symbolic link on its way; the
 * entry itself may be a link, which is looked at and never followed. Or of
 * a file outside it by the whole real path a change was approved by.
 * Nothing otherwise.
 */
export async function safeAbsolute(
  root: string,
  path: string,
): Promise<string | undefined> {
  const target = resolve(root, path);
  if (isAbsolute(path) && !staysInside(root, target))
    return outsideTarget(target);
  if (!staysInside(root, target)) return;
  // Denied access is reported as that by the caller; only a missing folder
  // holds nothing to protect.
  const realRoot = await realpath(root).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
  if (realRoot === undefined) return;
  return (await linkOnPath(root, target)) ? undefined : target;
}
