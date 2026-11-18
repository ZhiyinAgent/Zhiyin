/**
 * A prepared call as the person is asked to approve it: what it does, what
 * it may change and where, which calls one allowance covers, and the identity
 * the approval is bound to, so a call whose scene or files changed since does
 * not run.
 */

import type { ActionEffects, ToolCallInspection } from "@zhiyin/contract";
import type { Args, Prepared } from "./prepared-call.js";

/**
 * What a call does. Blender reads the workspace and what it installed; a call
 * that changes the scene runs confined, and changes only what it declares,
 * which is kept to put back. A script can write any file in the workspace and
 * in the folders outside it it is given, which Zhiyin copies before it runs
 * and can put back, all but a file it is let change though Zhiyin could not
 * copy it, which it changes for good.
 */
function effectsOf(prepared: Prepared, outside: boolean): ActionEffects {
  const none: ActionEffects = {
    reads: "workspace",
    changes: "none",
    sends: "none",
    actsAsPerson: "none",
    runs: "none",
    lasting: false,
    brings: "none",
  };
  if (prepared.command === "api") return { ...none, reads: "app" };
  if (prepared.access === "read") return none;
  return {
    ...none,
    ...(prepared.outsideFolders?.length ? { reads: "elsewhere" as const } : {}),
    changes: prepared.forGood?.length
      ? "workspace-for-good"
      : outside || prepared.outsideFolders?.length
        ? "elsewhere"
        : "workspace",
    runs: "sealed",
  };
}

/**
 * What was approved: the call, the scene it works on, and whether each file
 * it writes is new, this conversation's own (`own`, by the order of
 * `prepared.written`), or another.
 */
export const identityOf = (
  name: string,
  prepared: Prepared,
  scene: string | undefined,
  own: readonly boolean[],
) =>
  JSON.stringify({
    name,
    scene: scene ?? null,
    args: prepared.args,
    written: (prepared.written ?? []).map((file, index) => [
      file.relative,
      file.exists,
      own[index] ?? false,
      file.digest ?? null,
    ]),
  });

/** The call as the person is asked about it, in the workspace `root` with `scene` open. */
export function approvalOf(
  name: string,
  args: Args,
  root: string,
  prepared: Prepared,
  scene: string | undefined,
  own: readonly boolean[],
): ToolCallInspection {
  // Changes to the open scene that write no file over another but one
  // this conversation's calls wrote, unchanged since, are one set the
  // person can allow for the conversation; a script, which reaches past
  // the scene, never is.
  const replaces = (prepared.written ?? []).some(
    (file, index) => file.exists && !own[index],
  );
  // A file outside the workspace is allowed only by its own place.
  const outside = (prepared.written ?? []).some((file) => file.outside);
  const allowance =
    scene &&
    !replaces &&
    !outside &&
    prepared.command !== "open" &&
    prepared.command !== "script"
      ? {
          key: JSON.stringify({ workspace: root, scene }),
          label: `Changes to ${scene}, and new files or ones it wrote in the workspace`,
        }
      : undefined;
  return {
    ok: true,
    action: prepared.action,
    target: prepared.target,
    ...(allowance ? { allowance } : {}),
    // The call itself, for the technical details; the rows are what a
    // person reads.
    command: `${name}(${JSON.stringify(args)})`,
    invocation: { name: prepared.action, arguments: prepared.rows },
    effects: effectsOf(prepared, outside),
    // A script may change any file in the workspace, naming none.
    ...(prepared.command === "script"
      ? {
          changesAnyFile: {
            writable: prepared.forGood ?? [],
            unheldBy: "change_locked",
            // Every script saves the open scene: one too large to copy is
            // named as changed without a copy, and asked about before the
            // script runs rather than failing it (ADR 0013).
            ...(scene ? { saves: [scene] } : {}),
            ...(prepared.outsideFolders?.length
              ? { outside: prepared.outsideFolders }
              : {}),
          },
        }
      : {}),
    ...(prepared.detail ? { detail: prepared.detail } : {}),
    ...(prepared.changes ? { changes: prepared.changes } : {}),
    // What it changes is part of what was approved: the scene it works
    // on, and whether each file it writes is new or replaced.
    boundToCall: true,
    identity: identityOf(name, prepared, scene, own),
  };
}
