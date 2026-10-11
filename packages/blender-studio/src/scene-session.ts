import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { SceneIntent, ScenePanelState, SceneView } from "@zhiyin/contract";
import type { LaunchSession, SessionProcess } from "./session-process.js";

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
  | "api";

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
};

type Look = {
  view: SceneView;
  yaw: number;
  pitch: number;
  zoom: number;
  width: number;
  height: number;
};

type Answer = {
  readonly id?: number;
  readonly ok?: boolean;
  readonly text?: string;
  readonly error?: string;
  readonly refused?: boolean;
  readonly notes?: readonly string[];
  readonly file?: string | null;
  readonly preview?: {
    readonly path: string;
    readonly width: number;
    readonly height: number;
    readonly view: SceneView;
    readonly empty?: boolean;
  };
  readonly previewError?: string;
  /** Whether the command changed the scene, which then gets a new preview. */
  readonly changed?: boolean;
  /** The preview file this session asked for, the only one it reads. */
  readonly asked?: string;
  /** Whether that preview was asked for quickly, while the view moves. */
  readonly quickly?: boolean;
};

type Ending = "timeout" | "stopped" | "ended";

/** A file a command may change, as it was before the command was sent. */
type Footprint = {
  readonly path: string;
  readonly kind: "scene" | "output";
  readonly before: string | undefined;
};

const stamp = (path: string) =>
  stat(path).then(
    (status) => `${status.mtimeMs}:${status.size}`,
    () => undefined,
  );

const notInstalled =
  "Blender is not installed. Install it from the 3D & Rendering plugin first.";
const firstLook: Look = {
  view: "overview",
  yaw: 0,
  pitch: 0,
  zoom: 1,
  width: 960,
  height: 540,
};
const largestPreview = { width: 1920, height: 1080 };
/**
 * How long the view must stay still before its full picture is drawn. Until
 * then each change to it is drawn quickly, so turning keeps up with the hand.
 */
const settleMs = 250;

const endings: readonly string[] = ["timeout", "stopped", "ended"];

/** Whether the first line Blender sent says it is ready. */
function readyLine(line: string): boolean {
  if (endings.includes(line)) return false;
  try {
    return (JSON.parse(line) as { ready?: unknown }).ready === true;
  } catch {
    return false;
  }
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

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

/** The largest size within the preview limit that keeps the view's shape. */
function previewSize(width: number, height: number) {
  const scale = Math.min(
    1,
    largestPreview.width / width,
    largestPreview.height / height,
  );
  return {
    width: Math.max(64, Math.round(width * scale)),
    height: Math.max(64, Math.round(height * scale)),
  };
}

/**
 * One conversation's Blender: started when a command first needs it, fed one
 * command at a time, and ended when a command does not finish. The scene file
 * is the truth, so a new session opens it again and carries on.
 */
export class SceneSession {
  readonly #options: SceneSessionOptions;
  readonly #previews: string;
  readonly #listeners = new Set<(state: ScenePanelState) => void>();
  #state: ScenePanelState = {
    status: "closed",
    view: "overview",
    working: false,
  };
  #process: SessionProcess | undefined;
  #starting: Promise<SessionProcess> | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  #sequence = 0;
  #look: Look = { ...firstLook };
  /** The picture waiting its turn behind the commands before it, if any. */
  #queued: "quick" | "full" | undefined;
  #settle: ReturnType<typeof setTimeout> | undefined;
  #scene: { readonly relative: string; readonly absolute: string } | undefined;
  #reopen = false;
  #ending: SessionProcess | undefined;

  constructor(options: SceneSessionOptions) {
    this.#options = options;
    this.#previews = join(options.directory, "previews");
  }

  state(): ScenePanelState {
    return this.#state;
  }

  onState(listener: (state: ScenePanelState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The workspace-relative scene file the session works on, if one is open. */
  scene(): string | undefined {
    return this.#scene?.relative;
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
      readonly opening?: {
        readonly relative: string;
        readonly absolute: string;
      };
    },
  ): Promise<SceneOutcome> {
    const run = this.#queue.then(() => this.#execute(command, args, options));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  /** A change to the person's view. It re-renders the picture, never the scene. */
  look(intent: SceneIntent): void {
    const look = this.#look;
    switch (intent.kind) {
      case "view":
        look.view = intent.view;
        break;
      case "turn":
        look.yaw = (look.yaw + intent.yaw) % 360;
        look.pitch = Math.max(-110, Math.min(60, look.pitch + intent.pitch));
        break;
      case "zoom":
        look.zoom = Math.max(0.05, Math.min(20, look.zoom * intent.factor));
        break;
      case "reset":
        Object.assign(look, {
          yaw: 0,
          pitch: 0,
          zoom: 1,
        });
        break;
      case "size": {
        const size = previewSize(intent.width, intent.height);
        const same =
          Math.abs(size.width - look.width) / look.width < 0.08 &&
          Math.abs(size.height - look.height) / look.height < 0.08;
        if (same) return;
        Object.assign(look, size);
        break;
      }
    }
    this.#set({ view: look.view });
    this.#queuePreview("quick");
    clearTimeout(this.#settle);
    this.#settle = setTimeout(() => this.#queuePreview("full"), settleMs);
  }

  /** Ends the session. Its scene file stays as it was last saved. */
  async close(): Promise<void> {
    clearTimeout(this.#settle);
    const process = this.#process;
    this.#process = undefined;
    if (process) {
      this.#ending = process;
      process.end();
      await process.ended;
    }
    this.#set({ status: "closed", working: false });
  }

  async #execute(
    command: SceneCommand,
    args: Readonly<Record<string, unknown>>,
    options: {
      readonly signal?: AbortSignal;
      readonly timeoutMs: number;
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
      const started = await unlessStopped(this.#started(), options.signal);
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
    this.#set({ working: true });
    try {
      if (this.#reopen && command !== "open" && this.#scene) {
        this.#reopen = false;
        const reopened = await this.#exchange(
          process,
          "open",
          { path: this.#scene.absolute, create: false },
          { timeoutMs: options.timeoutMs, preview: false },
        );
        if ("ending" in reopened) return this.#ended(reopened.ending, process);
        if (!reopened.ok) this.#scene = undefined;
      }
      this.#reopen = false;
      const footprint = await this.#footprint(command, args, options.opening);
      // The answer comes before the preview, so stopping or timing out a
      // preview never takes back a change Blender has already saved.
      const answer = await this.#exchange(process, command, args, {
        timeoutMs: options.timeoutMs,
        preview: false,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      if ("ending" in answer)
        return this.#ended(
          answer.ending,
          process,
          await this.#leftBehind(footprint),
        );
      if (answer.ok && command === "open" && options.opening)
        this.#scene = options.opening;
      if (answer.file === null) this.#scene = undefined;
      await this.#show(answer);
      if (answer.ok && answer.changed) this.#queuePreview("full");
      if (!answer.ok)
        return {
          ok: false,
          reason: answer.error ?? "Blender could not do that.",
          refused: answer.refused === true,
        };
      return { ok: true, text: answer.text ?? "", notes: answer.notes ?? [] };
    } finally {
      this.#set({ working: false });
    }
  }

  /** The file a command may change, so a stopped command can say what it left. */
  async #footprint(
    command: SceneCommand,
    args: Readonly<Record<string, unknown>>,
    opening: { readonly absolute: string } | undefined,
  ): Promise<Footprint | undefined> {
    if (command === "describe" || command === "api") return undefined;
    const output = args["output"];
    const path =
      command === "render" || command === "export"
        ? typeof output === "string"
          ? output
          : undefined
        : command === "open"
          ? opening?.absolute
          : this.#scene?.absolute;
    if (!path) return undefined;
    return {
      path,
      kind: command === "render" || command === "export" ? "output" : "scene",
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
    return changed
      ? "The change was saved before Blender stopped, so the scene file has it."
      : "The change was not made.";
  }

  /**
   * Draws the view once the commands before it are done, as it is by then. A
   * full picture asked for while a quick one waits takes its place.
   */
  #queuePreview(quality: "quick" | "full"): void {
    if (!this.#process) return;
    if (this.#queued) {
      if (quality === "full") this.#queued = "full";
      return;
    }
    this.#queued = quality;
    const preview = this.#queue.then(async () => {
      const asked = this.#queued ?? quality;
      this.#queued = undefined;
      const process = this.#process;
      if (!process) return;
      const answer = await this.#exchange(
        process,
        "preview",
        {},
        {
          timeoutMs: this.#options.previewTimeoutMs ?? 60_000,
          preview: asked,
        },
      );
      if ("ending" in answer) {
        await this.#ended(answer.ending, process);
        return;
      }
      await this.#show(answer);
    });
    this.#queue = preview.catch(() => undefined);
  }

  async #started(): Promise<SessionProcess> {
    if (this.#process) return this.#process;
    this.#starting ??= this.#start().finally(() => {
      this.#starting = undefined;
    });
    return this.#starting;
  }

  async #start(): Promise<SessionProcess> {
    const executable = await this.#options.blender();
    if (!executable) {
      this.#set({ status: "failed", reason: notInstalled });
      throw new Error(notInstalled);
    }
    this.#set({ status: "starting" }, ["reason"]);
    await mkdir(this.#previews, { recursive: true });
    let process: SessionProcess;
    try {
      process = await this.#options.launch({
        executable,
        script: this.#options.script,
        directory: this.#options.directory,
        warm: join(this.#previews, "warm.jpg"),
      });
    } catch (error) {
      const reason = `Blender could not start: ${message(error)}`;
      this.#set({ status: "failed", reason });
      throw new Error(reason, { cause: error });
    }
    const first = await this.#race(
      process,
      process.next(),
      this.#options.startTimeoutMs ?? 180_000,
    );
    if (!readyLine(first)) {
      process.end();
      const printed = await process.printed();
      this.#set({ status: "failed", reason: "Blender did not start." });
      throw new Error(`Blender did not start.${printed ? `\n${printed}` : ""}`);
    }
    this.#process = process;
    this.#reopen = this.#scene !== undefined;
    void process.ended.then(() => {
      if (this.#process !== process) return;
      this.#process = undefined;
      if (this.#ending === process) return;
      this.#set({
        status: "failed",
        working: false,
        reason: "Blender stopped unexpectedly.",
      });
    });
    this.#set({ status: "open" }, ["reason"]);
    return process;
  }

  async #exchange(
    process: SessionProcess,
    op: string,
    args: Readonly<Record<string, unknown>>,
    options: {
      readonly timeoutMs: number;
      readonly preview: false | "quick" | "full";
      readonly signal?: AbortSignal;
    },
  ): Promise<Answer | { readonly ending: Ending }> {
    const id = ++this.#sequence;
    const look = this.#look;
    const preview = options.preview
      ? {
          path: join(this.#previews, `preview-${id}.jpg`),
          view: look.view,
          yaw: look.yaw,
          pitch: look.pitch,
          zoom: look.zoom,
          width: look.width,
          height: look.height,
          ...(options.preview === "quick" ? { quick: true } : {}),
        }
      : null;
    process.send(JSON.stringify({ id, op, args, preview }));
    const line = await this.#race(
      process,
      process.next(),
      options.timeoutMs,
      options.signal,
    );
    if (endings.includes(line)) return { ending: line as Ending };
    try {
      const answer = JSON.parse(line) as Answer;
      return answer.id === id
        ? {
            ...answer,
            ...(preview
              ? { asked: preview.path, quickly: options.preview === "quick" }
              : {}),
          }
        : { ending: "ended" };
    } catch {
      return { ending: "ended" };
    }
  }

  /** The line, or why none came: too slow, stopped, or Blender gone. */
  async #race(
    process: SessionProcess,
    reading: Promise<string | undefined>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<string | Ending> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      return await Promise.race([
        reading.then((line) => line ?? ("ended" as const)),
        process.ended.then(() => "ended" as const),
        new Promise<Ending>((resolve) => {
          timer = setTimeout(() => resolve("timeout"), timeoutMs);
        }),
        new Promise<Ending>((resolve) => {
          if (!signal) return;
          onAbort = () => resolve("stopped");
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    }
  }

  async #ended(
    ending: Ending,
    process: SessionProcess,
    leftBehind = "The change was not made.",
  ): Promise<SceneOutcome> {
    const unexpected = ending === "ended" && this.#ending !== process;
    if (this.#process === process) this.#process = undefined;
    this.#ending = process;
    process.end();
    // Windows lets go of what Blender held only once it has gone.
    await Promise.race([
      process.ended,
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    const afterwards = `${leftBehind} The next command starts Blender again from the saved scene.`;
    const reason =
      ending === "timeout"
        ? `The command ran past its time limit, so Blender was stopped. ${afterwards}`
        : ending === "stopped"
          ? `The command was stopped, and Blender with it. ${afterwards}`
          : `Blender stopped while working. ${afterwards}`;
    const printed = unexpected ? await process.printed() : "";
    this.#set(
      unexpected
        ? { status: "failed", reason: "Blender stopped unexpectedly." }
        : { status: "closed", reason: "Blender was stopped." },
    );
    return {
      ok: false,
      reason: printed ? `${reason}\n${printed}` : reason,
      refused: false,
    };
  }

  /** Shows the picture an answer brought, and lets go of its file. */
  async #show(answer: Answer): Promise<void> {
    const file =
      answer.file === undefined
        ? {}
        : answer.file === null
          ? {}
          : { file: this.#scene?.relative ?? answer.file };
    // Only the file this session named; Blender's answer cannot point elsewhere.
    const picture =
      answer.preview && answer.preview.path === answer.asked
        ? answer.preview
        : undefined;
    if (!picture) {
      if (answer.file === null) this.#set({}, ["file"]);
      else this.#set(file);
      return;
    }
    const data = await readFile(picture.path).catch(() => undefined);
    await rm(picture.path, { force: true });
    if (!data) {
      this.#set(file);
      return;
    }
    this.#set({
      ...file,
      preview: {
        data: data.toString("base64"),
        width: picture.width,
        height: picture.height,
        view: picture.view,
        sequence: ++this.#sequence,
        ...(answer.quickly ? { quick: true as const } : {}),
        ...(picture.empty ? { empty: true as const } : {}),
      },
    });
  }

  #set(
    change: Partial<ScenePanelState>,
    clear: readonly ("reason" | "file")[] = [],
  ): void {
    const next: Record<string, unknown> = { ...this.#state, ...change };
    for (const key of clear) delete next[key];
    this.#state = next as ScenePanelState;
    for (const listener of this.#listeners) listener(this.#state);
  }
}
