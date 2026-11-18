import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { SceneIntent, ScenePanelState } from "@zhiyin/contract";
import { Serial } from "@zhiyin/one-at-a-time";
import { sceneIn } from "./paths.js";
import type { LaunchSession, SessionProcess } from "./session-process.js";
import {
  BlenderDrawing,
  BlenderPipe,
  type BlenderAnswer,
  type Ending,
} from "./blender-pipe.js";
import { duration } from "./time-limits.js";
import { ViewState, type AskedPicture } from "./view-state.js";

export type SceneCommand =
  | "open"
  | "add"
  | "edit"
  | "shape"
  | "material"
  | "camera"
  | "lighting"
  | "script"
  | "render"
  | "export"
  | "describe"
  | "api"
  | "animate"
  | "settle"
  | "scatter"
  | "measure"
  | "unwrap"
  | "bake"
  | "decal"
  | "rig"
  | "simulate"
  | "frames"
  | "closeups"
  | "look"
  | "video"
  | "lines"
  | "reference";

export type SceneOutcome =
  | {
      readonly ok: true;
      readonly text: string;
      /** What happened besides the command, such as a file loaded again. */
      readonly notes: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: string;
      /** The session refused the request as given; the model can correct it. */
      readonly refused: boolean;
    };

export type SceneSessionOptions = {
  /** The installed Blender, or nothing when it is not installed. */
  readonly blender: () => Promise<string | undefined>;
  /** This conversation's own folder in the app's data. */
  readonly directory: string;
  readonly launch: LaunchSession;
  /** The session script Blender runs. */
  readonly script: string;
  /** How long Blender may take to start, its first picture included. */
  readonly startTimeoutMs?: number;
  /** How long a preview the person asked for may take. */
  readonly previewTimeoutMs?: number;
  /** How Blender draws on this PC, found once for every conversation; one for the session when absent. */
  readonly drawing?: BlenderDrawing;
};

/**
 * What a failed command left when Blender could not load the scene file
 * again, by what Blender says the command does. A command that only reads
 * the scene leaves nothing to put back.
 */
const notPutBack = {
  changes:
    "Blender could not put the scene back as it was saved, so it still holds what the failed command did, and the next change saves that too.",
  shows:
    "Blender could not put the scene back as it was saved, so it may still hold the time or settings the failed command moved, and the next change saves that too.",
} as const;

/** A file a command may change, as it was before the command was sent. */
type Footprint = {
  readonly path: string;
  /** A script may also have changed any other file in the workspace. */
  readonly kind: "scene" | "script" | "output";
  readonly before: string | undefined;
};

const stamp = (path: string) =>
  stat(path).then(
    (status) => `${status.mtimeMs}:${status.size}`,
    () => undefined,
  );

/**
 * How long the view must stay still before its full picture is drawn. Until
 * then each change to it is drawn quickly, so turning keeps up with the hand.
 */
const settleMs = 250;

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * What of a script's time is kept for the steps after it: loading what it
 * saved, saying what it left, the checks and the spec. A script's call has
 * its whole time for these and the script together.
 */
const keptAfterScript = (timeoutMs: number) => Math.min(60_000, timeoutMs / 5);

/** Why a script's own Blender gave no answer, with what the script left. */
function scriptEnding(
  ending: Ending,
  scriptMs: number,
  leftBehind: string,
  printed: string,
): string {
  const reason =
    ending === "timeout"
      ? `The script ran past its time limit of ${duration(scriptMs)}, so the Blender running it was stopped. ${leftBehind} To finish within the limit, do less in one call (fewer objects, frames or samples, or a smaller resolution), or split the work over several calls.`
      : ending === "stopped"
        ? `The script was stopped, and the Blender running it with it. ${leftBehind}`
        : `The Blender running the script stopped while working. ${leftBehind}`;
  return printed ? `${reason}\n${printed}` : reason;
}

/** What a promise gives, or "stopped" as soon as the signal stops the wait. */
async function unlessStopped<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T | "stopped"> {
  if (!signal) return promise;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<"stopped">((resolve) => {
        onAbort = () => resolve("stopped");
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

/**
 * One conversation's Blender: started when a command first needs it, fed one
 * command at a time, and ended when a command does not finish. The scene file
 * is the truth, so a new session opens it again and carries on.
 */
export class SceneSession {
  readonly #options: SceneSessionOptions;
  readonly #view: ViewState;
  readonly #pipe: BlenderPipe;
  readonly #queue = new Serial();
  /** The picture waiting its turn behind the commands before it, if any. */
  #queued: "quick" | "full" | undefined;
  #settle: ReturnType<typeof setTimeout> | undefined;
  #scene: { readonly relative: string; readonly absolute: string } | undefined;
  #reopen = false;
  /** Why the scene file could not be opened again, until a scene is opened. */
  #unopened: string | undefined;
  /** Whether the model has been told how this PC draws. */
  #toldDrawing = false;

  constructor(options: SceneSessionOptions) {
    this.#options = options;
    const previews = join(options.directory, "previews");
    this.#view = new ViewState(previews);
    this.#pipe = new BlenderPipe({
      blender: options.blender,
      launch: options.launch,
      script: options.script,
      directory: options.directory,
      warm: join(previews, "warm.jpg"),
      ...(options.startTimeoutMs !== undefined
        ? { startTimeoutMs: options.startTimeoutMs }
        : {}),
      drawing: options.drawing ?? new BlenderDrawing(),
      report: (change, clear) => this.#view.set(change, clear),
      // A new Blender holds its own startup scene until the file is opened.
      started: () => {
        this.#reopen = this.#scene !== undefined;
      },
    });
  }

  state(): ScenePanelState {
    return this.#view.state();
  }

  onState(listener: (state: ScenePanelState) => void): () => void {
    return this.#view.onState(listener);
  }

  /**
   * The scene file the session works on, named as `workspace` has it, or
   * nothing when none is open or the open one is not in that workspace, as
   * when the conversation's folder changed since it was opened.
   */
  async sceneIn(workspace: string): Promise<string | undefined> {
    const scene = this.#scene;
    return scene ? sceneIn(workspace, scene.absolute) : undefined;
  }

  /**
   * Why no scene is open, when the scene file could not be opened again in a
   * Blender started anew; said until a scene is opened.
   */
  whyNoScene(): string | undefined {
    return this.#unopened;
  }

  /**
   * Runs one command in the scene, after every command before it. Opening a
   * scene names its file both ways, so the session can open it again later.
   */
  run(
    command: SceneCommand,
    args: Readonly<Record<string, unknown>>,
    options: {
      readonly signal?: AbortSignal;
      readonly timeoutMs: number;
      /** The workspace the command works in: Blender reaches no other. */
      readonly workspace: string;
      readonly opening?: {
        readonly relative: string;
        readonly absolute: string;
      };
    },
  ): Promise<SceneOutcome> {
    return this.#queue.run(async () =>
      this.#toldHowItDraws(await this.#execute(command, args, options)),
    );
  }

  /**
   * The outcome, with how this PC draws said in the first answer after a
   * Blender started on a PC whose graphics card cannot draw.
   */
  #toldHowItDraws(outcome: SceneOutcome): SceneOutcome {
    const said = this.#pipe.drawnWithout;
    if (said === undefined || this.#toldDrawing) return outcome;
    this.#toldDrawing = true;
    return outcome.ok
      ? { ...outcome, notes: [said, ...outcome.notes] }
      : { ...outcome, reason: `${outcome.reason}\n${said}` };
  }

  /** A change to the person's view. It re-renders the picture, never the scene. */
  look(intent: SceneIntent): void {
    if (!this.#view.look(intent)) return;
    this.#queuePreview("quick");
    clearTimeout(this.#settle);
    this.#settle = setTimeout(() => this.#queuePreview("full"), settleMs);
  }

  /** Ends the session. Its scene file stays as it was last saved. */
  async close(): Promise<void> {
    clearTimeout(this.#settle);
    await this.#pipe.close();
    this.#view.set({ status: "closed", working: false });
  }

  /**
   * Going back in the conversation. Blender ends, and the picture of what the
   * removed turns did goes with it. With `"file"`, the scene opened before
   * those turns stays, and the next command opens it again from the file as
   * it was put back; with `"nothing"`, a removed turn opened the scene, so it
   * goes too and the view has nothing to show.
   */
  async putAway(keep: "file" | "nothing"): Promise<void> {
    await this.close();
    if (keep === "nothing") this.#scene = undefined;
    this.#unopened = undefined;
    this.#view.set({}, keep === "nothing" ? ["file", "preview"] : ["preview"]);
  }

  async #execute(
    command: SceneCommand,
    args: Readonly<Record<string, unknown>>,
    options: {
      readonly signal?: AbortSignal;
      readonly timeoutMs: number;
      /** The workspace the command works in: Blender reaches no other. */
      readonly workspace: string;
      readonly opening?: {
        readonly relative: string;
        readonly absolute: string;
      };
    },
  ): Promise<SceneOutcome> {
    if (options.signal?.aborted)
      return {
        ok: false,
        reason: "The command was stopped before it started.",
        refused: false,
      };
    let process: SessionProcess;
    try {
      // Stop does not wait for Blender to finish starting; the start carries
      // on, for the next command.
      const started = await unlessStopped(
        this.#pipe.startedIn(options.workspace),
        options.signal,
      );
      if (started === "stopped")
        return {
          ok: false,
          reason:
            "The command was stopped while Blender was starting. Nothing in the scene changed.",
          refused: false,
        };
      process = started;
    } catch (error) {
      return { ok: false, reason: message(error), refused: false };
    }
    this.#view.set({ working: true });
    try {
      if (command === "open") this.#reopen = false;
      const reopened = await this.#reopened(
        process,
        options.workspace,
        options.timeoutMs,
      );
      if (typeof reopened === "object")
        return this.#ended(reopened.ending, process, options.timeoutMs);
      if (reopened)
        return {
          ok: false,
          reason: `${reopened} No scene is open.`,
          refused: false,
        };
      if (command === "script")
        return await this.#script(process, args, options);
      const footprint = await this.#footprint(command, args, options.opening);
      // The answer comes before the preview, so stopping or timing out a
      // preview never takes back a change Blender has already saved.
      const answer = await this.#pipe.exchange(process, command, args, {
        timeoutMs: options.timeoutMs,
        preview: null,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      if ("ending" in answer)
        return this.#ended(
          answer.ending,
          process,
          options.timeoutMs,
          await this.#leftBehind(footprint),
        );
      if (answer.ok && command === "open" && options.opening) {
        this.#scene = options.opening;
        this.#unopened = undefined;
      }
      return await this.#answered(answer);
    } finally {
      this.#view.set({ working: false });
    }
  }

  /** The outcome of an answer Blender gave, once the view shows what it brought. */
  async #answered(
    answer: BlenderAnswer,
    said: { readonly before?: readonly string[] } = {},
  ): Promise<SceneOutcome> {
    if (answer.file === null) this.#scene = undefined;
    await this.#show(answer);
    if (answer.changed) this.#queuePreview("full");
    const notes = [...(said.before ?? []), ...(answer.notes ?? [])];
    if (!answer.ok) {
      const lines = [answer.error ?? "Blender could not do that.", ...notes];
      if (
        answer.reloaded === false &&
        (answer.kind === "changes" || answer.kind === "shows")
      )
        lines.push(notPutBack[answer.kind]);
      return {
        ok: false,
        reason: lines.join("\n"),
        refused: answer.refused === true,
      };
    }
    return { ok: true, text: answer.text ?? "", notes };
  }

  /**
   * A script, in three steps, so that nothing it leaves in Python reaches the
   * checks or the views. The session makes sure a scene is open, as its file
   * now is; a Blender started for the script alone opens that file, runs the
   * script, saves when the script changed anything and is ended; the session,
   * which still holds the scene as it was, loads what the script saved, says
   * what the script left, checks it, measures it against its spec, and draws
   * it. A script that changed nothing is answered with what it printed, and
   * the scene the session holds stays as it is. A script that fails, is
   * stopped or runs past its limit ends only its own Blender, and the
   * session carries on with the scene as saved. The script may run until
   * the call's time less what is kept for the steps after it.
   */
  async #script(
    process: SessionProcess,
    args: Readonly<Record<string, unknown>>,
    options: {
      readonly signal?: AbortSignal;
      readonly timeoutMs: number;
      readonly workspace: string;
    },
  ): Promise<SceneOutcome> {
    const deadline = Date.now() + options.timeoutMs;
    const left = () => Math.max(0, deadline - Date.now());
    const signal = options.signal ? { signal: options.signal } : {};
    const before = await this.#pipe.exchange(
      process,
      "before_script",
      {},
      {
        timeoutMs: left(),
        preview: null,
        ...signal,
      },
    );
    if ("ending" in before)
      return this.#ended(before.ending, process, options.timeoutMs);
    if (!before.ok) return this.#answered(before);
    const scene = this.#scene;
    if (!scene)
      return {
        ok: false,
        reason:
          "No scene is open. Open or create one with blender_open_scene first.",
        refused: true,
      };
    const footprint = await this.#footprint("script", args, undefined);
    const scriptMs = Math.max(0, left() - keptAfterScript(options.timeoutMs));
    const ran = await this.#pipe.sealedRun(
      options.workspace,
      { ...args, scene: scene.absolute },
      { timeoutMs: scriptMs, ...signal },
    );
    if ("ending" in ran)
      return {
        ok: false,
        reason: scriptEnding(
          ran.ending,
          scriptMs,
          await this.#leftBehind(footprint),
          ran.printed,
        ),
        refused: false,
      };
    if (!ran.ok)
      return {
        ok: false,
        reason: [
          ran.error ?? "Blender could not run the script.",
          ...(before.notes ?? []),
          ...(ran.notes ?? []),
        ].join("\n"),
        refused: ran.refused === true,
      };
    const spec = args["spec"];
    const after = await this.#pipe.exchange(
      process,
      "after_script",
      {
        ran: ran.text ?? "",
        changed: ran.changed === true,
        ...(spec !== undefined ? { spec } : {}),
      },
      { timeoutMs: left(), preview: null, ...signal },
    );
    if ("ending" in after)
      return this.#ended(
        after.ending,
        process,
        options.timeoutMs,
        "The scene file keeps what the script did; its checks were not finished.",
      );
    const outcome = await this.#answered(after, {
      before: [...(before.notes ?? []), ...(ran.notes ?? [])],
    });
    return outcome.ok
      ? outcome
      : {
          ...outcome,
          reason: `The script ran, and the scene file keeps what it did; then this failed:\n${outcome.reason}`,
        };
  }

  /**
   * Opens the scene file in a Blender started since it was last open, before
   * that Blender is asked anything else: until then it holds its own startup
   * scene. Gives why it ended, or why the file could not be opened, if
   * either happened. A Blender started in a workspace without the scene
   * cannot reach it: the scene stays remembered, to open again in a
   * workspace that has it.
   */
  async #reopened(
    process: SessionProcess,
    workspace: string,
    timeoutMs: number,
  ): Promise<{ readonly ending: Ending } | string | undefined> {
    const scene = this.#scene;
    if (!this.#reopen || !scene) return undefined;
    if ((await sceneIn(workspace, scene.absolute)) === undefined)
      return undefined;
    this.#reopen = false;
    const reopened = await this.#pipe.exchange(
      process,
      "open",
      { path: scene.absolute, create: false },
      { timeoutMs, preview: null },
    );
    if ("ending" in reopened) return reopened;
    if (reopened.ok) return undefined;
    this.#scene = undefined;
    this.#view.set({}, ["file"]);
    this.#unopened = `${scene.relative} could not be opened again: ${reopened.error ?? "Blender could not open it."}`;
    return this.#unopened;
  }

  /** The file a command may change, so a stopped command can say what it left. */
  async #footprint(
    command: SceneCommand,
    args: Readonly<Record<string, unknown>>,
    opening: { readonly absolute: string } | undefined,
  ): Promise<Footprint | undefined> {
    if (
      command === "describe" ||
      command === "api" ||
      command === "reference" ||
      command === "frames" ||
      command === "closeups" ||
      command === "look" ||
      command === "lines"
    )
      return undefined;
    const output = args["output"];
    const writes =
      command === "render" || command === "export" || command === "video";
    const path = writes
      ? typeof output === "string"
        ? output
        : undefined
      : command === "open"
        ? opening?.absolute
        : this.#scene?.absolute;
    if (!path) return undefined;
    return {
      path,
      kind: writes ? "output" : command === "script" ? "script" : "scene",
      before: await stamp(path),
    };
  }

  /** What a command stopped part way left on disk, said truthfully. */
  async #leftBehind(footprint: Footprint | undefined): Promise<string> {
    if (!footprint) return "Nothing in the scene changed.";
    const changed = (await stamp(footprint.path)) !== footprint.before;
    if (footprint.kind === "output")
      return changed
        ? `${basename(footprint.path)} was being written when Blender stopped, so it may be incomplete.`
        : "No file was written.";
    if (footprint.kind === "script")
      return `${
        changed
          ? "The scene file was saved before Blender stopped, so it has what the script changed by then."
          : "The scene file was not changed."
      } Files the script wrote in the workspace before it stopped stay as they are.`;
    return changed
      ? "The change was saved before Blender stopped, so the scene file has it."
      : "The change was not made.";
  }

  /**
   * Draws the view once the commands before it are done, as it is by then. A
   * full picture asked for while a quick one waits takes its place.
   */
  #queuePreview(quality: "quick" | "full"): void {
    if (!this.#pipe.running) return;
    if (this.#queued) {
      if (quality === "full") this.#queued = "full";
      return;
    }
    this.#queued = quality;
    void this.#queue.run(async () => {
      const asked = this.#queued ?? quality;
      this.#queued = undefined;
      const process = this.#pipe.running;
      if (!process) return;
      const timeoutMs = this.#options.previewTimeoutMs ?? 60_000;
      const reopened = await this.#reopened(
        process,
        this.#pipe.workspace ?? "",
        timeoutMs,
      );
      if (typeof reopened === "object") {
        await this.#ended(reopened.ending, process, timeoutMs);
        return;
      }
      const request = this.#view.request(asked);
      const answer = await this.#pipe.exchange(
        process,
        "preview",
        {},
        {
          timeoutMs,
          preview: request,
        },
      );
      if ("ending" in answer) {
        await this.#ended(answer.ending, process, timeoutMs);
        return;
      }
      await this.#show(answer, {
        path: request.path,
        quickly: asked === "quick",
      });
    });
  }

  /** Ends Blender after an answer that did not come; the outcome says why. */
  async #ended(
    ending: Ending,
    process: SessionProcess,
    timeoutMs: number,
    leftBehind?: string,
  ): Promise<SceneOutcome> {
    return {
      ok: false,
      reason: await this.#pipe.ended(ending, process, timeoutMs, leftBehind),
      refused: false,
    };
  }

  /** Shows the picture an answer brought, and lets go of its file. */
  #show(answer: BlenderAnswer, asked?: AskedPicture): Promise<void> {
    return this.#view.show(answer, asked, this.#scene?.relative);
  }
}
