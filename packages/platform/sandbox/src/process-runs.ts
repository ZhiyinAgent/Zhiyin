import { spawn } from "node:child_process";
import { closeSync, createWriteStream, openSync } from "node:fs";
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
import { childEnvironment } from "./child-environment.js";
import {
  confine,
  containerOf,
  networkOf,
  type Confined,
  type Confinement,
} from "./confinement.js";
import { containerHold, enterContainer } from "./container-holds.js";
import type { ProxyRoute } from "./egress/dial.js";
import type { FurtherHosts, HostReach } from "./egress/host-proxy.js";
import {
  namesHosts,
  startRunNetwork,
  withoutProxies,
  type RunNetwork,
} from "./egress/run-network.js";
import {
  showPort,
  shownPortRelay,
  type ShownPort,
} from "./egress/shown-ports.js";
import {
  openPipes,
  type OpenPipes,
  type PipeOpening,
} from "./pipe-openings.js";
import { windowsEnvironment } from "./windows-environment.js";

export type ProcessContainment = {
  open(): ProcessContainer;
  /**
   * How this computer reaches a URL, as Chromium would choose: the way the
   * proxy of a run that names hosts goes out. Absent, it goes out directly.
   */
  readonly route?: ProxyRoute;
};

export type ProcessRun = {
  /** How it exited on its own; none when it was ended early, which `ending` says. */
  readonly exitCode: number | null;
  /** The start and end of each stream, when the middle had to be left out. */
  readonly stdout: string;
  readonly stderr: string;
  /**
   * Why the run was ended early: it ran too long, it was stopped, or it
   * printed more than a run may.
   */
  readonly ending?: "timeout" | "stopped" | "outputLimit";
  readonly failure?: "containment" | "confinement" | "start";
  /** Why a confined run could not start, when a folder could not be given. */
  readonly reason?: string;
  /**
   * For a confined run that names hosts: each of the first hundred hosts it
   * asked for, with what it sent and received, or why it was refused or could
   * not be reached.
   */
  readonly network?: readonly HostReach[];
  /** What went to the hosts past those hundred, counted together, when any. */
  readonly furtherHosts?: FurtherHosts;
};

export type RunProcess = (options: {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly containment?: ProcessContainment;
  /**
   * Confined, the program and what it starts reach only the folders named and
   * the hosts named, through Zhiyin's proxy. Only a contained run can be
   * confined, so a confined run without containment is refused.
   */
  readonly confinement?: Confinement;
  /**
   * Everything the program is given; absent, it inherits Zhiyin's own. Either
   * way, without a model key Zhiyin was given.
   */
  readonly environment?: Readonly<Record<string, string | undefined>>;
  /** A file the program reads as its standard input; absent, it reads nothing. */
  readonly input?: string;
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
  /**
   * For a confined run: pipes only its container may open, each named to the
   * program in its variable, whose connections are handed to the caller.
   */
  readonly openings?: readonly PipeOpening[];
  /**
   * For a confined run: ports of its container shown on this computer's
   * loopback while it runs, inward only. Where each is reached is in `LiveRun`.
   */
  readonly shownPorts?: readonly number[];
}) => Promise<ProcessRun>;

export type LiveRun = {
  readonly printed: () => Promise<{
    readonly stdout: string;
    readonly stderr: string;
  }>;
  /** Each port shown, and where this computer reaches it. */
  readonly ports: readonly ShownPort[];
};

type RunOptions = Parameters<RunProcess>[0];
type Ending = NonNullable<ProcessRun["ending"]>;

async function killTree(pid: number): Promise<void> {
  await new Promise<void>((resolve) => {
    // By its full path: a program named taskkill earlier in the search path,
    // or in the working folder, must not be what runs.
    const taskkill = join(
      process.env["SystemRoot"] ?? "C:\\Windows",
      "System32",
      "taskkill.exe",
    );
    const killer = spawn(taskkill, ["/pid", String(pid), "/T", "/F"], {
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
  if (options.confinement && !options.containment)
    return { exitCode: null, stdout: "", stderr: "", failure: "containment" };
  if (
    !options.confinement &&
    (options.openings?.length || options.shownPorts?.length)
  )
    return {
      exitCode: null,
      stdout: "",
      stderr: "",
      failure: "confinement",
      reason: "Only a confined run is given pipes or shown ports.",
    };

  let confined: Confined | undefined;
  try {
    if (options.confinement) confined = await confine(options.confinement);
  } catch (error) {
    return {
      exitCode: null,
      stdout: "",
      stderr: "",
      failure: "confinement",
      reason: error instanceof Error ? error.message : String(error),
    };
  }

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
  if (container) return runContained(container, options, confined);
  return runUncontained(options);
};

async function runContained(
  container: ProcessContainer,
  options: RunOptions,
  confined: Confined | undefined,
): Promise<ProcessRun> {
  const limit = options.maximumOutputBytes ?? defaultOutputBytes;
  const directory = await mkdtemp(join(tmpdir(), "zhiyin-process-"));
  const stdoutFile = join(directory, "stdout.txt");
  const stderrFile = join(directory, "stderr.txt");
  let network: RunNetwork | undefined;
  let pipes: OpenPipes | undefined;
  const shown: { readonly shown: ShownPort; close(): Promise<void> }[] = [];
  // A hold on the container suspends this run's processes too.
  const name = confined ? containerOf(confined) : undefined;
  const leave = name ? enterContainer(name, container) : undefined;
  try {
    if (confined)
      try {
        const { container: sid, home } = networkOf(confined);
        if (options.openings?.length)
          pipes = await openPipes(sid, options.openings);
        for (const [at, port] of (options.shownPorts ?? []).entries()) {
          const each = await showPort(sid, port);
          shown.push(each);
          // Started before the program, so a server it starts is reached as
          // soon as it listens.
          const relay = shownPortRelay(each.pipe, port);
          container.launch({
            executable: relay.executable,
            arguments: relay.arguments,
            cwd: home,
            stdout: join(directory, `port-${at}-stdout.txt`),
            stderr: join(directory, `port-${at}-stderr.txt`),
            environment: windowsEnvironment(),
            confined,
          });
        }
      } catch (error) {
        return {
          exitCode: null,
          stdout: "",
          stderr: "",
          failure: "confinement",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    if (namesHosts(confined))
      try {
        network = await startRunNetwork(
          container,
          confined,
          options.containment?.route,
          {
            stdout: join(directory, "relay-stdout.txt"),
            stderr: join(directory, "relay-stderr.txt"),
          },
        );
      } catch (error) {
        return {
          exitCode: null,
          stdout: "",
          stderr: "",
          failure: "confinement",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    // A confined program is told of no proxy but Zhiyin's, the only one it
    // can reach.
    const told = network
      ? network.environment(options.environment ?? process.env)
      : confined
        ? withoutProxies(options.environment ?? process.env)
        : options.environment;
    const environment =
      pipes && told ? { ...told, ...pipes.environment } : told;
    // The last look at the holds is right before the launch, with no wait
    // between, so a hold that begins after finds the program in the container.
    for (
      let hold = name ? containerHold(name) : undefined;
      hold;
      hold = containerHold(name!)
    )
      await hold;
    let child;
    try {
      child = container.launch({
        executable: options.executable,
        arguments: options.arguments,
        cwd: options.cwd,
        stdout: stdoutFile,
        stderr: stderrFile,
        ...(options.input ? { input: options.input } : {}),
        ...(environment ? { environment } : {}),
        ...(confined ? { confined } : {}),
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
      ports: shown.map((each) => each.shown),
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
    const furtherHosts = network?.further();
    return {
      // A process ended from outside exits with whatever code Windows gives it.
      exitCode: ending ? null : exitCode,
      stdout,
      stderr,
      ...(ending ? { ending } : {}),
      ...(failure ? { failure } : {}),
      ...(network ? { network: network.reached() } : {}),
      ...(furtherHosts ? { furtherHosts } : {}),
    };
  } finally {
    container.close();
    leave?.();
    await network?.close();
    await pipes?.close();
    await Promise.all(shown.map((each) => each.close()));
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
    const input = options.input ? openSync(options.input, "r") : undefined;
    const child = spawn(options.executable, [...options.arguments], {
      cwd: options.cwd,
      windowsHide: true,
      stdio: [input ?? "ignore", "pipe", "pipe"],
      env: childEnvironment(options.environment),
    });
    // The program holds its own copy once it starts.
    if (input !== undefined) closeSync(input);
    const stdout = new OutputEnds(edgeOf(options));
    const stderr = new OutputEnds(edgeOf(options));
    const run = endings(options, () => {
      if (child.pid !== undefined) void killTree(child.pid);
    });
    options.onStart?.({
      printed: async () => ({ stdout: stdout.text(), stderr: stderr.text() }),
      ports: [],
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
        exitCode: ending ? null : exitCode,
        stdout: stdout.text(),
        stderr: stderr.text(),
        ...(ending ? { ending } : {}),
      });
    });
  });
}
