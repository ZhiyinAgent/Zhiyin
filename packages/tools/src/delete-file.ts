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

import { lstat, readdir, realpath, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
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
  normalizePath,
} from "./workspace-path.js";
import { staysInside } from "@zhiyin/workspace-containment";

/** The person's Recycle Bin, supplied by the application. */
export type RecycleBin = {
  /**
   * Whether Windows would move each path to the Recycle Bin, asked without
   * moving anything. A path it could not tell about is left out.
   */
  recyclable(paths: readonly string[]): Promise<ReadonlyMap<string, boolean>>;
  /** Moves one item there. Rejects, deleting nothing, when it cannot. */
  recycle(path: string): Promise<void>;
};

const maximumTargets = 50;
const maximumCounted = 10_000;

export const deleteFileSpec: ToolSpec = {
  name: "delete_file",
  description:
    "Delete files or folders inside the current workspace; a folder goes with everything in it. Use this rather than shell commands to delete. mode 'recycle' (the default) moves them to the Recycle Bin, where the person can restore them. Use mode 'permanent' only for deliberate clean-up of things nobody will want back, such as build output or temporary files. The person approves every deletion.",
  inputSchema: {
    type: "object",
    properties: {
      paths: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: maximumTargets,
        description: "Workspace-relative paths of the files or folders.",
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
};

type Planned = Target & {
  readonly mode: Mode;
  /** Why a Recycle Bin request will delete permanently. */
  readonly forced?: string;
};

type Refusal = Extract<ToolCallInspection, { readonly ok: false }>;

function inputOf(args: unknown): Input | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return;
  const source = args as Record<string, unknown>;
  if (Object.keys(source).some((key) => key !== "paths" && key !== "mode"))
    return;
  const paths = source["paths"];
  const mode = source["mode"] ?? "recycle";
  if (mode !== "recycle" && mode !== "permanent") return;
  if (
    !Array.isArray(paths) ||
    !paths.length ||
    paths.length > maximumTargets ||
    !paths.every((path) => typeof path === "string" && path.trim())
  )
    return;
  return { paths: (paths as string[]).map(normalizePath), mode };
}

async function folderSize(path: string) {
  let files = 0;
  let bytes = 0;
  const entries = await readdir(path, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (files === maximumCounted) return { files, bytes, more: true };
    files += 1;
    bytes += (await lstat(join(entry.parentPath, entry.name))).size;
  }
  return { files, bytes, more: false };
}

async function targetOf(
  root: string,
  realRoot: string,
  path: string,
): Promise<Target | Refusal> {
  const absolute = resolve(root, path);
  if (isAbsolute(path) || !staysInside(root, absolute))
    return {
      ok: false,
      reason: "Only files and folders inside the workspace can be deleted.",
    };
  if (resolve(root) === absolute)
    return {
      ok: false,
      reason: "The workspace folder itself cannot be deleted.",
    };
  // The folder it sits in, with links resolved, must still be the workspace:
  // a linked folder must not carry a deletion somewhere else.
  const folder = await realpath(dirname(absolute)).catch(() => undefined);
  const canonical = folder ? join(folder, basename(absolute)) : undefined;
  if (!canonical || !staysInside(realRoot, canonical))
    return folder
      ? {
          ok: false,
          reason: "Only files and folders inside the workspace can be deleted.",
        }
      : { ok: false, reason: `${path} does not exist.`, correctable: true };
  let entry;
  try {
    entry = await lstat(canonical);
  } catch (error) {
    return errorCode(error) === "ENOENT"
      ? { ok: false, reason: `${path} does not exist.`, correctable: true }
      : { ok: false, reason: `${path} could not be checked before deleting.` };
  }
  if (!entry.isFile() && !entry.isDirectory())
    return {
      ok: false,
      reason: `${path} is not an ordinary file or folder, so it is not deleted from here.`,
    };
  const fingerprint = `${entry.ino}:${entry.size}:${entry.mtimeMs}`;
  if (entry.isFile())
    return {
      path,
      absolute: canonical,
      kind: "file",
      bytes: entry.size,
      fingerprint,
    };
  const size = await folderSize(canonical).catch(() => undefined);
  if (!size)
    return { ok: false, reason: `${path} could not be read before deleting.` };
  return {
    path,
    absolute: canonical,
    kind: "folder",
    bytes: size.bytes,
    files: size.files,
    more: size.more,
    fingerprint: `${fingerprint}:${size.files}:${size.bytes}`,
  };
}

async function targetsOf(
  root: string,
  input: Input,
): Promise<readonly Target[] | Refusal> {
  const realRoot = await realpath(root).catch(() => undefined);
  if (!realRoot)
    return { ok: false, reason: "Choose a folder before using files." };
  const targets: Target[] = [];
  for (const path of input.paths) {
    const target = await targetOf(root, realRoot, path);
    if ("ok" in target) return target;
    const container = targets.find(
      (other) =>
        other.absolute === target.absolute ||
        staysInside(other.absolute, target.absolute) ||
        staysInside(target.absolute, other.absolute),
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
  if (target.kind === "file")
    return `${target.path} (${describeBytes(target.bytes)})`;
  const count = `${target.more ? "more than " : ""}${target.files} file${target.files === 1 ? "" : "s"}`;
  return `${target.path}, a folder with ${count} (${describeBytes(target.bytes)}); everything in it goes too`;
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
      `To the Recycle Bin, where they can be restored: ${recycled.map(described).join("; ")}.`,
    );
  if (deleted.length)
    lines.push(
      `Deleted permanently; this cannot be restored from the Recycle Bin: ${deleted.map(described).join("; ")}.`,
    );
  const reasons = new Set(deleted.flatMap((item) => item.forced ?? []));
  return [...lines, ...reasons].join(" ");
}

/**
 * One deletion tool per workspace. What its last inspection showed is kept, so
 * execution deletes permanently only what the person saw would be.
 */
export class DeleteFiles {
  readonly #root: () => string;
  readonly #bin: RecycleBin | undefined;
  /** Targets the last inspection showed as permanent, by path and state. */
  readonly #shownPermanent = new Set<string>();

  constructor(root: () => string, bin?: RecycleBin) {
    this.#root = root;
    this.#bin = bin;
  }

  async #plan(args: unknown, probe: boolean) {
    const input = inputOf(args);
    if (!input)
      return {
        ok: false,
        reason:
          "Name one to 50 workspace paths to delete, and optionally mode 'recycle' or 'permanent'.",
        correctable: true,
      } satisfies Refusal;
    const targets = await targetsOf(this.#root(), input);
    if ("ok" in targets) return targets;
    let answers: ReadonlyMap<string, boolean> = new Map();
    if (probe && this.#bin && input.mode === "recycle")
      answers = await this.#bin
        .recyclable(targets.map((target) => target.absolute))
        .catch(() => new Map());
    const planned: Planned[] = targets.map((target) => {
      if (input.mode === "permanent") return { ...target, mode: "permanent" };
      if (!this.#bin)
        return {
          ...target,
          mode: "permanent",
          forced: "The Recycle Bin is not available here.",
        };
      const key = `${target.absolute}|${target.fingerprint}`;
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

  async inspect(args: unknown): Promise<ToolCallInspection> {
    const plan = await this.#plan(args, true);
    if ("ok" in plan) return plan;
    for (const item of plan.planned)
      if (item.forced && this.#bin)
        this.#shownPermanent.add(`${item.absolute}|${item.fingerprint}`);
    const changes: FileChange[] = plan.planned.map((item) => ({
      path: item.path,
      change: item.mode === "recycle" ? "recycled" : "deleted",
    }));
    return {
      ok: true,
      ...actionOf(plan.planned),
      detail: detailOf(plan.planned),
      access: "change",
      scope: "workspace",
      changes,
      identity: JSON.stringify(
        plan.planned.map((item) => [item.path, item.fingerprint, item.mode]),
      ),
      command: describeCommand(deleteFileSpec.name, plan.input),
    };
  }

  async execute(
    args: unknown,
    signal?: AbortSignal,
  ): Promise<ToolInvocationResult> {
    const plan = await this.#plan(args, false);
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
      this.#shownPermanent.delete(`${item.absolute}|${item.fingerprint}`);
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
