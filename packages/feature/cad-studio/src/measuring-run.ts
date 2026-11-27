/**
 * The second run of a build, the harness alone, which the build owns. Started
 * beside the script's run, it loads build123d while the script runs, and
 * reads nothing of the run's until it is given its request: written whole,
 * under its name at once, only after the script's run has ended and handed
 * on its parts. A build that gives it no request, because the script failed,
 * handed nothing on or was stopped, or because the build was cancelled, stops
 * it; either way it has ended before the build answers.
 */

import { rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CadPython, CadRunOutcome } from "./cad-python.js";

export type MeasuringRun = {
  /** The folder it writes the answer and its files in. */
  readonly out: string;
  /** Starts it beside the script's run, to read `scripted` once given its request. */
  beside(scripted: string, timeoutMs: number): void;
  /**
   * Gives it its request and waits for its outcome; one not started beside
   * a script's run is started now, given `timeoutMs`.
   */
  measure(request: string, timeoutMs: number): Promise<CadRunOutcome>;
  /** Stops it if it was given no request, and waits for it to end. */
  end(): Promise<void>;
};

/**
 * What tells either run of a build where the kept font list is, and lets it
 * read the list, never change it.
 */
export function fontsGiven(fonts: string | undefined) {
  return fonts
    ? { arguments: ["--fonts", fonts], read: [fonts] }
    : { arguments: [], read: [] };
}

export function measuringRun(options: {
  readonly python: CadPython;
  readonly harness: string;
  /** The build's own folder, which it reads. */
  readonly run: string;
  /** The folder of the kept font list, which it reads. */
  readonly fonts?: string;
  readonly signal?: AbortSignal;
}): MeasuringRun {
  const { python, harness, run, signal } = options;
  const fonts = fontsGiven(options.fonts);
  const out = join(run, "out");
  const path = join(run, "request.json");
  const stop = new AbortController();
  const stopped = () => stop.abort();
  signal?.addEventListener("abort", stopped, { once: true });
  if (signal?.aborted) stop.abort();
  let running: Promise<CadRunOutcome> | undefined;
  let given = false;

  const start = (
    whenReady: boolean,
    read: readonly string[],
    timeoutMs: number,
  ) => {
    running = python.run({
      // Isolated: nothing of the workspace on its path, nor of its environment.
      arguments: [
        "-I",
        "-X",
        "utf8",
        harness,
        ...(whenReady ? ["--when-ready"] : []),
        ...fonts.arguments,
        path,
      ],
      cwd: out,
      read: [dirname(harness), ...read, run, ...fonts.read],
      write: [out],
      home: join(run, "measuring-home"),
      homeLastsOneRun: true,
      timeoutMs,
      signal: stop.signal,
    });
    return running;
  };

  return {
    out,
    beside(scripted, timeoutMs) {
      start(true, [scripted], timeoutMs);
    },
    async measure(request, timeoutMs) {
      if (!running) {
        await writeFile(path, request, "utf8");
        given = true;
        return start(false, [], timeoutMs);
      }
      // Whole, under its name at once: the run waiting for it never reads
      // part of it.
      const partial = `${path}.part`;
      await writeFile(partial, request, "utf8");
      await rename(partial, path);
      given = true;
      return running;
    },
    async end() {
      signal?.removeEventListener("abort", stopped);
      if (!given) stop.abort();
      await running?.catch(() => undefined);
    },
  };
}
