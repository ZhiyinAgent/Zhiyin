/**
 * One call as Blender will run it and as a person approves it, and the parts
 * every tool's preparation builds it from. Every path is checked while a call
 * is prepared, once, for both: what is approved is what runs.
 */

import type { FileChange } from "@zhiyin/contract";
import { missingInputs } from "./needed-inputs.js";
import type { Refusal, Written } from "./paths.js";
import type { SceneCommand } from "./scene-session.js";
import { timeLimits } from "./time-limits.js";
import type { Row } from "./wording.js";

export type Args = Readonly<Record<string, unknown>>;

export type Prepared = {
  readonly command: SceneCommand;
  readonly args: Readonly<Record<string, unknown>>;
  readonly timeoutMs: number;
  readonly action: string;
  readonly target: string;
  /** The call as a person reads it. */
  readonly rows: readonly Row[];
  readonly access: "read" | "change";
  readonly changes?: readonly FileChange[];
  readonly written?: readonly Written[];
  readonly opening?: { readonly relative: string; readonly absolute: string };
  /** Folders outside the workspace a script may write, by their real paths. */
  readonly outsideFolders?: readonly string[];
  /**
   * Workspace files a script may change though Zhiyin could not copy them
   * first, so changed for good (ADR 0012).
   */
  readonly forGood?: readonly string[];
  /** What the person is told besides the rows, such as a write outside. */
  readonly detail?: string;
  /**
   * Blender also writes a smaller copy for the model to see. Where it goes is
   * chosen only when the call runs: what the call is described as must stay
   * the same between approval and running.
   */
  readonly picture?: true;
};

/** Where a call on the open scene works: the workspace, the scene in it, and Zhiyin's own folders. */
export type Place = {
  readonly root: string;
  /** The open scene, workspace-relative. */
  readonly scene: string;
  /** Zhiyin's own folders, which no tool writes, whatever is approved. */
  readonly protect: readonly string[];
};

/** Prepares one tool's call on the open scene. */
export type Preparer = (
  args: Args,
  place: Place,
) => Promise<Prepared | Refusal> | Prepared | Refusal;

export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};

/** The scene file as a change, so going back can restore it. */
export const sceneFileChange = (scene: string): FileChange => ({
  path: scene,
  change: "updated",
  omitted: "The scene, saved in Blender's own format.",
});

export const fileChange = (file: Written, what: string): FileChange => ({
  path: file.relative,
  change: file.exists ? "updated" : "created",
  omitted: what,
});

/** What the person is told of a file written outside the workspace. */
export const outsideDetail = (file: Written, what: string) =>
  file.outside
    ? {
        detail: `${what} is written outside the folder you selected, at ${file.relative}.`,
      }
    : {};

/** A change to the open scene: what Blender is sent, and how the call reads. */
type Change = Pick<Prepared, "args" | "action" | "rows"> &
  Partial<Pick<Prepared, "outsideFolders" | "forGood" | "detail">>;

/**
 * A tool that changes the open scene, which is saved and can be put back.
 * What the change cannot be made without is checked before anything else.
 */
export const sceneChange =
  (
    command: keyof typeof timeLimits,
    prepare: (args: Args, place: Place) => Promise<Change | Refusal> | Change,
  ): Preparer =>
  async (args, place) => {
    const missing = missingInputs(command, args);
    if (missing) return missing;
    const change = await prepare(args, place);
    if ("reason" in change) return change;
    return {
      command,
      timeoutMs: timeLimits[command],
      target: place.scene,
      access: "change",
      changes: [sceneFileChange(place.scene)],
      ...change,
    };
  };
