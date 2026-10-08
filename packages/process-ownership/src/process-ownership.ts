import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Writable } from "node:stream";
import {
  defaultOutputBytes,
  defaultOutputCharacters,
  fileEnds,
  outputCheckMs,
  OutputEnds,
} from "./output.js";
import type { ProcessContainer } from "./windows.js";

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
  /**
   * Handed the whole of each stream as a file once the run has ended, up to
   * the output limit, so a caller can keep what was left out of the middle.
   * The files are removed once this returns.
   */
  readonly keep?: (files: {
    readonly stdout: string;
    readonly stderr: string;
  }) => Promise<void>;
  /**
   * Called once the program is running, with a way to read the ends of what
   * it has printed so far, bounded as the finished run's are.
   */
  readonly onStart?: (live: LiveRun) => void;
}) => Promise<ProcessRun>;

export type LiveRun = {
  readonly printed: () => Promise<{
    readonly stdout: string;
    readonly stderr: string;
  }>;
};

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
    options.onStart?.({
      printed: async () => {
        const [stdout, stderr] = await Promise.all([
          fileEnds(stdoutFile, edgeOf(options)),
          fileEnds(stderrFile, edgeOf(options)),
        ]);
        return { stdout, stderr };
      },
    });
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
    await keptWhole(options, stdoutFile, stderrFile);
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
    await removeOutputFolder(directory);
  }
}

/**
 * Removes a run's output files. A stopped tree's processes can hold them for a
 * moment after the run has answered, so removal is retried; a folder left
 * behind in the temporary directory is not the run's failure.
 */
async function removeOutputFolder(directory: string): Promise<void> {
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 50,
  }).catch(() => undefined);
}

/** The caller's copy of the whole output; a failure to keep it is not the run's. */
async function keptWhole(
  options: RunOptions,
  stdout: string,
  stderr: string,
): Promise<void> {
  await options.keep?.({ stdout, stderr }).catch(() => undefined);
}

/**
 * Without containment the streams arrive in pieces rather than as files, so
 * they are written to files as they arrive when the caller wants them whole.
 */
async function runUncontained(options: RunOptions): Promise<ProcessRun> {
  if (!options.keep) return runStreams(options);
  const directory = await mkdtemp(join(tmpdir(), "zhiyin-process-"));
  const files = {
    stdout: join(directory, "stdout.txt"),
    stderr: join(directory, "stderr.txt"),
  };
  const out = createWriteStream(files.stdout);
  const err = createWriteStream(files.stderr);
  try {
    const run = await runStreams(options, { stdout: out, stderr: err });
    await Promise.all(
      [out, err].map(
        (stream) => new Promise<void>((resolve) => stream.end(() => resolve())),
      ),
    );
    await keptWhole(options, files.stdout, files.stderr);
    return run;
  } finally {
    out.destroy();
    err.destroy();
    await removeOutputFolder(directory);
  }
}

function runStreams(
  options: RunOptions,
  copies?: { readonly stdout: Writable; readonly stderr: Writable },
): Promise<ProcessRun> {
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
    options.onStart?.({
      printed: async () => ({ stdout: stdout.text(), stderr: stderr.text() }),
    });
    const receive = (ends: OutputEnds, copy?: Writable) => (chunk: Buffer) => {
      const before = stdout.total + stderr.total;
      ends.add(chunk);
      // A piece that passes the limit is kept up to it, so one large write
      // does not take with it everything it carried.
      if (before < limit) copy?.write(chunk.subarray(0, limit - before));
      if (stdout.total + stderr.total > limit) run.end("outputLimit");
    };
    child.stdout?.on("data", receive(stdout, copies?.stdout));
    child.stderr?.on("data", receive(stderr, copies?.stderr));
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
