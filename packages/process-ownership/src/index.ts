/**
 * Structural containment for processes Zhiyin starts.
 *
 * Boundaries and invariants:
 * docs/architecture/features/process-ownership/README.md
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultOutputBytes,
  defaultOutputCharacters,
  fileEnds,
  outputCheckMs,
  OutputEnds,
} from "./output.js";
import type { ProcessContainer } from "./windows.js";

export type {
  ContainedProcess,
  ContainedProcessOptions,
  ContainmentAvailability,
  ProcessContainer,
} from "./windows.js";
export { containmentAvailability, openProcessContainer } from "./windows.js";

export type ProcessContainment = {
  open(): ProcessContainer;
};

export type ProcessRun = {
  readonly exitCode: number | null;
  /** The start and end of each stream, when the middle had to be left out. */
  readonly stdout: string;
  readonly stderr: string;
  /**
   * Why the run was ended early: it ran too long, it was stopped, or it
   * printed more than a run may.
   */
  readonly ending?: "timeout" | "stopped" | "outputLimit";
  readonly failure?: "containment" | "start";
};

export type RunProcess = (options: {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly containment?: ProcessContainment;
  /** Everything the program is given; absent, it inherits Zhiyin's own. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
  /** Characters kept of each stream, split between its start and its end. */
  readonly maximumOutputCharacters?: number;
  /** Bytes printed across both streams before the run is stopped. */
  readonly maximumOutputBytes?: number;
}) => Promise<ProcessRun>;

type RunOptions = Parameters<RunProcess>[0];
type Ending = NonNullable<ProcessRun["ending"]>;

async function killTree(pid: number): Promise<void> {
  if (process.platform !== "win32") {
    try {
      process.kill(pid);
    } catch {
      // The process already ended.
    }
    return;
  }
  await new Promise<void>((resolve) => {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.on("error", () => resolve());
    killer.on("close", () => resolve());
  });
}

/**
 * Ends a run at the first of its deadline, a stop request, or whatever else
 * calls `end`. `stop` ends the process tree; it runs once.
 */
function endings(options: RunOptions, stop: () => void) {
  let ending: Ending | undefined;
  const end = (why: Ending) => {
    if (ending) return;
    ending = why;
    stop();
  };
  const timer = setTimeout(() => end("timeout"), options.timeoutMs);
  const onAbort = () => end("stopped");
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) end("stopped");
  return {
    ended: (): Ending | undefined => ending,
    end,
    release() {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    },
  };
}

/** Bytes kept at each end of a stream. */
function edgeOf(options: RunOptions): number {
  return Math.floor(
    (options.maximumOutputCharacters ?? defaultOutputCharacters) / 2,
  );
}

/** The shared argv-based process path used by features above this platform. */
export const runProcess: RunProcess = async (options) => {
  if (options.signal?.aborted)
    return { exitCode: null, stdout: "", stderr: "", ending: "stopped" };

  let container: ProcessContainer | undefined;
  try {
    container = options.containment?.open();
  } catch {
    return {
      exitCode: null,
      stdout: "",
      stderr: "",
      failure: "containment",
    };
  }
  return container ? runContained(container, options) : runUncontained(options);
};

async function runContained(
  container: ProcessContainer,
  options: RunOptions,
): Promise<ProcessRun> {
  const limit = options.maximumOutputBytes ?? defaultOutputBytes;
  const directory = await mkdtemp(join(tmpdir(), "zhiyin-process-"));
  const stdoutFile = join(directory, "stdout.txt");
  const stderrFile = join(directory, "stderr.txt");
  try {
    let child;
    try {
      child = container.launch({
        executable: options.executable,
        arguments: options.arguments,
        cwd: options.cwd,
        stdout: stdoutFile,
        stderr: stderrFile,
        ...(options.environment ? { environment: options.environment } : {}),
      });
    } catch {
      return {
        exitCode: null,
        stdout: "",
        stderr: "",
        failure: "containment",
      };
    }
    // Closing the job ends the whole tree, however the run is ended.
    const run = endings(options, () => container.close());
    // The output goes to files, so it is measured there: past the limit the
    // tree is ended while it runs, before the disk fills.
    const measure = setInterval(() => {
      void Promise.all([stat(stdoutFile), stat(stderrFile)])
        .then(([out, err]) => {
          if (out.size + err.size > limit) run.end("outputLimit");
        })
        .catch(() => undefined);
    }, outputCheckMs);
    let exitCode: number | null = null;
    let failure: ProcessRun["failure"];
    try {
      exitCode = await child.wait();
    } catch {
      failure = run.ended() ? undefined : "start";
    } finally {
      clearInterval(measure);
      run.release();
      container.close();
    }
    const [stdout, stderr] = await Promise.all([
      fileEnds(stdoutFile, edgeOf(options)),
      fileEnds(stderrFile, edgeOf(options)),
    ]);
    const ending = run.ended();
    return {
      exitCode,
      stdout,
      stderr,
      ...(ending ? { ending } : {}),
      ...(failure ? { failure } : {}),
    };
  } finally {
    container.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function runUncontained(options: RunOptions): Promise<ProcessRun> {
  const limit = options.maximumOutputBytes ?? defaultOutputBytes;
  return new Promise<ProcessRun>((resolve) => {
    const child = spawn(options.executable, [...options.arguments], {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...(options.environment ? { env: options.environment } : {}),
    });
    const stdout = new OutputEnds(edgeOf(options));
    const stderr = new OutputEnds(edgeOf(options));
    const run = endings(options, () => {
      if (child.pid !== undefined) void killTree(child.pid);
    });
    const receive = (ends: OutputEnds) => (chunk: Buffer) => {
      ends.add(chunk);
      if (stdout.total + stderr.total > limit) run.end("outputLimit");
    };
    child.stdout?.on("data", receive(stdout));
    child.stderr?.on("data", receive(stderr));
    child.on("error", () => {
      run.release();
      resolve({ exitCode: null, stdout: "", stderr: "", failure: "start" });
    });
    child.on("close", (exitCode) => {
      run.release();
      const ending = run.ended();
      resolve({
        exitCode,
        stdout: stdout.text(),
        stderr: stderr.text(),
        ...(ending ? { ending } : {}),
      });
    });
  });
}
