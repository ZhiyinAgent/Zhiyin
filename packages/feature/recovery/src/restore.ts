/**
 * Putting back the files a review found recoverable. A review can come back
 * from the rewind journal on disk, so where each target writes and what it
 * copies from are checked again, and every file is checked against what the
 * review expected just before it is touched. The folders on each file's way
 * are held from that check until it is back, so none can be swapped for a
 * link that would lead the write elsewhere. Files that only work together
 * are put back all or none, each held while the others are checked.
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { rm, rmdir, symlink, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import type { RewindCommitResult } from "@zhiyin/contract";
import { staysInside } from "@zhiyin/workspace-containment";
import {
  DamagedCopyError,
  exclusiveRecovery,
  windowsRecoveryFiles,
  type GroupOutcome,
  type RecoveryFiles,
} from "./exclusive-restore.js";
import { holdFolders } from "./held-folders.js";
import { DamagedVersionError } from "./pieces/piece-store.js";
import {
  throughLinkReason,
  type RecoveryReview,
  type RestoreTarget,
} from "./review.js";
import {
  currentDigest,
  isLinkDigest,
  linkOnPath,
  safeAbsolute,
} from "./workspace-files.js";

type FileResult = RewindCommitResult["files"][number];

/** How a restore makes its Windows calls; a test may wrap them. */
export type RestoreCalls = (files: RecoveryFiles) => RecoveryFiles;

/**
 * Whether a target writes inside its folder, or at the whole real path a
 * change outside was approved by, and copies from the store in `storeRoot`.
 * A link on its way is the folders' hold's to refuse, as the write begins.
 */
async function ownTarget(
  storeRoot: string,
  workspaceRoot: string,
  target: RestoreTarget,
): Promise<boolean> {
  const named = resolve(workspaceRoot, target.path);
  const absolute = staysInside(workspaceRoot, named)
    ? existsSync(workspaceRoot)
      ? named
      : undefined
    : await safeAbsolute(workspaceRoot, target.path).catch(() => undefined);
  return (
    absolute === target.absolute &&
    (target.backup === undefined || staysInside(storeRoot, target.backup))
  );
}

/** Writes a version kept in the store of pieces to a file of the store's own, and answers where. */
export type Materialize = (digest: string) => Promise<{
  readonly path: string;
  /** Removes the file once it was put back. */
  done(): Promise<void>;
}>;

type Exclusive = ReturnType<typeof exclusiveRecovery>;

async function restoreTarget(
  exclusive: Exclusive,
  root: string,
  target: RestoreTarget,
  materialize: Materialize,
): Promise<void> {
  if (isLinkDigest(target.expected) || isLinkDigest(target.restored))
    return restoreAroundLink(exclusive, root, target, materialize);
  if (!target.content) return restoreBackup(exclusive, target);
  const written = await materialize(target.content);
  try {
    await restoreBackup(exclusive, { ...target, backup: written.path });
  } finally {
    await written.done();
  }
}

async function restoreBackup(
  exclusive: Exclusive,
  target: RestoreTarget,
): Promise<void> {
  if (target.expected === "absent") {
    if (target.action !== "restore" || !target.backup)
      throw new Error("The retained bytes are unavailable.");
    return exclusive.recreateExclusively({
      absolute: target.absolute,
      backup: target.backup,
      retained: target.restored,
    });
  }
  await exclusive.restoreExclusively({
    absolute: target.absolute,
    expected: target.expected,
    action: target.action,
    ...(target.backup
      ? { backup: target.backup, retained: target.restored }
      : {}),
  });
}

/** A link as it is recorded: its kind, then what it names. */
function linkParts(digest: string): {
  readonly kind: "junction" | "folder" | "file";
  readonly target: string;
} {
  const link = digest.slice("link:".length);
  const space = link.indexOf(" ");
  const kind = link.slice(0, space);
  return {
    kind: kind === "junction" || kind === "folder" ? kind : "file",
    target: link.slice(space + 1),
  };
}

/**
 * Puts back a change that made, removed or replaced a junction or a
 * symbolic link, never following one: a link goes back as a link, made
 * beside its place first, and a link taken away is removed itself, never
 * what it leads to. What is there now is taken away only while it is what
 * the review found.
 */
async function restoreAroundLink(
  exclusive: Exclusive,
  root: string,
  target: RestoreTarget,
  materialize: Materialize,
): Promise<void> {
  const { absolute } = target;
  let aside: string | undefined;
  let written: Awaited<ReturnType<Materialize>> | undefined;
  try {
    if (isLinkDigest(target.restored)) {
      const { kind, target: names } = linkParts(target.restored);
      aside = `${absolute}.${randomUUID().replaceAll("-", "")}.restore`;
      await symlink(
        names,
        aside,
        kind === "junction" ? "junction" : kind === "folder" ? "dir" : "file",
      );
    }
    if (isLinkDigest(target.expected)) {
      if ((await currentDigest(root, absolute)) !== target.expected)
        throw new Error("The link changed while recovery was being applied.");
      if (linkParts(target.expected).kind === "file") await unlink(absolute);
      else await rmdir(absolute);
    } else if (target.expected !== "absent")
      await exclusive.restoreExclusively({
        absolute,
        expected: target.expected,
        action: "remove",
      });
    if (aside) {
      if (!windowsRecoveryFiles().moveIntoPlace(aside, absolute))
        throw new Error("Something took the link's place.");
      aside = undefined;
    } else if (target.restored !== "absent") {
      let backup = target.backup;
      if (target.content) {
        written = await materialize(target.content);
        backup = written.path;
      }
      if (!backup) throw new Error("The retained bytes are unavailable.");
      await exclusive.recreateExclusively({
        absolute,
        backup,
        retained: target.restored,
      });
    }
  } finally {
    if (aside) await rm(aside, { force: true }).catch(() => undefined);
    await written?.done();
  }
}

/**
 * The files that only work together, which are put back all or none: a
 * SQLite database with its `-wal`, `-shm` and `-journal` files, and every
 * file of a zarr store, named by the store's folder.
 */
function workingTogether(path: string): string {
  const named = path.replaceAll("\\", "/");
  const zarr = /^(.*?\.zarr)(\/|$)/i.exec(named);
  if (zarr) return `zarr:${zarr[1]!.toLowerCase()}`;
  const database = /^(.*)-(wal|shm|journal)$/i.exec(named);
  return `file:${(database ? database[1]! : named).toLowerCase()}`;
}

const damagedCopy =
  "The copy kept before the change is damaged, so the current file was left as it is.";
const notApplied =
  "The retained bytes could not be applied; the current file was left in place.";
const notOwn =
  "The restore named a file outside its folder or a copy Zhiyin did not keep, so the file was left as it is.";
const changedSince = "The file changed while the rewind was being reviewed.";
const linkInGroup =
  "It is a junction or a symbolic link before or after the change, which is not put back together with the files that work with it.";

/**
 * Whether a link now stands on the target's way, among the folders between
 * the workspace and it, so writing there would follow it: always refused.
 */
async function throughLink(
  root: string,
  target: RestoreTarget,
): Promise<boolean> {
  return linkOnPath(root, target.absolute).catch(() => true);
}

/** Restores a review's files, copying only from the store in `storeRoot`. */
export async function restoreReview(
  storeRoot: string,
  review: RecoveryReview,
  materialize: Materialize,
  calls: RestoreCalls = (files) => files,
): Promise<RewindCommitResult> {
  const exclusive = exclusiveRecovery(() => calls(windowsRecoveryFiles()));
  const groups = new Map<string, RecoveryReview["files"][number][]>();
  for (const file of review.files) {
    const group = workingTogether(file.path);
    groups.set(group, [...(groups.get(group) ?? []), file]);
  }
  const results = new Map<string, FileResult>();
  for (const files of groups.values()) {
    const found =
      files.length > 1
        ? await restoreGroup(exclusive, storeRoot, review, files, materialize)
        : [
            await restoreOne(
              exclusive,
              storeRoot,
              review,
              files[0]!,
              materialize,
            ),
          ];
    for (const result of found) results.set(result.path, result);
  }
  return { files: review.files.map((file) => results.get(file.path)!) };
}

/** What a file the review did not find recoverable is reported as. */
function asReviewed(file: RecoveryReview["files"][number]): FileResult {
  return {
    path: file.path,
    status: file.status as FileResult["status"],
    ...(file.reason ? { reason: file.reason } : {}),
  };
}

const done = (target: RestoreTarget): FileResult["status"] =>
  target.action === "remove" ? "removed" : "restored";

async function restoreOne(
  exclusive: Exclusive,
  storeRoot: string,
  review: RecoveryReview,
  file: RecoveryReview["files"][number],
  materialize: Materialize,
): Promise<FileResult> {
  if (file.status !== "recoverable") return asReviewed(file);
  const target = review.targets.find((item) => item.path === file.path);
  if (target && (await throughLink(review.workspaceRoot, target)))
    return { path: file.path, status: "conflict", reason: throughLinkReason };
  if (target && !(await ownTarget(storeRoot, review.workspaceRoot, target)))
    return { path: file.path, status: "unprotected", reason: notOwn };
  if (!target)
    return { path: file.path, status: "conflict", reason: changedSince };
  // Held from here until it is back, so no folder on its way can be swapped
  // for a link between this check and the write.
  const held = await holdFolders(review.workspaceRoot, [target.absolute], () =>
    makesFolders(target),
  );
  if (!held.ok) return unheld(file.path, held.why);
  try {
    const current = await currentDigest(review.workspaceRoot, target.absolute);
    if (current === target.restored)
      return { path: file.path, status: done(target) };
    if (current !== target.expected)
      return { path: file.path, status: "conflict", reason: changedSince };
    try {
      await restoreTarget(exclusive, review.workspaceRoot, target, materialize);
      return { path: file.path, status: done(target) };
    } catch (error) {
      return {
        path: file.path,
        status: "unprotected",
        reason:
          error instanceof DamagedCopyError ||
          error instanceof DamagedVersionError
            ? damagedCopy
            : notApplied,
      };
    }
  } finally {
    held.release();
  }
}

/** Whether putting a target back makes the file, and so the folders it was in. */
const makesFolders = (target: RestoreTarget) =>
  target.expected === "absent" && target.restored !== "absent";

const heldElsewhere =
  "Another program was moving or removing a folder on the way to this file, so nothing was written there.";

/**
 * What a file is when the folders on its way could not be held: a link
 * came on its way, a folder of it is gone, or another program kept one.
 */
function unheld(path: string, why: "link" | "missing" | "busy"): FileResult {
  return {
    path,
    status: "conflict",
    reason:
      why === "link"
        ? throughLinkReason
        : why === "missing"
          ? changedSince
          : heldElsewhere,
  };
}

/**
 * Puts back a group's files all or none. A file of it that cannot be put
 * back keeps every other one as it is, each said to be left for that file.
 */
async function restoreGroup(
  exclusive: Exclusive,
  storeRoot: string,
  review: RecoveryReview,
  files: readonly RecoveryReview["files"][number][],
  materialize: Materialize,
): Promise<FileResult[]> {
  const leftFor = (path: string, why: string) =>
    `${path}, which works with it, ${why}, so none of them was put back.`;
  const results: FileResult[] = [];
  const refuse = (blocker: FileResult, why: string): FileResult[] =>
    files.map((file) =>
      file.path === blocker.path
        ? blocker
        : (results.find((result) => result.path === file.path) ??
          (file.status === "recoverable"
            ? {
                path: file.path,
                status: "conflict",
                reason: leftFor(blocker.path, why),
              }
            : asReviewed(file))),
    );
  const pending: RestoreTarget[] = [];
  for (const file of files) {
    if (file.status !== "recoverable")
      return refuse(asReviewed(file), "cannot be put back");
    const target = review.targets.find((item) => item.path === file.path);
    if (!target)
      return refuse(
        { path: file.path, status: "conflict", reason: changedSince },
        "changed since the review",
      );
    if (await throughLink(review.workspaceRoot, target))
      return refuse(
        { path: file.path, status: "conflict", reason: throughLinkReason },
        "has a junction or symbolic link on its way",
      );
    if (!(await ownTarget(storeRoot, review.workspaceRoot, target)))
      return refuse(
        { path: file.path, status: "unprotected", reason: notOwn },
        "cannot be put back",
      );
    // A link goes back by itself, never with the files it works with.
    if (isLinkDigest(target.expected) || isLinkDigest(target.restored))
      return refuse(
        { path: file.path, status: "unprotected", reason: linkInGroup },
        "cannot be put back with them",
      );
    const current = await currentDigest(review.workspaceRoot, target.absolute);
    // Already back, as when a restore cut short is finished.
    if (current === target.restored) {
      results.push({ path: file.path, status: done(target) });
      continue;
    }
    if (current !== target.expected)
      return refuse(
        { path: file.path, status: "conflict", reason: changedSince },
        "changed since the review",
      );
    pending.push(target);
  }
  if (!pending.length) return results;
  // Held until every one is back, so no folder on their way can be swapped
  // for a link before the files are checked again and written.
  const held = await holdFolders(
    review.workspaceRoot,
    pending.map((target) => target.absolute),
    (path) =>
      pending.some(
        (target) => target.absolute === path && makesFolders(target),
      ),
  );
  if (!held.ok)
    return refuse(
      unheld(pending[0]!.path, held.why),
      held.why === "link"
        ? "has a junction or symbolic link on its way"
        : held.why === "missing"
          ? "changed since the review"
          : "has a folder on its way another program was moving",
    );
  const written: { done(): Promise<void> }[] = [];
  let outcome: GroupOutcome;
  try {
    const members = [];
    for (const target of pending) {
      let backup = target.backup;
      if (target.content) {
        const made = await materialize(target.content).catch(
          (error: unknown) => {
            if (error instanceof DamagedVersionError) return undefined;
            throw error;
          },
        );
        if (!made)
          return refuse(
            { path: target.path, status: "unprotected", reason: damagedCopy },
            "has a damaged copy",
          );
        written.push(made);
        backup = made.path;
      }
      members.push({
        absolute: target.absolute,
        expected: target.expected,
        action: target.action,
        ...(backup ? { backup, retained: target.restored } : {}),
      });
    }
    outcome = await exclusive.restoreGroupExclusively(members);
  } finally {
    held.release();
    for (const made of written) await made.done();
  }
  if (outcome.ok)
    return [
      ...results,
      ...pending.map((target) => ({
        path: target.path,
        status: done(target),
      })),
    ];
  const blocker = pending.find((target) => target.absolute === outcome.path)!;
  if (outcome.damaged)
    return refuse(
      { path: blocker.path, status: "unprotected", reason: damagedCopy },
      "has a damaged copy",
    );
  if (outcome.changed || outcome.held)
    return refuse(
      {
        path: blocker.path,
        status: "conflict",
        reason: outcome.held
          ? "Another program holds the file open for writing, so it was left as it is."
          : changedSince,
      },
      outcome.held
        ? "is held open by another program"
        : "changed since the review",
    );
  return refuse(
    { path: blocker.path, status: "unprotected", reason: notApplied },
    "could not be put back",
  );
}
