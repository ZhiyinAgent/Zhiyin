/**
 * The Windows side of containment: a kill-on-close Job Object, and a process
 * started suspended inside it, with its output going to files, the
 * environment it was handed, and, when asked, pipes no other process can open.
 */

import { randomUUID } from "node:crypto";
import { Socket } from "node:net";
import type { Readable, Writable } from "node:stream";
import koffi from "koffi";
import {
  CREATE_ALWAYS,
  CREATE_NO_WINDOW,
  CREATE_SUSPENDED,
  CREATE_UNICODE_ENVIRONMENT,
  EXTENDED_STARTUPINFO_PRESENT,
  FILE_ATTRIBUTE_NORMAL,
  FILE_FLAG_FIRST_PIPE_INSTANCE,
  FILE_FLAG_OVERLAPPED,
  FILE_READ_ATTRIBUTES,
  FILE_SHARE_READ,
  GENERIC_READ,
  GENERIC_WRITE,
  INFINITE,
  OPEN_EXISTING,
  PIPE_ACCESS_INBOUND,
  PIPE_ACCESS_OUTBOUND,
  STARTF_USESTDHANDLES,
  STILL_ACTIVE,
  closeEach,
  invalid,
  win32,
} from "./kernel32.js";
import type { Win32 } from "./kernel32.js";

export type ContainmentAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

export interface ProcessContainer {
  /**
   * Puts a process, and everything it starts afterwards, inside this
   * container. Throws if the process cannot be reached — a caller that cannot
   * contain what it started must not run it.
   */
  contain(pid: number): void;
  /** Starts a process suspended, assigns it, then permits its first instruction. */
  launch(options: ContainedProcessOptions): ContainedProcess;
  /**
   * Terminates everything in the container. Idempotent. The same termination
   * happens without this call if the owning process dies, which is the point:
   * containment survives our own crash.
   */
  close(): void;
}

export type ContainedProcessOptions = {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly stdout: string;
  readonly stderr: string;
  /**
   * Everything the process is given, replacing ours. Absent, it inherits
   * Zhiyin's own environment.
   */
  readonly environment?: Readonly<Record<string, string | undefined>>;
  /**
   * Asks for two pipes between Zhiyin and the process, besides its standard
   * streams. The process can learn which handles are its ends only from its
   * command line, so this turns their values into arguments, appended after
   * `arguments`.
   */
  readonly pipes?: (ends: ProcessPipeEnds) => readonly string[];
};

/** The process's own ends of its pipes, as handle values in decimal. */
type ProcessPipeEnds = {
  readonly reads: string;
  readonly writes: string;
};

export type ProcessPipes = {
  readonly toProcess: Writable;
  readonly fromProcess: Readable;
};

export type ContainedProcess = {
  readonly pid: number;
  /** Present when pipes were asked for. No other process can open them. */
  readonly pipes?: ProcessPipes;
  wait(): Promise<number>;
};

/**
 * One argument as Windows splits a command line back into arguments:
 * backslashes before a quote, or before the closing quote, are doubled and the
 * quote escaped; any other backslash stands as it is. One pass over the value.
 */
function quoteWindowsArgument(value: string): string {
  let quoted = '"';
  let backslashes = 0;
  for (const character of value) {
    if (character === "\\") {
      backslashes += 1;
      continue;
    }
    quoted +=
      character === '"'
        ? `${"\\".repeat(backslashes * 2 + 1)}"`
        : `${"\\".repeat(backslashes)}${character}`;
    backslashes = 0;
  }
  return `${quoted}${"\\".repeat(backslashes * 2)}"`;
}

function writableCommandLine(
  executable: string,
  args: readonly string[],
): Buffer {
  return Buffer.from(
    `${[executable, ...args].map(quoteWindowsArgument).join(" ")}\0`,
    "utf16le",
  );
}

/**
 * An environment as `CreateProcessW` reads it: `name=value` strings in UTF-16,
 * each ending in a null and the block in one more, sorted by name without
 * regard to case (Changing Environment Variables, Win32 docs).
 */
function environmentBlock(
  environment: Readonly<Record<string, string | undefined>>,
): Buffer {
  const entries = Object.entries(environment)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([left], [right]) => {
      const a = left.toUpperCase();
      const b = right.toUpperCase();
      return a < b ? -1 : a > b ? 1 : 0;
    });
  const strings = entries.map(([name, value]) => `${name}=${value}\0`).join("");
  return Buffer.from(`${strings || "\0"}\0`, "utf16le");
}

/**
 * Bytes a console program wrote in the console's own code page, as text. The
 * Windows conversion knows every code page, including the OEM ones a browser's
 * decoder does not. Undefined where there is no such conversion to ask.
 */
export function oemText(bytes: Buffer): string | undefined {
  if (process.platform !== "win32" || !bytes.length) return undefined;
  try {
    const api = win32();
    const wide = Buffer.alloc(bytes.length * 2);
    const written = api.oemToWide(bytes, wide);
    return written > 0 ? wide.toString("utf16le", 0, written * 2) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether processes can be contained here. A caller that starts subprocesses
 * asks this first and stays unavailable when the answer is no, rather than
 * running work it cannot clean up.
 */
export function containmentAvailability(): ContainmentAvailability {
  if (process.platform !== "win32") {
    return {
      available: false,
      reason: "Process containment is implemented for Windows only.",
    };
  }
  try {
    const container = openProcessContainer();
    container.close();
    return { available: true };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * One pipe, its process end opened by us before anything else can open it.
 * The name cannot be guessed or taken first, the pipe has one instance and
 * takes local clients only: once our own open of the far end succeeds, no
 * other process can open the pipe. If something got there first, ours fails
 * and so does the launch.
 */
function pipe(
  api: Win32,
  direction: "toProcess" | "fromProcess",
  inheritable: object,
): { readonly ours: unknown; readonly theirs: unknown } {
  const name = `\\\\.\\pipe\\zhiyin-${process.pid}-${randomUUID()}`;
  const ours = api.createNamedPipe(
    name,
    (direction === "toProcess" ? PIPE_ACCESS_OUTBOUND : PIPE_ACCESS_INBOUND) |
      FILE_FLAG_OVERLAPPED |
      FILE_FLAG_FIRST_PIPE_INSTANCE,
  );
  if (invalid(ours))
    throw new Error("Process containment could not create a pipe.");
  const theirs = api.createFile(
    name,
    direction === "toProcess"
      ? GENERIC_READ
      : GENERIC_WRITE | FILE_READ_ATTRIBUTES,
    0,
    inheritable,
    OPEN_EXISTING,
    FILE_ATTRIBUTE_NORMAL,
  );
  if (invalid(theirs)) {
    api.closeHandle(ours);
    throw new Error("Process containment could not open its own pipe.");
  }
  return { ours, theirs };
}

let hostDescriptor: ((handle: unknown) => number) | undefined;

/**
 * Our pipe ends as streams, or closed if they cannot be. Node opens a stream
 * only on a C runtime descriptor, and only on one from the runtime libuv
 * itself uses, which is the host executable's. Node and Electron both export
 * libuv's `uv_open_osfhandle` to native addons, which is what makes it
 * reachable. Overlapped named pipes, because libuv mishandles a second write
 * to an anonymous one (`EAGAIN`).
 */
function pipeStreams(ours: readonly unknown[]): ProcessPipes {
  hostDescriptor ??= koffi
    .load(process.execPath)
    .func("int uv_open_osfhandle(void*)") as (handle: unknown) => number;
  const [toProcess, fromProcess] = ours;
  const writes = hostDescriptor(toProcess);
  if (writes < 0) {
    closeEach(win32(), ours);
    throw new Error("Process containment could not stream a pipe.");
  }
  const writer = new Socket({ fd: writes, readable: false, writable: true });
  const reads = hostDescriptor(fromProcess);
  if (reads < 0) {
    writer.destroy();
    win32().closeHandle(fromProcess);
    throw new Error("Process containment could not stream a pipe.");
  }
  return {
    toProcess: writer,
    fromProcess: new Socket({ fd: reads, readable: true, writable: false }),
  };
}

export type ContainerOptions = {
  /**
   * The most memory, in bytes, any one process inside may commit. A process
   * that asks for more is refused it, and ends; nothing outside is touched.
   */
  readonly processMemoryLimit?: number;
};

export function openProcessContainer(
  options: ContainerOptions = {},
): ProcessContainer {
  const api = win32();
  const job = api.createJob();
  if (!job) throw new Error("Process containment could not create a job.");
  if (!api.setLimits(job, options.processMemoryLimit)) {
    api.closeHandle(job);
    throw new Error("Process containment could not set its job limits.");
  }
  let closed = false;
  return {
    contain(pid: number) {
      if (closed) throw new Error("This process container is already closed.");
      const target = api.openProcess(pid);
      if (!target)
        throw new Error(`Process ${pid} could not be opened for containment.`);
      try {
        if (!api.assign(job, target))
          throw new Error(`Process ${pid} could not be contained.`);
      } finally {
        api.closeHandle(target);
      }
    },
    launch(options: ContainedProcessOptions): ContainedProcess {
      if (closed) throw new Error("This process container is already closed.");
      const security = {
        nLength: api.securityAttributesSize,
        lpSecurityDescriptor: null,
        bInheritHandle: true,
      };
      // What the process inherits: closed here once it holds its own copies.
      const given: unknown[] = [];
      // Our ends of its pipes: closed here only if it never runs.
      const kept: unknown[] = [];
      let ends: ProcessPipeEnds | undefined;
      let attributes: ReturnType<Win32["inheritOnly"]> | undefined;
      const information: Record<string, unknown> = {};
      let created = false;
      try {
        given.push(
          api.createFile(
            options.stdout,
            GENERIC_WRITE,
            FILE_SHARE_READ,
            security,
            CREATE_ALWAYS,
            FILE_ATTRIBUTE_NORMAL,
          ),
          api.createFile(
            options.stderr,
            GENERIC_WRITE,
            FILE_SHARE_READ,
            security,
            CREATE_ALWAYS,
            FILE_ATTRIBUTE_NORMAL,
          ),
          api.createFile(
            "NUL",
            GENERIC_READ,
            0,
            security,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
          ),
        );
        if (given.some(invalid))
          throw new Error(
            "Process containment could not open its output files.",
          );
        const [output, error, input] = given;
        if (options.pipes) {
          const toProcess = pipe(api, "toProcess", security);
          kept.push(toProcess.ours);
          given.push(toProcess.theirs);
          const fromProcess = pipe(api, "fromProcess", security);
          kept.push(fromProcess.ours);
          given.push(fromProcess.theirs);
          ends = {
            reads: String(koffi.address(toProcess.theirs)),
            writes: String(koffi.address(fromProcess.theirs)),
          };
        }
        // Inheritance is on, so without this list the process would also
        // receive every other inheritable handle Zhiyin holds.
        attributes = api.inheritOnly(given);
        created = api.createProcess(
          options.executable,
          writableCommandLine(options.executable, [
            ...options.arguments,
            ...(ends && options.pipes ? options.pipes(ends) : []),
          ]),
          true,
          CREATE_SUSPENDED |
            CREATE_NO_WINDOW |
            CREATE_UNICODE_ENVIRONMENT |
            EXTENDED_STARTUPINFO_PRESENT,
          options.environment ? environmentBlock(options.environment) : null,
          options.cwd,
          {
            StartupInfo: {
              cb: api.startupInfoSize,
              lpReserved: null,
              lpDesktop: null,
              lpTitle: null,
              dwX: 0,
              dwY: 0,
              dwXSize: 0,
              dwYSize: 0,
              dwXCountChars: 0,
              dwYCountChars: 0,
              dwFillAttribute: 0,
              dwFlags: STARTF_USESTDHANDLES,
              wShowWindow: 0,
              cbReserved2: 0,
              lpReserved2: null,
              hStdInput: input,
              hStdOutput: output,
              hStdError: error,
            },
            lpAttributeList: attributes.list,
          },
          information,
        );
      } finally {
        attributes?.release();
        closeEach(api, given);
        if (!created) closeEach(api, kept);
      }
      const processHandle = information["hProcess"];
      const threadHandle = information["hThread"];
      const pid = information["dwProcessId"];
      if (!processHandle || !threadHandle || typeof pid !== "number") {
        closeEach(api, kept);
        throw new Error("The contained process could not be created.");
      }
      try {
        if (!api.assign(job, processHandle))
          throw new Error(
            `Process ${pid} could not be contained before launch.`,
          );
        if (api.resumeThread(threadHandle) === INFINITE)
          throw new Error(`Process ${pid} could not be resumed.`);
      } catch (error) {
        api.terminateProcess(processHandle, 1);
        api.closeHandle(processHandle);
        closeEach(api, kept);
        throw error;
      } finally {
        api.closeHandle(threadHandle);
      }
      let pipes: ProcessPipes | undefined;
      try {
        if (ends) pipes = pipeStreams(kept);
      } catch (error) {
        api.terminateProcess(processHandle, 1);
        api.closeHandle(processHandle);
        throw error;
      }
      let waited: Promise<number> | undefined;
      return {
        pid,
        ...(pipes ? { pipes } : {}),
        wait() {
          waited ??= new Promise<number>((resolve, reject) => {
            api.wait(processHandle, INFINITE, (waitError, result) => {
              if (waitError || result !== 0) {
                api.closeHandle(processHandle);
                reject(
                  waitError ?? new Error("Waiting for the process failed."),
                );
                return;
              }
              const code: unknown[] = [null];
              const read = api.exitCode(processHandle, code);
              api.closeHandle(processHandle);
              if (
                !read ||
                typeof code[0] !== "number" ||
                code[0] === STILL_ACTIVE
              )
                reject(new Error("The process exit code was unavailable."));
              else resolve(code[0]);
            });
          });
          return waited;
        },
      };
    },
    close() {
      if (closed) return;
      closed = true;
      api.closeHandle(job);
    },
  };
}
