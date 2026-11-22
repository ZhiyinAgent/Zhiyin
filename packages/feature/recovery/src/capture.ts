/**
 * What a copy of a declared change holds, file by file: the bytes and digest
 * of each file before approval, whether each is still that just before the
 * change runs, and what the change left behind. What a shell command created
 * or changed is known the same way, by what it left.
 */

import { lstat } from "node:fs/promises";
import type { CommandFileChange, FileChange } from "@zhiyin/contract";
import { alternateStreams } from "@zhiyin/file-watch";
import type { PieceStore } from "./pieces/piece-store.js";
import type { CapturedFile, Manifest } from "./records.js";
import { sizeOf } from "./run-changes.js";
import {
  currentDigest,
  fileDigest,
  kind,
  openedThroughNoLink,
  safeAbsolute,
  ThroughLinkError,
  unreadable,
} from "./workspace-files.js";

/**
 * Keeps each file the changes would overwrite in `root` in the store of
 * pieces, within the `room` the undo budget leaves, and says of each path
 * whether it is protected. `kept` hears each version as it is kept, before
 * any record names it.
 */
export async function captureFiles(
  root: string,
  changes: readonly FileChange[],
  {
    room,
    pieces,
    kept: heard,
  }: {
    readonly room: number;
    readonly pieces: PieceStore;
    readonly kept: (digest: string) => void;
  },
): Promise<CapturedFile[]> {
  const files: CapturedFile[] = [];
  let left = room;
  for (const change of changes) {
    const normalized = change.path.replaceAll("\\", "/");
    let absolute: string | undefined;
    let failure: string | undefined;
    try {
      absolute = await safeAbsolute(root, normalized);
    } catch (error) {
      failure = unreadable(normalized, error);
    }
    if (!absolute) {
      files.push({
        path: normalized,
        status: "unprotected",
        before: "absent",
        reason:
          failure ??
          "The path could not be proven to stay inside the workspace.",
      });
      continue;
    }
    const entry = await kind(absolute);
    if (entry === "other") {
      files.push({
        path: normalized,
        status: "unprotected",
        before: "absent",
        reason: "The path is not an ordinary file.",
      });
      continue;
    }
    if (entry === "absent") {
      files.push({ path: normalized, status: "protected", before: "absent" });
      continue;
    }
    const info = await lstat(absolute);
    if (info.size > left) {
      files.push({
        path: normalized,
        status: "unprotected",
        before: "file",
        tooLarge: true,
        reason: `The undo budget has room for ${sizeOf(Math.max(0, left))} more, too little to keep this file first.`,
      });
      continue;
    }
    // The digest is of what was read into the store, so of what was kept.
    const full = absolute;
    const kept = await pieces.put(full, {
      streams: alternateStreams(full),
      opened: (file) => openedThroughNoLink(root, full, file),
    });
    heard(kept.digest);
    left -= kept.bytes;
    files.push({
      path: normalized,
      status: "protected",
      before: "file",
      beforeDigest: kept.digest,
      content: kept.digest,
      bytes: kept.bytes,
    });
  }
  return files;
}

/** Whether each protected file of a prepared capture is still what was copied. */
export async function stillAsCaptured(
  manifest: Manifest,
): Promise<
  { readonly ok: true } | { readonly ok: false; readonly reason: string }
> {
  for (const file of manifest.files) {
    if (file.status !== "protected") continue;
    let current: Awaited<ReturnType<typeof currentDigest>>;
    try {
      const absolute = await safeAbsolute(manifest.workspaceRoot, file.path);
      if (!absolute)
        return {
          ok: false,
          reason: `${file.path} is no longer safely inside the workspace.`,
        };
      current = await currentDigest(manifest.workspaceRoot, absolute);
    } catch (error) {
      return { ok: false, reason: unreadable(file.path, error) };
    }
    const expected = file.before === "absent" ? "absent" : file.beforeDigest;
    if (current !== expected)
      return {
        ok: false,
        reason: `${file.path} changed after this change was proposed.`,
      };
  }
  return { ok: true };
}

/** A capture's files with what the change left behind of each. */
export async function leftBehind(manifest: Manifest): Promise<CapturedFile[]> {
  const files: CapturedFile[] = [];
  for (const file of manifest.files) {
    if (file.status !== "protected") {
      files.push(file);
      continue;
    }
    const absolute = await safeAbsolute(
      manifest.workspaceRoot,
      file.path,
    ).catch(() => undefined);
    const current = absolute
      ? await currentDigest(manifest.workspaceRoot, absolute)
      : "other";
    files.push({
      ...file,
      after: current === "absent" ? "absent" : "file",
      ...(current !== "absent" && current !== "other"
        ? { afterDigest: current }
        : {}),
      ...(current === "other"
        ? {
            status: "unprotected" as const,
            reason: "The result is not an ordinary workspace file.",
          }
        : {}),
    });
  }
  return files;
}

/**
 * The files a shell command created or changed in `root`, as it left them.
 * Reading a file to know it again is bounded as a copy is, by `fileBytes`.
 */
export async function commandFiles(
  root: string,
  changes: readonly CommandFileChange[],
  fileBytes: number,
): Promise<CapturedFile[]> {
  const files: CapturedFile[] = [];
  for (const change of changes) {
    if (change.change === "deleted") continue;
    const normalized = change.path.replaceAll("\\", "/");
    const absolute = await safeAbsolute(root, normalized).catch(
      () => undefined,
    );
    if (!absolute || (await kind(absolute)) !== "file") continue;
    if ((await lstat(absolute)).size > fileBytes) continue;
    const afterDigest = await fileDigest(root, absolute).catch(
      (error: unknown) => {
        if (error instanceof ThroughLinkError) return undefined;
        throw error;
      },
    );
    if (!afterDigest) continue;
    files.push({
      path: normalized,
      status: "protected",
      before: change.change === "created" ? "absent" : "unknown",
      after: "file",
      afterDigest,
    });
  }
  return files;
}
