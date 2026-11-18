/**
 * Putting back the files a review found recoverable. A review can come back
 * from the rewind journal on disk, so where each target writes and what it
 * copies from are checked again, and every file is checked against what the
 * review expected just before it is touched.
 */

import type { RewindCommitResult } from "@zhiyin/contract";
import { staysInside } from "@zhiyin/workspace-containment";
import {
  DamagedCopyError,
  recreateExclusively,
  restoreExclusively,
} from "./exclusive-restore.js";
import type { RecoveryReview, RestoreTarget } from "./review.js";
import { currentDigest, safeAbsolute } from "./workspace-files.js";

/** Whether a target writes inside its folder and copies from the store in `storeRoot`. */
async function ownTarget(
  storeRoot: string,
  workspaceRoot: string,
  target: RestoreTarget,
): Promise<boolean> {
  const absolute = await safeAbsolute(workspaceRoot, target.path).catch(
    () => undefined,
  );
  return (
    absolute === target.absolute &&
    (target.backup === undefined || staysInside(storeRoot, target.backup))
  );
}

async function restoreTarget(target: RestoreTarget): Promise<void> {
  if (target.expected === "absent") {
    if (target.action !== "restore" || !target.backup)
      throw new Error("The retained bytes are unavailable.");
    return recreateExclusively({
      absolute: target.absolute,
      backup: target.backup,
      retained: target.restored,
    });
  }
  await restoreExclusively({
    absolute: target.absolute,
    expected: target.expected,
    action: target.action,
    ...(target.backup
      ? { backup: target.backup, retained: target.restored }
      : {}),
  });
}

/** Restores a review's files, copying only from the store in `storeRoot`. */
export async function restoreReview(
  storeRoot: string,
  review: RecoveryReview,
): Promise<RewindCommitResult> {
  const results: RewindCommitResult["files"][number][] = [];
  for (const file of review.files) {
    if (file.status !== "recoverable") {
      results.push({
        path: file.path,
        status: file.status,
        ...(file.reason ? { reason: file.reason } : {}),
      });
      continue;
    }
    const target = review.targets.find((item) => item.path === file.path);
    if (target && !(await ownTarget(storeRoot, review.workspaceRoot, target))) {
      results.push({
        path: file.path,
        status: "unprotected",
        reason:
          "The restore named a file outside its folder or a copy Zhiyin did not keep, so the file was left as it is.",
      });
      continue;
    }
    const current = target ? await currentDigest(target.absolute) : "other";
    if (target && current === target.restored) {
      results.push({
        path: file.path,
        status: target.action === "remove" ? "removed" : "restored",
      });
      continue;
    }
    if (!target || current !== target.expected) {
      results.push({
        path: file.path,
        status: "conflict",
        reason: "The file changed while the rewind was being reviewed.",
      });
      continue;
    }
    try {
      await restoreTarget(target);
      results.push({
        path: file.path,
        status: target.action === "remove" ? "removed" : "restored",
      });
    } catch (error) {
      results.push({
        path: file.path,
        status: "unprotected",
        reason:
          error instanceof DamagedCopyError
            ? "The copy kept before the change is damaged, so the current file was left as it is."
            : "The retained bytes could not be applied; the current file was left in place.",
      });
    }
  }
  return { files: results };
}
