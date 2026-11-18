/**
 * Where a recorded path lies on disk, and what it holds now: what capturing,
 * reviewing and restoring each check a file against before they trust it.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { realStaysInside, staysInside } from "@zhiyin/workspace-containment";

export function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The SHA-256 of what a file holds, read in pieces so a large one fits. */
export async function fileDigest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path))
    hash.update(chunk as Buffer);
  return hash.digest("hex");
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

export async function currentDigest(
  path: string,
): Promise<"absent" | "other" | string> {
  const entry = await kind(path);
  if (entry !== "file") return entry;
  return fileDigest(path);
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
 * The full path of a recorded path in `root`, only while it stays inside it,
 * through any link; or of a file outside it by the whole real path a change
 * was approved by. Nothing otherwise.
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
  const entry = await kind(target);
  const resolved =
    entry === "absent"
      ? await nearestExistingParent(target)
      : await realpath(target);
  return realStaysInside(realRoot, resolved) ? target : undefined;
}
