import type { FileChange, SpecialistRun, TaskAction } from "@zhiyin/contract";
import { visibleText } from "../shared/index.js";

/**
 * What happens to a file, in the same words wherever a change is shown:
 * before it is allowed, in the files a turn changed, and in an action's
 * account afterwards. Each reads before and after the fact.
 */
export const changeWords: Record<
  FileChange["change"],
  {
    readonly label: string;
    readonly icon: "plus" | "pencil" | "trash" | "arrow-right";
  }
> = {
  created: { label: "New file", icon: "plus" },
  updated: { label: "Edited", icon: "pencil" },
  recycled: { label: "To the Recycle Bin", icon: "trash" },
  deleted: { label: "Deleted permanently", icon: "trash" },
  moved: { label: "Moved", icon: "arrow-right" },
};

/**
 * The kind a change is shown as: a file moved here is drawn as a move, like
 * the path it left, and not as a new file.
 */
export function shownKind(change: FileChange): FileChange["change"] {
  return change.change === "created" &&
    change.from !== undefined &&
    change.to === undefined
    ? "moved"
    : change.change;
}

/**
 * What a move did at this path, or nothing for a change that is no move. A
 * path left and filled again in one turn says both.
 */
export function moveWords(change: FileChange): string | undefined {
  const { to, from } = change;
  if (change.change === "moved")
    return to === undefined ? "Moved" : `Moved to ${visibleText(to)}`;
  if (change.change !== "created") return undefined;
  if (to !== undefined) {
    if (from === to) return `Moved to ${visibleText(to)} and back`;
    return `Moved to ${visibleText(to)}; ${from === undefined ? "a new file" : visibleText(from)} took its place`;
  }
  if (from === undefined) return undefined;
  const edited =
    change.before !== undefined &&
    change.after !== undefined &&
    change.before !== change.after;
  return `Moved here from ${visibleText(from)}${edited ? " and edited" : ""}`;
}

/**
 * How an action or a specialist's run stands, in the same words wherever it
 * is shown.
 */
export const statusWords: Record<
  TaskAction["status"] | SpecialistRun["status"],
  {
    readonly label: string;
    readonly icon: "check" | "clock" | "lock" | "square" | "x" | "info";
  }
> = {
  // A clock, not a filled square: a square in a coloured ring reads as a stop
  // button or a failure, which is the opposite of work still going on.
  running: { label: "Running", icon: "clock" },
  completed: { label: "Completed", icon: "check" },
  // The action ran and answered; the answer was not success, which may be
  // what was intended (a test run to see it fail). Neither a tick nor a
  // warning would be true, so it gets a neutral marker of its own.
  reported: { label: "Reported", icon: "info" },
  failed: { label: "Failed", icon: "x" },
  denied: { label: "Denied", icon: "lock" },
  blocked: { label: "Blocked", icon: "lock" },
  cancelled: { label: "Stopped", icon: "square" },
  interrupted: { label: "Stopped", icon: "square" },
};

/**
 * What the app said of an action, and what the model said of it, apart: the
 * model's words are shown as its own, under one attribution, wherever the
 * action is shown.
 */
export function accountOf(action: {
  readonly description?: string | undefined;
  readonly descriptionByModel?: boolean;
  readonly claim?: string | undefined;
}): { readonly ours?: string; readonly model?: string } {
  const model = [
    ...new Set(
      [
        action.descriptionByModel ? action.description : undefined,
        action.claim,
      ].filter((text): text is string => Boolean(text?.trim())),
    ),
  ].join(" ");
  const ours =
    !action.descriptionByModel &&
    action.description?.trim() &&
    action.description !== action.claim
      ? action.description
      : undefined;
  return { ...(ours ? { ours } : {}), ...(model ? { model } : {}) };
}
