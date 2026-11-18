/**
 * Deletes files and folders inside the workspace, to the Recycle Bin or
 * permanently, as the model asks.
 *
 * The Recycle Bin is the default because a person can restore from it without
 * this app. Windows decides what it will take — size, drive, settings — so each
 * target is asked about before anyone approves, and one it would not take is
 * shown as the permanent deletion it would be. Execution never makes that call
 * again on its own: it deletes permanently only what the approved inspection
 * showed as permanent, and a Recycle Bin refusal after approval deletes nothing.
 */

import { lstat, opendir, realpath, rm } from "node:fs/promises";
import { effectsOf } from "../../shared/effects.js";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
} from "node:path";
import type {
  FileChange,
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import {
  describeBytes,
  describeCommand,
  errorCode,
  namesStream,
  normalizePath,
  toForwardSlashes,
} from "../../shared/workspace-path.js";
import {
  realStaysInside,
  staysBelow,
  staysInside,
} from "@zhiyin/workspace-containment";
import { keptInPlace } from "../taking-away.js";
import { schemaInput, withSchemaProblems } from "@zhiyin/tool-input";
import type { RecycleBin } from "@zhiyin/files";
import type { ToolDefinition } from "../../tool-definition.js";

const maximumTargets = 50;
const maximumCounted = 10_000;

const deleteFileSpec: ToolSpec = {
  name: "delete_file",
  description:
    "Delete files or folders inside the current workspace, or, by their whole path, outside it to the Recycle Bin only; a folder goes with everything in it. Use this rather than shell commands to delete. mode 'recycle' (the default) moves them to the Recycle Bin, where the person can restore them. Use mode 'permanent' only for deliberate clean-up of things nobody will want back, such as build output or temporary files. The person approves a deletion for good, or outside the workspace, every time; a move to the Recycle Bin inside the workspace runs without asking.",
  inputSchema: {
    type: "object",
    properties: {
      paths: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: maximumTargets,
        description:
          "Workspace-relative paths of the files or folders, or whole paths of ones outside the workspace.",
      },
      mode: {
        type: "string",
        enum: ["recycle", "permanent"],
        description: "Where they go. Defaults to recycle.",
      },
    },
    required: ["paths"],
    additionalProperties: false,
  },
};

type Mode = "recycle" | "permanent";
type Input = { readonly paths: readonly string[]; readonly mode: Mode };

type Target = {
  readonly path: string;
  readonly absolute: string;
  readonly kind: "file" | "folder";
  readonly bytes: number;
  /** Files inside a folder, counted up to a bound. */
  readonly files?: number;
  readonly more?: boolean;
  /** What changes when the target does: approval is for this one. */
  readonly fingerprint: string;
  /** Outside the workspace, named by its whole real path (ADR 0012). */
  readonly outside?: true;
};

type Planned = Target & {
  readonly mode: Mode;
  /** Why a Recycle Bin request will delete permanently. */
  readonly forced?: string;
};

type Refusal = Extract<ToolCallInspection, { readonly ok: false }>;

function inputOf(args: unknown): Input | undefined {
  const input = schemaInput<{
    readonly paths: readonly string[];
    readonly mode?: Mode;
  }>(deleteFileSpec.inputSchema, args);
  if (!input?.paths.every((path) => path.trim())) return;
  return {
    paths: input.paths.map(normalizePath),
    mode: input.mode ?? "recycle",
  };
}

async function folderSize(path: string) {
  let files = 0;
  let bytes = 0;
  // Read as it goes, so a folder of any size is walked only up to the count.
  for await (const entry of await opendir(path, { recursive: true })) {
    if (!entry.isFile()) continue;
    if (files === maximumCounted) return { files, bytes, more: true };
    files += 1;
    bytes += (await lstat(join(entry.parentPath, entry.name))).size;
  }
  return { files, bytes, more: false };
}

const workspaceItself: Refusal = {
  ok: false,
  reason: "The workspace folder itself cannot be deleted.",
};

async function targetOf(
  root: string,
  realRoot: string,
  path: string,
  protect: readonly string[],
): Promise<Target | Refusal> {
  const missing: Refusal = {
    ok: false,
    reason: `${path} does not exist.`,
    correctable: true,
  };
  const absolute = resolve(root, path);
  // A whole path is either in the workspace after all, or outside it.
  if (isAbsolute(path) && !namesStream(path.slice(parse(path).root.length)))
    return staysInside(root, absolute)
      ? targetOf(root, realRoot, relative(root, absolute), protect)
      : outsideTargetOf(realRoot, absolute, path, missing, protect);
  if (isAbsolute(path) || namesStream(path) || !staysInside(root, absolute))
    return {
      ok: false,
      reason: "Only files and folders inside the workspace can be deleted.",
    };
  if (!staysBelow(root, absolute)) return workspaceItself;
  // The folder it sits in, with links resolved, must still be the workspace:
  // a linked folder must not carry a deletion somewhere else.
  let folder: string;
  try {
    folder = await realpath(dirname(absolute));
  } catch (error) {
    return ["ENOENT", "ENOTDIR"].includes(errorCode(error) as string)
      ? missing
      : { ok: false, reason: `${path} could not be checked before deleting.` };
  }
  // Both real, so compared exactly: a sibling named like the workspace but
  // for case, in a folder that tells case apart, is outside. The workspace
  // itself was refused above by name, which Windows matches without case.
  if (!realStaysInside(realRoot, folder))
    return {
      ok: false,
      reason: "Only files and folders inside the workspace can be deleted.",
    };
  const linked = join(folder, basename(absolute));
  let entry;
  try {
    entry = await lstat(linked);
  } catch (error) {
    return errorCode(error) === "ENOENT"
      ? missing
      : { ok: false, reason: `${path} could not be checked before deleting.` };
  }
  if (!entry.isFile() && !entry.isDirectory())
    return {
      ok: false,
      reason: `${path} is not an ordinary file or folder, so it is not deleted from here.`,
    };
  // Not a link, so its real path is the same file, with its name as the folder
  // stores it: what the change declares, and what two names are compared by.
  const canonical = await realpath(linked).catch(() => undefined);
  if (canonical === undefined)
    return {
      ok: false,
      reason: `${path} could not be checked before deleting.`,
    };
  const named = toForwardSlashes(relative(realRoot, canonical));
  const fingerprint = `${entry.ino}:${entry.size}:${entry.mtimeMs}`;
  if (entry.isFile())
    return {
      path: named,
      absolute: canonical,
      kind: "file",
      bytes: entry.size,
      fingerprint,
    };
  const size = await folderSize(canonical).catch(() => undefined);
  if (!size)
    return { ok: false, reason: `${path} could not be read before deleting.` };
  return {
    path: named,
    absolute: canonical,
    kind: "folder",
    bytes: size.bytes,
    files: size.files,
    more: size.more,
    fingerprint: `${fingerprint}:${size.files}:${size.bytes}`,
  };
}

/**
 * A file or folder outside the workspace, named by its whole path: it must be
 * there as an ordinary file or folder, not a link, and is declared by its
 * real path. Zhiyin's own folders, a folder holding one, and a folder that
 * holds nearly everything are never deleted.
 */
async function outsideTargetOf(
  realRoot: string,
  absolute: string,
  path: string,
  missing: Refusal,
  protect: readonly string[],
): Promise<Target | Refusal> {
  const unchecked: Refusal = {
    ok: false,
    reason: `${path} could not be checked before deleting.`,
  };
  if (dirname(absolute) === absolute)
    return { ok: false, reason: `${path} is a whole drive.` };
  let entry;
  let canonical: string;
  try {
    const folder = await realpath(dirname(absolute));
    entry = await lstat(join(folder, basename(absolute)));
    canonical = await realpath(join(folder, basename(absolute)));
  } catch (error) {
    return ["ENOENT", "ENOTDIR"].includes(errorCode(error) as string)
      ? missing
      : unchecked;
  }
  if (!entry.isFile() && !entry.isDirectory())
    return {
      ok: false,
      reason: `${path} is not an ordinary file or folder, so it is not deleted from here.`,
    };
  if (realStaysInside(realRoot, canonical))
    return {
      ok: false,
      reason:
        "Name a file or folder in the workspace by its workspace-relative path.",
      correctable: true,
    };
  const kept = keptInPlace(canonical, {
    realRoot,
    protect,
    folder: entry.isDirectory(),
    take: "deleted",
  });
  if (kept) return { ok: false, reason: kept };
  const fingerprint = `${entry.ino}:${entry.size}:${entry.mtimeMs}`;
  if (entry.isFile())
    return {
      path: canonical,
      absolute: canonical,
      kind: "file",
      bytes: entry.size,
      fingerprint,
      outside: true,
    };
  const size = await folderSize(canonical).catch(() => undefined);
  if (!size)
    return { ok: false, reason: `${path} could not be read before deleting.` };
  return {
    path: canonical,
    absolute: canonical,
    kind: "folder",
    bytes: size.bytes,
    files: size.files,
    more: size.more,
    fingerprint: `${fingerprint}:${size.files}:${size.bytes}`,
    outside: true,
  };
}

async function targetsOf(
  root: string,
  input: Input,
  protect: readonly string[],
): Promise<readonly Target[] | Refusal> {
  const realRoot = await realpath(root).catch(() => undefined);
  if (!realRoot)
    return { ok: false, reason: "Choose a folder before using files." };
  const targets: Target[] = [];
  for (const path of input.paths) {
    const target = await targetOf(root, realRoot, path, protect);
    if ("ok" in target) return target;
    const container = targets.find(
      (other) =>
        realStaysInside(other.absolute, target.absolute) ||
        realStaysInside(target.absolute, other.absolute),
    );
    if (container) {
      const [outer, inner] =
        container.absolute.length <= target.absolute.length
          ? [container, target]
          : [target, container];
      return {
        ok: false,
        reason:
          outer.absolute === inner.absolute
            ? `${inner.path} is named twice.`
            : `${inner.path} is inside ${outer.path}, which is already being deleted.`,
        correctable: true,
      };
    }
    targets.push(target);
  }
  return targets;
}

function described(target: Target): string {
  const where = target.outside ? ", outside the folder you selected" : "";
  if (target.kind === "file")
    return `${target.path} (${describeBytes(target.bytes)})${where}`;
  const count = `${target.more ? "more than " : ""}${target.files} file${target.files === 1 ? "" : "s"}`;
  return `${target.path}, a folder with ${count} (${describeBytes(target.bytes)}); everything in it goes too${where}`;
}

function actionOf(planned: readonly Planned[]): {
  readonly action: string;
  readonly target: string;
} {
  const recycled = planned.filter((item) => item.mode === "recycle").length;
  const deleted = planned.length - recycled;
  if (planned.length === 1) {
    const [only] = planned as [Planned];
    return {
      action:
        only.mode === "recycle"
          ? `Move ${only.path} to the Recycle Bin`
          : `Delete ${only.path} permanently`,
      target: only.path,
    };
  }
  const count = `${planned.length} items`;
  return {
    action: !deleted
      ? `Move ${count} to the Recycle Bin`
      : !recycled
        ? `Delete ${count} permanently`
        : `Delete ${count}: ${recycled} to the Recycle Bin, ${deleted} permanently`,
    target: count,
  };
}

function detailOf(planned: readonly Planned[]): string {
  const lines: string[] = [];
  const recycled = planned.filter((item) => item.mode === "recycle");
  const deleted = planned.filter((item) => item.mode === "permanent");
  if (recycled.length)
    lines.push(
      `To the Recycle Bin, where ${recycled.length === 1 ? "it" : "they"} can be restored: ${recycled.map(described).join("; ")}.`,
    );
  if (deleted.length)
    lines.push(
      `Deleted permanently; this cannot be restored from the Recycle Bin: ${deleted.map(described).join("; ")}.`,
    );
  const reasons = new Set(deleted.flatMap((item) => item.forced ?? []));
  return [...lines, ...reasons].join(" ");
}

function shownKey(
  conversationId: string | undefined,
  target: { readonly absolute: string; readonly fingerprint: string },
): string {
  return `${conversationId ?? ""}|${target.absolute}|${target.fingerprint}`;
}

/**
 * What a deletion does. Deleting for good is the one Zhiyin cannot put back,
 * so it is declared over a move to the Recycle Bin outside the workspace in
 * the same call.
 */
function deletionEffects(planned: readonly Planned[]) {
  const outside = planned.some((item) => item.outside);
  return effectsOf({
    reads: outside ? "elsewhere" : "workspace",
    changes: planned.some((item) => item.mode === "permanent")
      ? "workspace-for-good"
      : outside
        ? "elsewhere"
        : "workspace",
  });
}

/**
 * The deletion tool, given each call's folder. What a conversation's last
 * inspection showed is kept, so execution deletes permanently only what the
 * person saw would be.
 */
class DeleteFiles {
  readonly #bin: RecycleBin | undefined;
  /**
   * Targets a conversation's last inspection showed as permanent, by
   * conversation, path and state: another conversation looking at the same
   * file does not change what this one was shown.
   */
  readonly #shownPermanent = new Set<string>();
  /** Zhiyin's own folders, which are never deleted. */
  readonly #protect: readonly string[];

  constructor(bin?: RecycleBin, protect: readonly string[] = []) {
    this.#bin = bin;
    this.#protect = protect;
  }

  async #plan(
    root: string,
    args: unknown,
    probe: boolean,
    conversationId: string | undefined,
  ) {
    const input = inputOf(args);
    if (!input)
      return {
        ok: false,
        reason: withSchemaProblems(
          "Name one to 50 workspace paths to delete, and optionally mode 'recycle' or 'permanent'.",
          args,
          deleteFileSpec.inputSchema,
        ),
        correctable: true,
      } satisfies Refusal;
    const targets = await targetsOf(root, input, this.#protect);
    if ("ok" in targets) return targets;
    // Outside the workspace, only to the Recycle Bin, where the person can
    // restore it without Zhiyin.
    const outside = targets.filter((target) => target.outside);
    if (outside.length && (input.mode === "permanent" || !this.#bin))
      return {
        ok: false,
        reason: `${outside[0]!.path} is outside the workspace, and is deleted from there only to the Recycle Bin${this.#bin ? "" : ", which is not available here"}.`,
      } satisfies Refusal;
    let answers: ReadonlyMap<string, boolean> = new Map();
    if (probe && this.#bin && input.mode === "recycle")
      answers = await this.#bin
        .recyclable(targets.map((target) => target.absolute))
        .catch(() => new Map());
    if (probe)
      for (const target of outside)
        if (answers.get(target.absolute) !== true)
          return {
            ok: false,
            reason: `Windows would not move ${target.path} to the Recycle Bin, or could not confirm it would, and outside the workspace nothing is deleted permanently.`,
          } satisfies Refusal;
    const planned: Planned[] = targets.map((target) => {
      if (target.outside) return { ...target, mode: "recycle" };
      if (input.mode === "permanent") return { ...target, mode: "permanent" };
      if (!this.#bin)
        return {
          ...target,
          mode: "permanent",
          forced: "The Recycle Bin is not available here.",
        };
      const key = shownKey(conversationId, target);
      if (!probe)
        return this.#shownPermanent.has(key)
          ? { ...target, mode: "permanent" }
          : { ...target, mode: "recycle" };
      // Offered only when Windows confirmed it: a target it could not answer
      // for is shown as the permanent deletion it may turn out to be.
      const answer = answers.get(target.absolute);
      if (answer === true) return { ...target, mode: "recycle" };
      return {
        ...target,
        mode: "permanent",
        forced:
          answer === false
            ? `Windows would not move ${target.path} to the Recycle Bin: it is too large for it, or on a drive without one.`
            : `Windows could not confirm that ${target.path} would go to the Recycle Bin.`,
      };
    });
    return { input, planned };
  }

  async inspect(
    root: string,
    args: unknown,
    conversationId?: string,
  ): Promise<ToolCallInspection> {
    const plan = await this.#plan(root, args, true, conversationId);
    if ("ok" in plan) return plan;
    // The latest inspection is what the person approves: a target it shows
    // going to the Recycle Bin is no longer one shown as permanent.
    for (const item of plan.planned) {
      const key = shownKey(conversationId, item);
      if (item.forced && this.#bin) this.#shownPermanent.add(key);
      else this.#shownPermanent.delete(key);
    }
    const changes: FileChange[] = plan.planned.map((item) => ({
      path: item.path,
      change: item.mode === "recycle" ? "recycled" : "deleted",
    }));
    return {
      ok: true,
      ...actionOf(plan.planned),
      detail: detailOf(plan.planned),
      // A move to the Recycle Bin in the workspace can be undone, so a grant
      // for its file or folder may cover it; deleting for good, and anything
      // outside the workspace, is asked about every time.
      ...(plan.planned.some((item) => item.outside || item.mode === "permanent")
        ? { asksEachTime: true as const }
        : {}),
      changes,
      effects: deletionEffects(plan.planned),
      identity: JSON.stringify(
        plan.planned.map((item) => [item.path, item.fingerprint, item.mode]),
      ),
      command: describeCommand(deleteFileSpec.name, plan.input),
    };
  }

  async execute(
    root: string,
    args: unknown,
    signal?: AbortSignal,
    conversationId?: string,
  ): Promise<ToolInvocationResult> {
    const plan = await this.#plan(root, args, false, conversationId);
    if ("ok" in plan) return plan;
    const outcomes: {
      readonly path: string;
      readonly outcome: "recycled" | "deleted" | "not deleted";
      readonly reason?: string;
    }[] = [];
    for (const item of plan.planned) {
      if (signal?.aborted) {
        outcomes.push({
          path: item.path,
          outcome: "not deleted",
          reason: "the action was stopped first.",
        });
        continue;
      }
      try {
        if (item.mode === "recycle") await this.#bin!.recycle(item.absolute);
        else
          await rm(item.absolute, {
            recursive: item.kind === "folder",
            force: false,
          });
        outcomes.push({
          path: item.path,
          outcome: item.mode === "recycle" ? "recycled" : "deleted",
        });
      } catch {
        outcomes.push({
          path: item.path,
          outcome: "not deleted",
          reason:
            item.mode === "recycle"
              ? "the Recycle Bin did not accept it."
              : "it could not be removed; check that nothing has it open.",
        });
      }
      this.#shownPermanent.delete(shownKey(conversationId, item));
    }
    const failed = outcomes.filter((item) => item.outcome === "not deleted");
    if (!failed.length) return { ok: true, value: { deleted: outcomes } };
    const done = outcomes.filter((item) => item.outcome !== "not deleted");
    return {
      ok: false,
      reason: [
        ...failed.map(
          (item) =>
            `${item.path} was not deleted: ${item.reason}${item.reason === "the Recycle Bin did not accept it." ? " Nothing of it was deleted; ask again with mode 'permanent' only if the person wants it gone for good." : ""}`,
        ),
        ...(done.length
          ? [
              `Done: ${done.map((item) => `${item.path} (${item.outcome === "recycled" ? "to the Recycle Bin" : "deleted permanently"})`).join(", ")}.`,
            ]
          : []),
      ].join(" "),
    };
  }
}

/**
 * Deleting files and folders, as the registry offers it. Without the Recycle
 * Bin, every deletion is shown as permanent.
 */
export function deleteFileTool(
  bin: RecycleBin | undefined,
  protect: readonly string[],
): ToolDefinition {
  const deletion = new DeleteFiles(bin, protect);
  return {
    spec: deleteFileSpec,
    requiresWorkspace: true,
    inspect: (args, conversationId, { root }) =>
      deletion.inspect(root, args, conversationId),
    execute: (args, signal, conversationId, { root }) =>
      deletion.execute(root, args, signal, conversationId),
  };
}
