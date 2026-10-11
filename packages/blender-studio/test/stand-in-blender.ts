import { writeFile } from "node:fs/promises";
import type {
  LaunchSession,
  SessionLaunchOptions,
  SessionProcess,
} from "../src/index.js";

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
};

/**
 * What a stand-in Blender answers to one request: an answer, `"silent"` to
 * never answer, or `"exit"` to stop as a crashing Blender would.
 */
export type Behaviour = (
  request: Request,
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
]);

/** A picture's bytes, as the stand-in "renders" them. */
export const pictureBytes = Buffer.from("not really a jpeg");

/**
 * A Blender stand-in speaking the session's protocol. By default it does what
 * it is asked, and draws a preview when asked for one.
 */
export function standInBlender(
  behaviour?: Behaviour,
  options: { ready?: boolean } = {},
) {
  const launches: SessionLaunchOptions[] = [];
  const requests: Request[] = [];
  const ended: boolean[] = [];
  const launch: LaunchSession = async (launchOptions) => {
    launches.push(launchOptions);
    const index = ended.push(false) - 1;
    const lines: string[] = [];
    let waiting: ((line: string | undefined) => void) | undefined;
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const push = (line: string) => {
      if (ended[index]) return;
      if (waiting) {
        const wake = waiting;
        waiting = undefined;
        wake(line);
      } else lines.push(line);
    };
    const end = () => {
      if (ended[index]) return;
      ended[index] = true;
      waiting?.(undefined);
      finish();
    };
    if (options.ready !== false) push(JSON.stringify({ ready: true }));
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
                .then(() => behaviour(request))
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
              ...answer,
              ...(preview ? { preview } : {}),
            }),
          );
        })();
      },
      next: () =>
        lines.length
          ? Promise.resolve(lines.shift())
          : ended[index]
            ? Promise.resolve(undefined)
            : new Promise((resolve) => {
                waiting = resolve;
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
