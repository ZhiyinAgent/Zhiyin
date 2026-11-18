/**
 * Weighing what going back over a run of actions would do to each file they
 * changed: put back, removed, in conflict with what is there now, or beyond
 * what the kept copies cover. Nothing is changed here; the review names the
 * targets a restore may write and the copies it may write from.
 */

import { readFile, realpath } from "node:fs/promises";
import { type RewindFileEffect, type TaskAction } from "@zhiyin/contract";
import { ranToItsEnd } from "@zhiyin/conversation-rules";
import type { CapturedFile, Manifest } from "./records.js";
import { currentDigest, digest, safeAbsolute } from "./workspace-files.js";

export type RestoreTarget = {
  readonly path: string;
  readonly absolute: string;
  readonly expected: "absent" | string;
  readonly restored: "absent" | string;
  readonly action: "restore" | "remove";
  readonly backup?: string;
};

export type RecoveryReview = {
  readonly id: string;
  readonly workspaceRoot: string;
  readonly files: readonly RewindFileEffect[];
  /** Kept inside the core; the renderer receives only `files`. */
  readonly targets: readonly RestoreTarget[];
  /** The folder could not be opened, so no file in it can be put back. */
  readonly folderUnavailable?: true;
};

/**
 * A file as it was before a run of actions and as the last of them left it,
 * from the copy kept before the first and the file on disk now.
 */
export type FileVersions =
  | {
      readonly ok: true;
      /** Absent when the actions created the file. */
      readonly before?: Uint8Array;
      readonly after: Uint8Array;
    }
  | { readonly ok: false; readonly reason: string };

/** What a review reads of the store. */
export type ReviewedStore = {
  /** The manifest kept for an action, prepared or committed. */
  readonly manifest: (actionId: string) => Promise<Manifest | undefined>;
  /** Where the copy of a file kept for an action lies, if it has one. */
  readonly copyOf: (actionId: string, file: CapturedFile) => string | undefined;
};

/**
 * The files an action changed that a copy may cover: those it declared, then
 * those a shell command was found to create or change, then every file its
 * program was found to change against a copy of its folder.
 */
function changedPaths(action: TaskAction, manifest?: Manifest): string[] {
  const paths = (action.changes ?? []).map((change) =>
    change.path.replaceAll("\\", "/"),
  );
  if (manifest?.run && manifest.phase === "committed")
    for (const file of manifest.files)
      if (!paths.includes(file.path)) paths.push(file.path);
  const found = action.commandChanges;
  if (found?.status === "checked")
    for (const file of found.files)
      if (file.change !== "deleted") {
        const path = file.path.replaceAll("\\", "/");
        if (!paths.includes(path)) paths.push(path);
      }
  return paths;
}

export async function reviewActions(
  store: ReviewedStore,
  reviewId: string,
  workspaceRoot: string,
  actions: readonly TaskAction[],
): Promise<RecoveryReview> {
  // An action that never began running, declined, blocked or stopped
  // before it ran, changed nothing; one a crash cut short may have.
  const ran = actions.filter(
    (action) => ranToItsEnd(action) || action.startedAt !== undefined,
  );
  let root: string;
  try {
    root = await realpath(workspaceRoot);
  } catch {
    const paths = new Set(
      ran.flatMap((action) =>
        (action.changes ?? []).map((change) =>
          change.path.replaceAll("\\", "/"),
        ),
      ),
    );
    return {
      id: reviewId,
      workspaceRoot,
      files: [...paths].map((path) => ({
        path,
        action: "unknown" as const,
        status: "unprotected" as const,
        reason: "The conversation's folder could not be opened.",
      })),
      targets: [],
      folderUnavailable: true,
    };
  }
  const grouped = new Map<
    string,
    { readonly actionId: string; readonly file: CapturedFile }[]
  >();
  const unprotected = new Map<string, string>();
  // Files changed in another folder the conversation was in: what this
  // folder holds under the same name is another file, so they are said to
  // be elsewhere only when no action changed that name here.
  const elsewhere = new Map<string, string>();
  for (const action of ran) {
    const manifest = await store.manifest(action.id);
    const committed = manifest?.phase === "committed" ? manifest : undefined;
    // Where the action ran: its copies say, even of a change a crash cut
    // short, and once they are gone its own record does. One that says
    // neither is taken to have run here.
    const ranIn =
      manifest?.workspaceRoot ??
      (action.folder
        ? await realpath(action.folder).catch(() => action.folder)
        : undefined);
    for (const path of changedPaths(action, committed)) {
      const captured = committed?.files.find((file) => file.path === path);
      // What a command created is weighed only once it was recorded: the
      // rest of what it changed has no copy, and is listed on its own. What
      // a program changed against a copy of its folder is all weighed.
      if (
        !(action.changes ?? []).some(
          (change) => change.path.replaceAll("\\", "/") === path,
        ) &&
        captured?.status !== "protected" &&
        !(committed?.run && captured)
      )
        continue;
      // A copy is put back only in the folder it was taken in.
      if (ranIn !== undefined && ranIn !== root) {
        elsewhere.set(
          path,
          captured?.status === "protected"
            ? `The copy of this file was taken in ${ranIn}, not in the folder this conversation is in now.`
            : (captured?.reason ??
                "No copy of this file is kept: none was taken, or it was removed by the storage limits."),
        );
        continue;
      }
      // A change whose copy was evicted still links the ones around it; it
      // is needed for its bytes only when it is the first, below.
      const linked = captured?.evicted === true && captured.after;
      if (
        !captured ||
        (!linked && (captured.status !== "protected" || !captured.after))
      ) {
        unprotected.set(
          path,
          captured?.reason ??
            "No copy of this file is kept: none was taken, or it was removed by the storage limits.",
        );
        continue;
      }
      grouped.set(path, [
        ...(grouped.get(path) ?? []),
        { actionId: action.id, file: captured },
      ]);
    }
  }

  const files: RewindFileEffect[] = [];
  const targets: RestoreTarget[] = [];
  for (const [path, reason] of elsewhere)
    if (!grouped.has(path) && !unprotected.has(path))
      unprotected.set(path, reason);
  for (const [path, reason] of unprotected) {
    files.push({ path, action: "unknown", status: "unprotected", reason });
  }
  for (const [path, taken] of grouped) {
    if (unprotected.has(path)) continue;
    // What a command changed before anything known of the file held no
    // copy: the file's history starts at the first change whose earlier
    // state is known. With none, the file is listed with the command's
    // other changes, not here.
    const start = taken.findIndex(
      (version) => version.file.before !== "unknown",
    );
    if (start < 0) continue;
    const kept = taken.slice(start);
    const versions = kept.map((version) => version.file);
    const first = versions[0]!;
    const last = versions.at(-1)!;
    // The file is put back from the copy taken before the first change; a
    // created file needs none, and never had one to lose.
    if (first.evicted) {
      files.push({
        path,
        action: "unknown",
        status: "unprotected",
        reason:
          first.reason ??
          "The retained recovery copy expired or was evicted by storage limits.",
      });
      continue;
    }
    const absolute = await safeAbsolute(root, path).catch(() => undefined);
    const expected = last.after === "absent" ? "absent" : last.afterDigest;
    const restored = first.before === "absent" ? "absent" : first.beforeDigest;
    const current = absolute ? await currentDigest(absolute) : "other";
    const action = first.before === "absent" ? "remove" : "restore";
    // Each change must start from what the one before it left: a file
    // edited in between holds work that is not the turn's to discard.
    const chained = versions.every((version, index) => {
      if (index === 0) return true;
      const previous = versions[index - 1]!;
      const left =
        previous.after === "absent" ? "absent" : previous.afterDigest;
      // A command overwrote whatever was there, so putting the file back
      // loses nothing the command had not already replaced.
      if (version.before === "unknown") return left !== undefined;
      const found =
        version.before === "absent" ? "absent" : version.beforeDigest;
      return left !== undefined && left === found;
    });
    if (!chained) {
      files.push({
        path,
        action,
        status: "conflict",
        reason:
          "The file was changed between two of the changes being undone, so it was left as it is.",
      });
      continue;
    }
    // Already as it was before the changes, as after an undo that put it
    // back while another file could not be: putting it back is a no-op.
    const alreadyBack = current === restored;
    if (
      !absolute ||
      !expected ||
      !restored ||
      (current !== expected && !alreadyBack)
    ) {
      files.push({
        path,
        action,
        status: "conflict",
        reason:
          "The current file no longer matches the result recorded for the discarded work.",
      });
      continue;
    }
    files.push({ path, action, status: "recoverable" });
    const backup = store.copyOf(kept[0]!.actionId, first);
    targets.push({
      path,
      absolute,
      expected,
      restored,
      action,
      ...(backup ? { backup } : {}),
    });
  }
  return { id: reviewId, workspaceRoot: root, files, targets };
}

/**
 * One file of a review as it was before the reviewed actions and as the last
 * of them left it, only while both are what was recorded.
 */
export async function versionsIn(
  reviewed: RecoveryReview,
  path: string,
): Promise<FileVersions> {
  const named = path.replaceAll("\\", "/");
  const file = reviewed.files.find((item) => item.path === named);
  const target = reviewed.targets.find((item) => item.path === named);
  const changedSince = {
    ok: false,
    reason: `${named} has changed since, so the change can no longer be shown.`,
  } as const;
  if (file?.status === "conflict") return changedSince;
  if (!target)
    return {
      ok: false,
      reason: file?.reason ?? "No copy was kept before the change.",
    };
  const after = await readFile(target.absolute).catch(() => undefined);
  if (!after || digest(after) !== target.expected) return changedSince;
  if (target.action === "remove")
    return { ok: true, after: new Uint8Array(after) };
  const before = target.backup
    ? await readFile(target.backup).catch(() => undefined)
    : undefined;
  if (!before || digest(before) !== target.restored)
    return { ok: false, reason: "The copy kept before the change is gone." };
  return {
    ok: true,
    before: new Uint8Array(before),
    after: new Uint8Array(after),
  };
}
