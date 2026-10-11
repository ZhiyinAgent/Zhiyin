/**
 * Low integrity: the part of Windows that lets a process read what the person
 * can read and write only where it has been let in.
 *
 * Every process and every file has an integrity level, and Windows refuses a
 * write from a process to anything of a higher level than its own (Windows
 * Integrity Mechanism, "no write up"). A person's programs and files are at
 * medium. A process started with the person's own token lowered to low can
 * therefore open and read as they can, and write only what is labelled low:
 * here, the folders opened to it.
 */

import koffi from "koffi";
import { win32 } from "./kernel32.js";

const TOKEN_ASSIGN_PRIMARY = 0x0001;
const TOKEN_DUPLICATE = 0x0002;
const TOKEN_QUERY = 0x0008;
const TOKEN_ADJUST_DEFAULT = 0x0080;
const SecurityImpersonation = 2;
const TokenPrimary = 1;
const TokenIntegrityLevel = 25;
const SE_GROUP_INTEGRITY = 0x00000020;
const SE_FILE_OBJECT = 1;
const LABEL_SECURITY_INFORMATION = 0x00000010;
const SDDL_REVISION_1 = 1;
const FORMAT_MESSAGE_FROM_SYSTEM = 0x00001000;
const FORMAT_MESSAGE_IGNORE_INSERTS = 0x00000200;
/** The low integrity level, as Windows names it. */
const lowLevel = "S-1-16-4096";
/**
 * A low label that a folder hands on to all it holds and will hold: files
 * (OI) and folders (CI) alike, refusing writes from below (NW).
 */
const lowLabelHandedOn = "S:(ML;OICI;NW;;;LW)";
const handedOnLow = /\(ML;[A-Z]*OICI[A-Z]*;NW;;;LW\)/;

type Advapi32 = {
  /** The person's own token lowered to low integrity; the caller closes it. */
  readonly lowToken: () => unknown;
  readonly createProcessAs: (
    token: unknown,
    executable: string,
    command: Buffer,
    inheritHandles: boolean,
    flags: number,
    environment: Buffer | null,
    cwd: string,
    startup: object,
    process: object,
  ) => boolean;
  /** The label on a file or folder as Windows writes it, or nothing. */
  readonly label: (path: string) => string | undefined;
  /** Sets the handed-on low label; answers Windows' error, zero for none. */
  readonly labelLow: (path: string) => Promise<number>;
  readonly message: (error: number) => string;
};

let loaded: Advapi32 | undefined;

function advapi32(): Advapi32 {
  if (loaded) return loaded;
  // The process structures are declared with kernel32's.
  const api = win32();
  const kernel32 = koffi.load("kernel32.dll");
  const library = koffi.load("advapi32.dll");
  const LABEL = koffi.struct("TOKEN_MANDATORY_LABEL", {
    Sid: "void*",
    Attributes: "uint32",
  });
  const GetCurrentProcess = kernel32.func("void* GetCurrentProcess()");
  const LocalFree = kernel32.func("void* LocalFree(void*)");
  const FormatMessageW = kernel32.func(
    "uint32 FormatMessageW(uint32, void*, uint32, uint32, void*, uint32, void*)",
  );
  const OpenProcessToken = library.func(
    "bool OpenProcessToken(void*, uint32, _Out_ void**)",
  );
  const DuplicateTokenEx = library.func(
    "bool DuplicateTokenEx(void*, uint32, void*, int, int, _Out_ void**)",
  );
  const ConvertStringSidToSidW = library.func(
    "bool ConvertStringSidToSidW(const char16_t*, _Out_ void**)",
  );
  const GetLengthSid = library.func("uint32 GetLengthSid(void*)");
  const SetTokenInformation = library.func(
    "bool SetTokenInformation(void*, int, TOKEN_MANDATORY_LABEL*, uint32)",
  );
  const CreateProcessAsUserW = library.func(
    "bool CreateProcessAsUserW(void*, const char16_t*, void*, void*, void*, bool, uint32, void*, const char16_t*, STARTUPINFOEXW*, _Out_ PROCESS_INFORMATION*)",
  );
  const DescriptorFromText = library.func(
    "bool ConvertStringSecurityDescriptorToSecurityDescriptorW(const char16_t*, uint32, _Out_ void**, void*)",
  );
  const TextFromDescriptor = library.func(
    "bool ConvertSecurityDescriptorToStringSecurityDescriptorW(void*, uint32, uint32, _Out_ void**, void*)",
  );
  const GetSecurityDescriptorSacl = library.func(
    "bool GetSecurityDescriptorSacl(void*, _Out_ int*, _Out_ void**, _Out_ int*)",
  );
  const SetNamedSecurityInfoW = library.func(
    "uint32 SetNamedSecurityInfoW(const char16_t*, int, uint32, void*, void*, void*, void*)",
  );
  const GetNamedSecurityInfoW = library.func(
    "uint32 GetNamedSecurityInfoW(const char16_t*, int, uint32, void*, void*, void*, void*, _Out_ void**)",
  );

  loaded = {
    lowToken() {
      const own: unknown[] = [null];
      if (
        !OpenProcessToken(
          GetCurrentProcess(),
          TOKEN_DUPLICATE |
            TOKEN_ADJUST_DEFAULT |
            TOKEN_QUERY |
            TOKEN_ASSIGN_PRIMARY,
          own,
        )
      )
        throw new Error("Zhiyin's own token could not be opened.");
      const copy: unknown[] = [null];
      const copied = DuplicateTokenEx(
        own[0],
        0,
        null,
        SecurityImpersonation,
        TokenPrimary,
        copy,
      );
      api.closeHandle(own[0]);
      if (!copied) throw new Error("Zhiyin's own token could not be copied.");
      const level: unknown[] = [null];
      if (!ConvertStringSidToSidW(lowLevel, level)) {
        api.closeHandle(copy[0]);
        throw new Error("Windows does not know the low integrity level.");
      }
      const lowered = SetTokenInformation(
        copy[0],
        TokenIntegrityLevel,
        { Sid: level[0], Attributes: SE_GROUP_INTEGRITY },
        koffi.sizeof(LABEL) + GetLengthSid(level[0]),
      );
      LocalFree(level[0]);
      if (!lowered) {
        api.closeHandle(copy[0]);
        throw new Error("A token could not be lowered to low integrity.");
      }
      return copy[0];
    },
    createProcessAs: (
      token,
      executable,
      command,
      inheritHandles,
      flags,
      environment,
      cwd,
      startup,
      process,
    ) =>
      CreateProcessAsUserW(
        token,
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
    label(path) {
      const descriptor: unknown[] = [null];
      if (
        GetNamedSecurityInfoW(
          path,
          SE_FILE_OBJECT,
          LABEL_SECURITY_INFORMATION,
          null,
          null,
          null,
          null,
          descriptor,
        ) !== 0 ||
        !descriptor[0]
      )
        return undefined;
      const text: unknown[] = [null];
      const written = TextFromDescriptor(
        descriptor[0],
        SDDL_REVISION_1,
        LABEL_SECURITY_INFORMATION,
        text,
        null,
      );
      LocalFree(descriptor[0]);
      if (!written || !text[0]) return undefined;
      const label = koffi.decode(text[0], "char16_t", -1) as string;
      LocalFree(text[0]);
      return label;
    },
    labelLow(path) {
      const descriptor: unknown[] = [null];
      if (
        !DescriptorFromText(lowLabelHandedOn, SDDL_REVISION_1, descriptor, null)
      )
        throw new Error("Windows does not know the low integrity label.");
      const present = [0];
      const list: unknown[] = [null];
      GetSecurityDescriptorSacl(descriptor[0], present, list, [0]);
      // Windows hands the label on to everything already in the folder, one
      // file after another: off Zhiyin's own thread, however many there are.
      return new Promise<number>((resolve, reject) => {
        SetNamedSecurityInfoW.async(
          path,
          SE_FILE_OBJECT,
          LABEL_SECURITY_INFORMATION,
          null,
          null,
          null,
          list[0],
          (error: unknown, result: number) => {
            LocalFree(descriptor[0]);
            if (error)
              reject(error instanceof Error ? error : new Error(String(error)));
            else resolve(result);
          },
        );
      });
    },
    message(error) {
      const text = Buffer.alloc(1_024);
      const length = FormatMessageW(
        FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
        null,
        error,
        0,
        text,
        text.length / 2,
        null,
      );
      const said = text.toString("utf16le", 0, length * 2).trim();
      return said
        ? `${said} (Windows error ${error})`
        : `Windows error ${error}`;
    },
  };
  return loaded;
}

/** The person's own token lowered to low integrity; the caller closes it. */
export function lowIntegrityToken(): unknown {
  return advapi32().lowToken();
}

export function createProcessAs(
  ...given: Parameters<Advapi32["createProcessAs"]>
): boolean {
  return advapi32().createProcessAs(...given);
}

/**
 * Opens a folder to processes started at low integrity: they may write in
 * it, in everything it holds and in everything put in it later. Opening a
 * folder that is already open changes nothing. Throws, with Windows' reason,
 * when the folder cannot be opened.
 */
export async function openToLowIntegrity(folder: string): Promise<void> {
  const api = advapi32();
  if (handedOnLow.test(api.label(folder) ?? "")) return;
  const error = await api.labelLow(folder);
  if (error !== 0)
    throw new Error(
      `${folder} could not be opened to low integrity: ${api.message(error)}`,
    );
}
