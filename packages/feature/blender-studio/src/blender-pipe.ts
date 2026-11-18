/**
 * The line protocol to one conversation's Blender: starting it in a
 * workspace, sending one request and reading its answer, and ending it when
 * an answer does not come. Each request is a line of JSON with an id; each
 * answer is a line naming the same id, and any other line ends Blender.
 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ScenePanelState, SceneView } from "@zhiyin/contract";
import { drawsWithout, notInstalled } from "./environment-words.js";
import type { LaunchSession, SessionProcess } from "./session-process.js";
import { duration } from "./time-limits.js";

/**
 * Whether Blender draws on this PC's graphics card, shared by every
 * conversation's scene and found once in the app's run. It is taken to draw
 * until a Blender ends while it draws its warm-up picture twice in a row
 * before any Blender has drawn there. Then a Blender started for that alone
 * draws the same picture: one that ends while drawing it, as Blender does on
 * a PC whose graphics card cannot draw, or says it could not, settles that
 * the PC draws on its processor, and every Blender after it, for the rest of
 * the app's run, draws with Cycles. Once a Blender has drawn, the PC draws: a
 * Blender that ends there later, as one can on a busy graphics card, only
 * failed to start.
 */
export class BlenderDrawing {
  #processor = false;
  #drew = false;
  #finding: Promise<boolean> | undefined;

  /** Whether every Blender draws with Cycles, this PC's graphics card being unable to draw. */
  get onProcessor(): boolean {
    return this.#processor;
  }

  /** Whether a Blender has drawn on the graphics card in this run. */
  get drew(): boolean {
    return this.#drew;
  }

  drawn(): void {
    this.#drew = true;
  }

  /**
   * Whether the graphics card draws, as `probe` finds out: asked by several
   * at once, it is found once. A probe that fails to give an answer is
   * tried again the next time.
   */
  find(probe: () => Promise<boolean>): Promise<boolean> {
    this.#finding ??= probe().then(
      (draws) => {
        if (draws) this.#drew = true;
        else this.#processor = true;
        return draws;
      },
      (error: unknown) => {
        this.#finding = undefined;
        throw error;
      },
    );
    return this.#finding;
  }

  /** Settles once a finding under way has, however it ended. */
  async settled(): Promise<void> {
    await this.#finding?.catch(() => undefined);
  }
}

/** How many times a start is tried when Blender ends while drawing. */
const drawingTries = 2;

/** Blender's answer to one request, as it sends it. */
export type BlenderAnswer = {
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
  /**
   * Whether the scene changed, which then gets a new preview: by the command,
   * or, when it failed, by the scene file being loaded again from disk.
   */
  readonly changed?: boolean;
  /** Whether a change that failed was taken back out of the scene. */
  readonly reloaded?: boolean;
  /**
   * What the command does to the scene: changes it, shows it and leaves it as
   * it was, or only reads it.
   */
  readonly kind?: "changes" | "shows" | "reads";
};

/** Why no answer came: too slow, stopped, or Blender gone. */
export type Ending = "timeout" | "stopped" | "ended";

/** A change to what the person is shown of Blender, and the parts it clears. */
type Report = (
  change: Partial<ScenePanelState>,
  clear?: readonly ("reason" | "file" | "preview")[],
) => void;

export type BlenderPipeOptions = {
  /** The installed Blender, or nothing when it is not installed. */
  readonly blender: () => Promise<string | undefined>;
  readonly launch: LaunchSession;
  /** The session script Blender runs. */
  readonly script: string;
  /** This conversation's own folder in the app's data. */
  readonly directory: string;
  /** Where Blender draws its warm-up picture as it starts. */
  readonly warm: string;
  /** How long Blender may take to start, its first picture included. */
  readonly startTimeoutMs?: number;
  readonly drawing: BlenderDrawing;
  /** Told whether Blender is starting, open, failed or closed. */
  readonly report: Report;
  /** Called once a Blender has started, before it is asked anything. */
  readonly started: () => void;
};

const endings: readonly string[] = ["timeout", "stopped", "ended"];

/**
 * Whether a line Blender sent as it started says it is ready, is drawing its
 * warm-up picture, or drew it.
 */
function startLine(line: string, field: "ready" | "warming" | "drew"): boolean {
  if (endings.includes(line)) return false;
  try {
    return (JSON.parse(line) as Record<string, unknown>)[field] === true;
  } catch {
    return false;
  }
}

/** What Cycles draws on, as a Blender that said it is ready names it. */
function deviceOf(line: string): string {
  try {
    const device = (JSON.parse(line) as Record<string, unknown>)["device"];
    return typeof device === "string" ? device : "the processor";
  } catch {
    return "the processor";
  }
}

/** Why a start failed, twice ending while it drew, on a PC that draws. */
const endedDrawing =
  "Blender ended while drawing its first picture, twice; this PC has drawn with it before, so its graphics card may be busy. Try again once other 3D work has finished.";

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** One conversation's Blender, started when first needed and again after it ends. */
export class BlenderPipe {
  readonly #options: BlenderPipeOptions;
  #process: SessionProcess | undefined;
  /** The workspace the running or starting Blender was started with. */
  #workspace: string | undefined;
  #starting: Promise<SessionProcess> | undefined;
  #ending: SessionProcess | undefined;
  #sequence = 0;
  #drawnWithout: string | undefined;

  constructor(options: BlenderPipeOptions) {
    this.#options = options;
  }

  /** The Blender running now, if one is. */
  get running(): SessionProcess | undefined {
    return this.#process;
  }

  /** The workspace the running or starting Blender was started with. */
  get workspace(): string | undefined {
    return this.#workspace;
  }

  /**
   * What the person and the model are told of a PC whose graphics card
   * cannot draw, once a Blender has started there; nothing until then.
   */
  get drawnWithout(): string | undefined {
    return this.#drawnWithout;
  }

  /**
   * Blender, started in `workspace`. One started in another workspace
   * reaches only that one, so it is ended and Blender starts again.
   */
  async startedIn(workspace: string): Promise<SessionProcess> {
    for (;;) {
      const process = await this.#started(workspace);
      if (this.#workspace === workspace) return process;
      this.#process = undefined;
      this.#ending = process;
      process.end();
      await process.ended;
    }
  }

  /**
   * Sends one request, with the seconds it may run so the session can fit its
   * checks within them, and reads its answer, or why none came.
   */
  async exchange(
    process: SessionProcess,
    op: string,
    args: Readonly<Record<string, unknown>>,
    options: {
      readonly timeoutMs: number;
      /** The picture to draw after it, if any. */
      readonly preview: Readonly<Record<string, unknown>> | null;
      readonly signal?: AbortSignal;
    },
  ): Promise<BlenderAnswer | { readonly ending: Ending }> {
    const id = ++this.#sequence;
    process.send(
      JSON.stringify({
        id,
        op,
        args,
        preview: options.preview,
        seconds: options.timeoutMs / 1_000,
      }),
    );
    const line = await this.#race(
      process,
      process.next(),
      options.timeoutMs,
      options.signal,
    );
    if (endings.includes(line)) return { ending: line as Ending };
    try {
      const answer = JSON.parse(line) as BlenderAnswer;
      return answer.id === id ? answer : { ending: "ended" };
    } catch {
      return { ending: "ended" };
    }
  }

  /**
   * Ends a Blender whose answer did not come, and says why, with what the
   * command left behind and, when it ended on its own, what it printed. A
   * command that ran past `timeoutMs` is told that limit and how to keep
   * within it.
   */
  async ended(
    ending: Ending,
    process: SessionProcess,
    timeoutMs: number,
    leftBehind = "The change was not made.",
  ): Promise<string> {
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
        ? `The command ran past its time limit of ${duration(timeoutMs)}, so Blender was stopped. ${afterwards} To finish within the limit, do less in one call (fewer objects, frames or samples, or a smaller resolution), or split the work over several calls.`
        : ending === "stopped"
          ? `The command was stopped, and Blender with it. ${afterwards}`
          : `Blender stopped while working. ${afterwards}`;
    const printed = unexpected ? await process.printed() : "";
    this.#options.report(
      unexpected
        ? { status: "failed", reason: "Blender stopped unexpectedly." }
        : { status: "closed", reason: "Blender was stopped." },
    );
    return printed ? `${reason}\n${printed}` : reason;
  }

  /**
   * Runs one script in a Blender started for it alone in `workspace`, which
   * opens the scene file the arguments name, runs the script, saves the scene
   * when the script changed it, and is ended: nothing the script leaves in Python outlives it. The
   * session's own Blender, and the view, know nothing of it. Gives its
   * answer, or why none came, with what it printed when it ended on its own.
   */
  async sealedRun(
    workspace: string,
    args: Readonly<Record<string, unknown>>,
    options: { readonly timeoutMs: number; readonly signal?: AbortSignal },
  ): Promise<
    BlenderAnswer | { readonly ending: Ending; readonly printed: string }
  > {
    const deadline = Date.now() + options.timeoutMs;
    const left = () => Math.max(0, deadline - Date.now());
    const executable = await this.#options.blender();
    if (!executable) return { ok: false, error: notInstalled };
    let process: SessionProcess;
    try {
      process = await this.#options.launch({
        executable,
        script: this.#options.script,
        directory: this.#options.directory,
        workspace,
        sealed: true,
        ...(this.#options.drawing.onProcessor ? { processor: true } : {}),
      });
    } catch (error) {
      return {
        ok: false,
        error: `Blender could not start to run the script: ${message(error)}`,
      };
    }
    const ending = async (line: Ending) => ({
      ending: line,
      printed: line === "ended" ? await process.printed() : "",
    });
    try {
      for (;;) {
        const line = await this.#race(
          process,
          process.next(),
          left(),
          options.signal,
        );
        if (endings.includes(line)) return await ending(line as Ending);
        if (startLine(line, "ready")) break;
        if (!startLine(line, "warming")) return await ending("ended");
      }
      const answer = await this.exchange(process, "script", args, {
        timeoutMs: left(),
        preview: null,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      return "ending" in answer ? await ending(answer.ending) : answer;
    } finally {
      process.end();
      // Windows lets go of the scene file only once Blender has gone.
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        process.ended,
        new Promise((resolve) => {
          timer = setTimeout(resolve, 5_000);
        }),
      ]);
      clearTimeout(timer);
    }
  }

  /** Ends Blender, once a start under way has finished. */
  async close(): Promise<void> {
    // A start under way finishes first, so the Blender it starts is ended
    // here too, rather than outliving the session and what it ran in.
    await this.#starting?.catch(() => undefined);
    const process = this.#process;
    this.#process = undefined;
    if (process) {
      this.#ending = process;
      process.end();
      await process.ended;
    }
  }

  async #started(workspace: string): Promise<SessionProcess> {
    if (this.#process) return this.#process;
    this.#starting ??= this.#start(workspace).finally(() => {
      this.#starting = undefined;
    });
    return this.#starting;
  }

  async #start(workspace: string): Promise<SessionProcess> {
    const report = this.#options.report;
    const executable = await this.#options.blender();
    if (!executable) {
      report({ status: "failed", reason: notInstalled });
      throw new Error(notInstalled);
    }
    const drawing = this.#options.drawing;
    // A start while another conversation finds out how this PC draws waits
    // for its answer.
    await drawing.settled();
    report({ status: "starting" }, ["reason"]);
    if (drawing.onProcessor) return this.#onProcessor(executable, workspace);
    await mkdir(dirname(this.#options.warm), { recursive: true });
    for (let tried = 1; ; tried++) {
      const started = await this.#launched(executable, workspace, "card");
      if (started !== "ended drawing") return started;
      if (tried < drawingTries) continue;
      // Ended while drawing on the graphics card, again, before any Blender
      // drew in this run: a Blender of its own finds out whether it can.
      if (
        drawing.drew ||
        (await drawing.find(() => this.#probe(executable, workspace)))
      ) {
        report({ status: "failed", reason: endedDrawing });
        throw new Error(endedDrawing);
      }
      return this.#onProcessor(executable, workspace);
    }
  }

  /** A Blender that draws every picture with Cycles, on a PC whose graphics card cannot draw. */
  async #onProcessor(
    executable: string,
    workspace: string,
  ): Promise<SessionProcess> {
    const started = await this.#launched(executable, workspace, "processor");
    if (started !== "ended drawing") return started;
    this.#options.report({
      status: "failed",
      reason: "Blender did not start.",
    });
    throw new Error("Blender did not start.");
  }

  /**
   * Whether this PC's graphics card draws, as a Blender started for that
   * alone finds: it draws the warm-up picture, says whether it could, and
   * ends. One that ends while drawing it, or takes past the start's time,
   * cannot draw. One that ends before it begins to draw only failed to
   * start, and gives no answer.
   */
  async #probe(executable: string, workspace: string): Promise<boolean> {
    const report = this.#options.report;
    let process: SessionProcess;
    try {
      process = await this.#options.launch({
        executable,
        script: this.#options.script,
        directory: this.#options.directory,
        workspace,
        warm: this.#options.warm,
        probe: true,
      });
    } catch (error) {
      const reason = `Blender could not start: ${message(error)}`;
      report({ status: "failed", reason });
      throw new Error(reason, { cause: error });
    }
    try {
      const read = this.#reader(process);
      const first = await read();
      if (!startLine(first, "warming")) {
        const printed = await process.printed();
        report({ status: "failed", reason: "Blender did not start." });
        throw new Error(
          `Blender did not start.${printed ? `\n${printed}` : ""}`,
        );
      }
      return startLine(await read(), "drew");
    } finally {
      process.end();
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        process.ended,
        new Promise((resolve) => {
          timer = setTimeout(resolve, 5_000);
        }),
      ]);
      clearTimeout(timer);
    }
  }

  /**
   * Reads the lines a starting Blender sends, each within the start's time.
   * A line sent just before the end may be read after the end is seen: the
   * read already asked for is the one that gets it.
   */
  #reader(process: SessionProcess): () => Promise<string> {
    const startMs = this.#options.startTimeoutMs ?? 180_000;
    return async () => {
      const reading = process.next();
      const line = await this.#race(process, reading, startMs);
      return line === "ended" ? ((await reading) ?? "ended") : line;
    };
  }

  /**
   * One start: the Blender that is ready, or that it ended while drawing its
   * warm-up picture. On the graphics card it draws one; on the processor it
   * draws none, and the person is told how this PC draws.
   */
  async #launched(
    executable: string,
    workspace: string,
    on: "card" | "processor",
  ): Promise<SessionProcess | "ended drawing"> {
    const report = this.#options.report;
    let process: SessionProcess;
    try {
      this.#workspace = workspace;
      process = await this.#options.launch({
        executable,
        script: this.#options.script,
        directory: this.#options.directory,
        workspace,
        ...(on === "card"
          ? { warm: this.#options.warm }
          : { processor: true as const }),
      });
    } catch (error) {
      const reason = `Blender could not start: ${message(error)}`;
      report({ status: "failed", reason });
      throw new Error(reason, { cause: error });
    }
    const read = this.#reader(process);
    let first = await read();
    const warming = startLine(first, "warming");
    if (warming) first = await read();
    if (!startLine(first, "ready")) {
      process.end();
      if (warming && first === "ended") return "ended drawing";
      const printed = await process.printed();
      report({ status: "failed", reason: "Blender did not start." });
      throw new Error(`Blender did not start.${printed ? `\n${printed}` : ""}`);
    }
    if (warming) this.#options.drawing.drawn();
    if (on === "processor") {
      this.#drawnWithout = drawsWithout(deviceOf(first));
      report({ note: this.#drawnWithout });
    }
    this.#process = process;
    this.#options.started();
    void process.ended.then(() => {
      if (this.#process !== process) return;
      this.#process = undefined;
      if (this.#ending === process) return;
      report({
        status: "failed",
        working: false,
        reason: "Blender stopped unexpectedly.",
      });
    });
    report({ status: "open" }, ["reason"]);
    return process;
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
}
