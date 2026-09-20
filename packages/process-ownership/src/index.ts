/**
 * Structural containment for processes Zhiyin starts.
 *
 * Boundaries and invariants:
 * docs/architecture/features/process-ownership/README.md
 */

import koffi from "koffi";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
};

export type ContainedProcess = {
  readonly pid: number;
  wait(): Promise<number>;
};

export type ProcessContainment = {
  open(): ProcessContainer;
};

export type ProcessRun = {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly ending?: "timeout" | "stopped";
  readonly failure?: "containment" | "start";
};

export type RunProcess = (options: {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly containment?: ProcessContainment;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly maximumOutputCharacters?: number;
}) => Promise<ProcessRun>;

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

  if (container) {
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
        });
      } catch {
        return {
          exitCode: null,
          stdout: "",
          stderr: "",
          failure: "containment",
        };
      }
      let ending: "timeout" | "stopped" | undefined;
      const stop = (why: "timeout" | "stopped") => {
        if (ending) return;
        ending = why;
        container.close();
      };
      const timer = setTimeout(() => stop("timeout"), options.timeoutMs);
      const onAbort = () => stop("stopped");
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.signal?.aborted) stop("stopped");
      let exitCode: number | null = null;
      let failure: ProcessRun["failure"];
      try {
        exitCode = await child.wait();
      } catch {
        failure = ending ? undefined : "start";
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        container.close();
      }
      const [stdout, stderr] = await Promise.all([
        readFile(stdoutFile, "utf8").catch(() => ""),
        readFile(stderrFile, "utf8").catch(() => ""),
      ]);
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

  return new Promise<ProcessRun>((resolve) => {
    const child = spawn(options.executable, [...options.arguments], {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...(options.environment ? { env: options.environment } : {}),
    });
    const maximum = options.maximumOutputCharacters ?? 400_000;
    let stdout = "";
    let stderr = "";
    let ending: "timeout" | "stopped" | undefined;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (stdout.length < maximum) stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < maximum) stderr += chunk;
    });
    const stop = (why: "timeout" | "stopped") => {
      if (ending) return;
      ending = why;
      if (child.pid !== undefined) void killTree(child.pid);
    };
    const timer = setTimeout(() => stop("timeout"), options.timeoutMs);
    const onAbort = () => stop("stopped");
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) stop("stopped");
    child.on("error", () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({ exitCode: null, stdout: "", stderr: "", failure: "start" });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({
        exitCode,
        stdout,
        stderr,
        ...(ending ? { ending } : {}),
      });
    });
  });
};

const JobObjectExtendedLimitInformation = 9;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
const PROCESS_SET_QUOTA = 0x0100;
const PROCESS_TERMINATE = 0x0001;
const CREATE_SUSPENDED = 0x00000004;
const CREATE_NO_WINDOW = 0x08000000;
const STARTF_USESTDHANDLES = 0x00000100;
const GENERIC_READ = 0x80000000;
const GENERIC_WRITE = 0x40000000;
const FILE_SHARE_READ = 0x00000001;
const CREATE_ALWAYS = 2;
const OPEN_EXISTING = 3;
const FILE_ATTRIBUTE_NORMAL = 0x00000080;
const INFINITE = 0xffffffff;
const STILL_ACTIVE = 259;

type Win32 = {
  readonly securityAttributesSize: number;
  readonly startupInfoSize: number;
  readonly createJob: () => unknown;
  readonly setLimits: (job: unknown) => boolean;
  readonly openProcess: (pid: number) => unknown;
  readonly assign: (job: unknown, process: unknown) => boolean;
  readonly closeHandle: (handle: unknown) => boolean;
  readonly createFile: (
    path: string,
    access: number,
    share: number,
    security: object,
    creation: number,
    flags: number,
  ) => unknown;
  readonly createProcess: (
    executable: string,
    command: Buffer,
    inheritHandles: boolean,
    flags: number,
    cwd: string,
    startup: object,
    process: object,
  ) => boolean;
  readonly resumeThread: (thread: unknown) => number;
  readonly terminateProcess: (process: unknown, exitCode: number) => boolean;
  readonly wait: (
    process: unknown,
    milliseconds: number,
    callback: (error: Error | null, result: number) => void,
  ) => void;
  readonly exitCode: (process: unknown, code: unknown[]) => boolean;
};

let loaded: Win32 | undefined;
let loadFailure: string | undefined;

function win32(): Win32 {
  if (loaded) return loaded;
  if (loadFailure) throw new Error(loadFailure);
  try {
    const kernel32 = koffi.load("kernel32.dll");
    const IO_COUNTERS = koffi.struct("IO_COUNTERS", {
      ReadOperationCount: "uint64",
      WriteOperationCount: "uint64",
      OtherOperationCount: "uint64",
      ReadTransferCount: "uint64",
      WriteTransferCount: "uint64",
      OtherTransferCount: "uint64",
    });
    const BASIC = koffi.struct("JOBOBJECT_BASIC_LIMIT_INFORMATION", {
      PerProcessUserTimeLimit: "int64",
      PerJobUserTimeLimit: "int64",
      LimitFlags: "uint32",
      MinimumWorkingSetSize: "size_t",
      MaximumWorkingSetSize: "size_t",
      ActiveProcessLimit: "uint32",
      Affinity: "uintptr_t",
      PriorityClass: "uint32",
      SchedulingClass: "uint32",
    });
    const EXTENDED = koffi.struct("JOBOBJECT_EXTENDED_LIMIT_INFORMATION", {
      BasicLimitInformation: BASIC,
      IoInfo: IO_COUNTERS,
      ProcessMemoryLimit: "size_t",
      JobMemoryLimit: "size_t",
      PeakProcessMemoryUsed: "size_t",
      PeakJobMemoryUsed: "size_t",
    });
    const SECURITY_ATTRIBUTES = koffi.struct("SECURITY_ATTRIBUTES", {
      nLength: "uint32",
      lpSecurityDescriptor: "void*",
      bInheritHandle: "bool",
    });
    const STARTUPINFO = koffi.struct("STARTUPINFOW", {
      cb: "uint32",
      lpReserved: "void*",
      lpDesktop: "void*",
      lpTitle: "void*",
      dwX: "uint32",
      dwY: "uint32",
      dwXSize: "uint32",
      dwYSize: "uint32",
      dwXCountChars: "uint32",
      dwYCountChars: "uint32",
      dwFillAttribute: "uint32",
      dwFlags: "uint32",
      wShowWindow: "uint16",
      cbReserved2: "uint16",
      lpReserved2: "void*",
      hStdInput: "void*",
      hStdOutput: "void*",
      hStdError: "void*",
    });
    koffi.struct("PROCESS_INFORMATION", {
      hProcess: "void*",
      hThread: "void*",
      dwProcessId: "uint32",
      dwThreadId: "uint32",
    });
    const CreateJobObjectW = kernel32.func(
      "void* CreateJobObjectW(void*, void*)",
    );
    const SetInformationJobObject = kernel32.func(
      "bool SetInformationJobObject(void*, int, JOBOBJECT_EXTENDED_LIMIT_INFORMATION*, uint32)",
    );
    const OpenProcess = kernel32.func(
      "void* OpenProcess(uint32, bool, uint32)",
    );
    const AssignProcessToJobObject = kernel32.func(
      "bool AssignProcessToJobObject(void*, void*)",
    );
    const CloseHandle = kernel32.func("bool CloseHandle(void*)");
    const CreateFileW = kernel32.func(
      "void* CreateFileW(const char16_t*, uint32, uint32, SECURITY_ATTRIBUTES*, uint32, uint32, void*)",
    );
    const CreateProcessW = kernel32.func(
      "bool CreateProcessW(const char16_t*, void*, void*, void*, bool, uint32, void*, const char16_t*, STARTUPINFOW*, _Out_ PROCESS_INFORMATION*)",
    );
    const ResumeThread = kernel32.func("uint32 ResumeThread(void*)");
    const TerminateProcess = kernel32.func(
      "bool TerminateProcess(void*, uint32)",
    );
    const WaitForSingleObject = kernel32.func(
      "uint32 WaitForSingleObject(void*, uint32)",
    );
    const GetExitCodeProcess = kernel32.func(
      "bool GetExitCodeProcess(void*, _Out_ uint32*)",
    );
    const extendedSize = koffi.sizeof(EXTENDED);

    loaded = {
      securityAttributesSize: koffi.sizeof(SECURITY_ATTRIBUTES),
      startupInfoSize: koffi.sizeof(STARTUPINFO),
      createJob: () => CreateJobObjectW(null, null),
      setLimits: (job) =>
        SetInformationJobObject(
          job,
          JobObjectExtendedLimitInformation,
          {
            BasicLimitInformation: {
              PerProcessUserTimeLimit: 0n,
              PerJobUserTimeLimit: 0n,
              // The whole mechanism is this flag: when the last handle to the
              // job goes, the kernel terminates everything still inside it.
              // Our process dying closes that handle, so containment does not
              // depend on any code of ours running afterwards.
              LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
              MinimumWorkingSetSize: 0,
              MaximumWorkingSetSize: 0,
              ActiveProcessLimit: 0,
              Affinity: 0,
              PriorityClass: 0,
              SchedulingClass: 0,
            },
            IoInfo: {
              ReadOperationCount: 0n,
              WriteOperationCount: 0n,
              OtherOperationCount: 0n,
              ReadTransferCount: 0n,
              WriteTransferCount: 0n,
              OtherTransferCount: 0n,
            },
            ProcessMemoryLimit: 0,
            JobMemoryLimit: 0,
            PeakProcessMemoryUsed: 0,
            PeakJobMemoryUsed: 0,
          },
          extendedSize,
        ),
      openProcess: (pid) =>
        OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid),
      assign: (job, target) => AssignProcessToJobObject(job, target),
      closeHandle: (handle) => CloseHandle(handle),
      createFile: (path, access, share, security, creation, flags) =>
        CreateFileW(path, access, share, security, creation, flags, null),
      createProcess: (
        executable,
        command,
        inheritHandles,
        flags,
        cwd,
        startup,
        process,
      ) =>
        CreateProcessW(
          executable,
          command,
          null,
          null,
          inheritHandles,
          flags,
          null,
          cwd,
          startup,
          process,
        ),
      resumeThread: (thread) => ResumeThread(thread),
      terminateProcess: (process, exitCode) =>
        TerminateProcess(process, exitCode),
      wait: (process, milliseconds, callback) =>
        WaitForSingleObject.async(process, milliseconds, callback),
      exitCode: (process, code) => GetExitCodeProcess(process, code),
    };
    return loaded;
  } catch (error) {
    loadFailure = `Process containment is unavailable: ${
      error instanceof Error ? error.message : String(error)
    }`;
    throw new Error(loadFailure, { cause: error });
  }
}

function quoteWindowsArgument(value: string): string {
  const escaped = value
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\*)$/g, "$1$1");
  return `"${escaped}"`;
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

export function openProcessContainer(): ProcessContainer {
  const api = win32();
  const job = api.createJob();
  if (!job) throw new Error("Process containment could not create a job.");
  if (!api.setLimits(job)) {
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
      const handles: unknown[] = [];
      const output = api.createFile(
        options.stdout,
        GENERIC_WRITE,
        FILE_SHARE_READ,
        security,
        CREATE_ALWAYS,
        FILE_ATTRIBUTE_NORMAL,
      );
      const error = api.createFile(
        options.stderr,
        GENERIC_WRITE,
        FILE_SHARE_READ,
        security,
        CREATE_ALWAYS,
        FILE_ATTRIBUTE_NORMAL,
      );
      const input = api.createFile(
        "NUL",
        GENERIC_READ,
        0,
        security,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
      );
      handles.push(output, error, input);
      const invalid = (handle: unknown) =>
        !handle || koffi.address(handle) === BigInt.asUintN(64, -1n);
      if (handles.some(invalid)) {
        for (const handle of handles)
          if (!invalid(handle)) api.closeHandle(handle);
        throw new Error("Process containment could not open its output files.");
      }
      const startup = {
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
      };
      const information: Record<string, unknown> = {};
      let created: boolean;
      try {
        created = api.createProcess(
          options.executable,
          writableCommandLine(options.executable, options.arguments),
          true,
          CREATE_SUSPENDED | CREATE_NO_WINDOW,
          options.cwd,
          startup,
          information,
        );
      } finally {
        for (const handle of handles) api.closeHandle(handle);
      }
      const processHandle = information["hProcess"];
      const threadHandle = information["hThread"];
      const pid = information["dwProcessId"];
      if (
        !created ||
        !processHandle ||
        !threadHandle ||
        typeof pid !== "number"
      )
        throw new Error("The contained process could not be created.");
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
        throw error;
      } finally {
        api.closeHandle(threadHandle);
      }
      let waited: Promise<number> | undefined;
      return {
        pid,
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
