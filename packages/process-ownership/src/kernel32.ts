/**
 * The parts of kernel32 containment uses, typed. Loaded on first use; a
 * failure to load is kept and reported as containment being unavailable.
 */

import koffi from "koffi";

const JobObjectExtendedLimitInformation = 9;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
const JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x100;
const PROCESS_SET_QUOTA = 0x0100;
const PROCESS_TERMINATE = 0x0001;
export const CREATE_SUSPENDED = 0x00000004;
export const CREATE_NO_WINDOW = 0x08000000;
export const CREATE_UNICODE_ENVIRONMENT = 0x00000400;
const CP_OEMCP = 1;
export const STARTF_USESTDHANDLES = 0x00000100;
export const GENERIC_READ = 0x80000000;
export const GENERIC_WRITE = 0x40000000;
export const FILE_SHARE_READ = 0x00000001;
export const CREATE_ALWAYS = 2;
export const OPEN_EXISTING = 3;
export const FILE_ATTRIBUTE_NORMAL = 0x00000080;
export const INFINITE = 0xffffffff;
export const STILL_ACTIVE = 259;
export const EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
const PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x00020002;
export const PIPE_ACCESS_INBOUND = 0x00000001;
export const PIPE_ACCESS_OUTBOUND = 0x00000002;
export const FILE_FLAG_OVERLAPPED = 0x40000000;
export const FILE_FLAG_FIRST_PIPE_INSTANCE = 0x00080000;
const PIPE_REJECT_REMOTE_CLIENTS = 0x00000008;
export const FILE_READ_ATTRIBUTES = 0x00000080;
const pipeBufferSize = 65_536;

export type Win32 = {
  readonly securityAttributesSize: number;
  readonly startupInfoSize: number;
  readonly createNamedPipe: (name: string, openMode: number) => unknown;
  /**
   * An attribute list naming the only handles a process inherits. It must
   * outlive the process's creation, and then be released.
   */
  readonly inheritOnly: (handles: readonly unknown[]) => {
    readonly list: unknown;
    release(): void;
  };
  readonly createJob: () => unknown;
  /** `processMemoryLimit` in bytes; absent, committed memory is not limited. */
  readonly setLimits: (job: unknown, processMemoryLimit?: number) => boolean;
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
    environment: Buffer | null,
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
  readonly oemToWide: (bytes: Buffer, wide: Buffer | null) => number;
};

let loaded: Win32 | undefined;
let loadFailure: string | undefined;

export function win32(): Win32 {
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
    const STARTUPINFOEX = koffi.struct("STARTUPINFOEXW", {
      StartupInfo: STARTUPINFO,
      lpAttributeList: "void*",
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
      "bool CreateProcessW(const char16_t*, void*, void*, void*, bool, uint32, void*, const char16_t*, STARTUPINFOEXW*, _Out_ PROCESS_INFORMATION*)",
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
    const MultiByteToWideChar = kernel32.func(
      "int MultiByteToWideChar(uint32, uint32, void*, int, void*, int)",
    );
    const CreateNamedPipeW = kernel32.func(
      "void* CreateNamedPipeW(const char16_t*, uint32, uint32, uint32, uint32, uint32, uint32, void*)",
    );
    const InitializeProcThreadAttributeList = kernel32.func(
      "bool InitializeProcThreadAttributeList(void*, uint32, uint32, _Inout_ size_t*)",
    );
    const UpdateProcThreadAttribute = kernel32.func(
      "bool UpdateProcThreadAttribute(void*, uint32, uintptr_t, void*, size_t, void*, void*)",
    );
    const DeleteProcThreadAttributeList = kernel32.func(
      "void DeleteProcThreadAttributeList(void*)",
    );
    const extendedSize = koffi.sizeof(EXTENDED);

    loaded = {
      securityAttributesSize: koffi.sizeof(SECURITY_ATTRIBUTES),
      startupInfoSize: koffi.sizeof(STARTUPINFOEX),
      createNamedPipe: (name, openMode) =>
        CreateNamedPipeW(
          name,
          openMode,
          PIPE_REJECT_REMOTE_CLIENTS,
          1,
          pipeBufferSize,
          pipeBufferSize,
          0,
          null,
        ),
      inheritOnly: (handles) => {
        const size = [0];
        InitializeProcThreadAttributeList(null, 1, 0, size);
        const list = koffi.alloc("uint8", size[0]!);
        const values = koffi.alloc("uintptr_t", handles.length);
        koffi.encode(
          values,
          koffi.array("uintptr_t", handles.length),
          handles.map((handle) => koffi.address(handle)),
        );
        const free = () => {
          koffi.free(values);
          koffi.free(list);
        };
        if (!InitializeProcThreadAttributeList(list, 1, 0, size)) {
          free();
          throw new Error("Process containment could not list its handles.");
        }
        if (
          !UpdateProcThreadAttribute(
            list,
            0,
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
            values,
            handles.length * koffi.sizeof("uintptr_t"),
            null,
            null,
          )
        ) {
          DeleteProcThreadAttributeList(list);
          free();
          throw new Error("Process containment could not list its handles.");
        }
        return {
          list,
          release: () => {
            DeleteProcThreadAttributeList(list);
            free();
          },
        };
      },
      createJob: () => CreateJobObjectW(null, null),
      setLimits: (job, processMemoryLimit) =>
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
              LimitFlags:
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE |
                // Committed memory, native allocations included: a commit
                // past it fails, and the process ends rather than the machine
                // running short (JOBOBJECT_BASIC_LIMIT_INFORMATION).
                (processMemoryLimit ? JOB_OBJECT_LIMIT_PROCESS_MEMORY : 0),
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
            ProcessMemoryLimit: processMemoryLimit ?? 0,
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
        environment,
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
          environment,
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
      oemToWide: (bytes, wide) =>
        MultiByteToWideChar(
          CP_OEMCP,
          0,
          bytes,
          bytes.length,
          wide,
          wide ? wide.length / 2 : 0,
        ),
    };
    return loaded;
  } catch (error) {
    loadFailure = `Process containment is unavailable: ${
      error instanceof Error ? error.message : String(error)
    }`;
    throw new Error(loadFailure, { cause: error });
  }
}

export function invalid(handle: unknown): boolean {
  return !handle || koffi.address(handle) === BigInt.asUintN(64, -1n);
}

export function closeEach(api: Win32, handles: readonly unknown[]): void {
  for (const handle of handles) if (!invalid(handle)) api.closeHandle(handle);
}
