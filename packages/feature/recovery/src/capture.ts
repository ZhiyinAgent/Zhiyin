/**
 * What a copy of a declared change holds, file by file: the bytes and digest
 * of each file before approval, whether each is still that just before the
 * change runs, and what the change left behind. What a shell command created
 * or changed is known the same way, by what it left.
 */

import { copyFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CommandFileChange, FileChange } from "@zhiyin/contract";
import type { CapturedFile, Manifest } from "./records.js";
import { sizeOf } from "./run-changes.js";
import type { RecoveryLimits } from "./storage-limits.js";
import {
  currentDigest,
  fileDigest,
  kind,
  safeAbsolute,
  unreadable,
} from "./workspace-files.js";

/** The bytes of the copies a manifest keeps. */
export function protectedBytes(manifest: Manifest): number {
  return manifest.files.reduce(
    (sum, file) => sum + (file.status === "protected" ? (file.bytes ?? 0) : 0),
    0,
  );
}

/**
 * Copies into `folder` each file the changes would overwrite in `root`,
 * within the limits, counting `capturedBytes` already kept for actions
 * awaiting their run, and says of each path whether it is protected.
 */
export async function captureFiles(
  root: string,
  changes: readonly FileChange[],
  folder: string,
  limits: RecoveryLimits,
  capturedBytes: number,
): Promise<CapturedFile[]> {
  const files: CapturedFile[] = [];
  let captured = capturedBytes;
  for (const [index, change] of changes.entries()) {
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
    const info = await stat(absolute);
    if (
      info.size > limits.fileBytes ||
      captured + info.size > limits.totalBytes
    ) {
      files.push({
        path: normalized,
        status: "unprotected",
        before: "file",
        tooLarge: true,
        reason:
          info.size > limits.fileBytes
            ? `The existing file exceeds the ${sizeOf(limits.fileBytes)} recovery limit.`
            : "The recovery storage limit cannot admit this file.",
      });
      continue;
    }
    // The copy is read for its digest, so the digest is of what was kept.
    const backup = `${index}.bin`;
    await copyFile(absolute, join(folder, backup));
    const bytes = (await stat(join(folder, backup))).size;
    captured += bytes;
    files.push({
      path: normalized,
      status: "protected",
      before: "file",
      beforeDigest: await fileDigest(join(folder, backup)),
      backup,
      bytes,
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
      current = await currentDigest(absolute);
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
    const current = absolute ? await currentDigest(absolute) : "other";
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
    if ((await stat(absolute)).size > fileBytes) continue;
    files.push({
      path: normalized,
      status: "protected",
      before: change.change === "created" ? "absent" : "unknown",
      after: "file",
      afterDigest: await fileDigest(absolute),
    });
  }
  return files;
}
