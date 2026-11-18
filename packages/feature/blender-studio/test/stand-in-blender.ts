import { writeFile } from "node:fs/promises";
import type {
  LaunchSession,
  SessionLaunchOptions,
  SessionProcess,
} from "../src/index.js";
import recorded from "./blender-commands.json" with { type: "json" };

type Request = {
  readonly id: number;
  readonly op: string;
  readonly args: Record<string, unknown>;
  readonly preview: null | {
    readonly path: string;
    readonly view: string;
    readonly yaw: number;
    readonly pitch: number;
    readonly zoom: number;
    readonly width: number;
    readonly height: number;
    readonly quick?: boolean;
  };
  /** How long the request may run before Blender is stopped. */
  readonly seconds: number;
};

/**
 * What a stand-in Blender answers to one request: an answer, `"silent"` to
 * never answer, or `"exit"` to stop as a crashing Blender would.
 */
export type Behaviour = (
  request: Request,
  /** Which Blender the request reached, counted from 0 in launch order. */
  blender?: number,
) =>
  | Record<string, unknown>
  | "silent"
  | "exit"
  | Promise<Record<string, unknown> | "silent" | "exit">;

const changing = new Set([
  "open",
  "add",
  "edit",
  "shape",
  "material",
  "camera",
  "lighting",
  "script",
  "after_script",
]);

/** What each command does to the scene, as Blender says in every answer and as its session starts. */
const kindOf = (op: string) =>
  (recorded as Record<string, { kind: string } | undefined>)[op]?.kind ??
  "reads";

/** A picture's bytes, as the stand-in "renders" them. */
export const pictureBytes = Buffer.from("not really a jpeg");

/**
 * A Blender stand-in speaking the session's protocol. By default it does what
 * it is asked, and draws a preview when asked for one. It says it is drawing
 * its warm-up picture first; one that `cannotDraw` ends there, as Blender
 * does on a PC whose graphics card cannot draw, and one started on the
 * processor draws none and starts. One started to find out whether it draws
 * says so and ends, or ends while drawing. One that `endsAtOnce`
 * ends before saying anything, and one that `endsWhenReady` ends just after
 * saying it is ready. Through a `slowPipe`, each line reaches its
 * reader a moment after it was sent, so an end can be seen before the last
 * lines sent ahead of it, as a real process's can.
 */
export function standInBlender(
  behaviour?: Behaviour,
  options: {
    ready?: boolean;
    cannotDraw?: boolean;
    /** Which starts, counted from 0, end while drawing, as a Blender under load can. */
    endsDrawing?: (start: number) => boolean;
    endsAtOnce?: boolean;
    endsWhenReady?: boolean;
    slowPipe?: boolean;
  } = {},
) {
  const launches: SessionLaunchOptions[] = [];
  const requests: Request[] = [];
  const ended: boolean[] = [];
  const launch: LaunchSession = async (launchOptions) => {
    launches.push(launchOptions);
    const index = ended.push(false) - 1;
    const lines: string[] = [];
    // Reads are answered in the order they were asked, as a line reader's.
    const waiting: ((line: string | undefined) => void)[] = [];
    /** Whether every line sent has been read or is waiting to be. */
    let drained = false;
    let inTransit = Promise.resolve();
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const arrive = (line: string) => {
      const wake = waiting.shift();
      if (wake) wake(line);
      else lines.push(line);
    };
    const push = (line: string) => {
      if (ended[index]) return;
      if (!options.slowPipe) return arrive(line);
      inTransit = inTransit
        .then(() => new Promise<void>((resolve) => setImmediate(resolve)))
        .then(() => arrive(line));
    };
    const drain = () => {
      drained = true;
      for (const wake of waiting.splice(0)) wake(undefined);
    };
    const end = () => {
      if (ended[index]) return;
      ended[index] = true;
      if (options.slowPipe) void inTransit.then(drain);
      else drain();
      finish();
    };
    const endsDrawing = options.cannotDraw || options.endsDrawing?.(index);
    if (options.endsAtOnce) end();
    else if (launchOptions.processor) {
      // Drawing on the processor, it draws no warm-up picture.
      if (options.ready !== false)
        push(JSON.stringify({ ready: true, device: "the processor" }));
    } else if (launchOptions.probe) {
      push(JSON.stringify({ warming: true }));
      if (!endsDrawing) push(JSON.stringify({ drew: true }));
      end();
    } else {
      if (options.ready !== false) push(JSON.stringify({ warming: true }));
      if (endsDrawing) end();
      else if (options.ready !== false) push(JSON.stringify({ ready: true }));
    }
    if (options.endsWhenReady) end();
    const process: SessionProcess = {
      send(line) {
        const request = JSON.parse(line) as Request;
        requests.push(request);
        void (async () => {
          // As Blender does: what fails, such as writing a picture into a
          // folder a finished test has removed, is answered as an error.
          const failed = (error: unknown): Record<string, unknown> => ({
            ok: false,
            error: String(error),
          });
          const answer = behaviour
            ? await Promise.resolve()
                .then(() => behaviour(request, index))
                .catch(failed)
            : { ok: true, text: `did ${request.op}` };
          if (answer === "silent") return;
          if (answer === "exit") return end();
          let preview: Record<string, unknown> | undefined;
          if (request.preview && answer["ok"] !== false && !answer["preview"]) {
            const written = await writeFile(request.preview.path, pictureBytes)
              .then(() => undefined)
              .catch(failed);
            if (written)
              return push(JSON.stringify({ id: request.id, ...written }));
            preview = {
              path: request.preview.path,
              width: request.preview.width,
              height: request.preview.height,
              view: request.preview.view,
            };
          }
          push(
            JSON.stringify({
              id: request.id,
              file: "scene.blend",
              notes: [],
              // As Blender does: a command that changes the scene says so.
              changed: changing.has(request.op) && answer["ok"] !== false,
              kind: kindOf(request.op),
              ...answer,
              ...(preview ? { preview } : {}),
            }),
          );
        })();
      },
      next: () =>
        lines.length
          ? Promise.resolve(lines.shift())
          : drained
            ? Promise.resolve(undefined)
            : new Promise((resolve) => {
                waiting.push(resolve);
              }),
      ended: finished,
      end,
      printed: async () => "Blender's last words",
    };
    return process;
  };
  return {
    launch,
    launches,
    requests,
    /** Whether each launched Blender has ended, in launch order. */
    ended,
    ops: () => requests.map((r) => r.op),
  };
}
