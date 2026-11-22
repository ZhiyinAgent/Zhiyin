/**
 * The Windows calls made on files and their permissions, declared once and
 * loaded on first use: opening a file, opening an entry itself without
 * following a link, saying whether an open entry is a link, reading its
 * permissions as text, reading an open file, saying where an open entry
 * really is, replacing, deleting and moving a file, and Windows' own words
 * for an error.
 */

import koffi from "koffi";

export const READ_CONTROL = 0x00020000;
export const WRITE_DAC = 0x00040000;
export const FILE_READ_ATTRIBUTES = 0x00000080;
export const SE_FILE_OBJECT = 1;
export const DACL_SECURITY_INFORMATION = 0x00000004;
export const SDDL_REVISION_1 = 1;
const FILE_SHARE_ALL = 0x00000007;
const OPEN_EXISTING = 3;
const FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
const FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
const FILE_ATTRIBUTE_TAG_INFO = 9;
const FILE_ATTRIBUTE_DIRECTORY = 0x00000010;
const FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
/** A reparse tag that names another place: a junction or a symbolic link. */
const NAME_SURROGATE = 0x20000000;
/** A path by its drive letter, normalized, in `GetFinalPathNameByHandleW`. */
const VOLUME_NAME_DOS = 0;
const FORMAT_MESSAGE_FROM_SYSTEM = 0x00001000;
const FORMAT_MESSAGE_IGNORE_INSERTS = 0x00000200;

/** A handle Windows opened, or the error it gave instead. */
export type Opening =
  | { readonly handle: unknown }
  | { readonly handle?: undefined; readonly error: number };

export type WindowsFiles = {
  readonly securityAttributesSize: number;
  /**
   * Opens a file as `CreateFileW` does; `security`, a `SECURITY_ATTRIBUTES`,
   * when the handle is to be inherited.
   */
  readonly open: (
    path: string,
    access: number,
    share: number,
    creation: number,
    flags: number,
    security?: object,
  ) => Opening;
  /**
   * Opens the entry at `path` itself, file or folder, sharing it with every
   * other opener: a link is opened as the link, never what it leads to.
   */
  readonly openWithoutFollowing: (path: string, access: number) => Opening;
  /**
   * Whether an open entry is a folder, and whether it is a link to another
   * place, a junction or a symbolic link; or the error Windows gave.
   */
  readonly entryOf: (
    handle: unknown,
  ) =>
    | { readonly folder: boolean; readonly link: boolean }
    | { readonly error: number };
  /**
   * An open entry's permissions: the descriptor holding them, which the
   * caller frees with `free`, and the list inside it; or Windows' error.
   */
  readonly securityOf: (
    handle: unknown,
  ) =>
    | { readonly descriptor: unknown; readonly list: unknown }
    | { readonly error: number };
  /** The same, of the entry a path names, read by its name. */
  readonly namedSecurityOf: (
    path: string,
  ) =>
    | { readonly descriptor: unknown; readonly list: unknown }
    | { readonly error: number };
  /** A descriptor's permissions as Windows writes them, or nothing. */
  readonly permissionsText: (descriptor: unknown) => string | undefined;
  /** The permissions of the entry a path names, as text, or nothing. */
  readonly namedPermissions: (path: string) => string | undefined;
  /**
   * Reads from an open file into `buffer` as `ReadFile` does: how many bytes
   * it read, none at the end, or nothing when Windows refused.
   */
  readonly read: (handle: unknown, buffer: Buffer) => number | undefined;
  /** Puts `replacement` in `target`'s place as `ReplaceFileW` does, keeping the old as `previous`. */
  readonly replace: (
    target: string,
    replacement: string,
    previous: string,
  ) => boolean;
  /**
   * Where an open entry really is, as Windows names it by its handle, every
   * link on the way resolved: a drive path, or `\\server\share` for a share.
   * Nothing when Windows cannot say.
   */
  readonly finalPath: (handle: unknown) => string | undefined;
  /** Deletes a file as `DeleteFileW` does. */
  readonly remove: (path: string) => boolean;
  /** Moves a file as `MoveFileExW` does, with its flags. */
  readonly move: (from: string, to: string, flags: number) => boolean;
  readonly close: (handle: unknown) => void;
  /** Frees what Windows allocated for an answer. */
  readonly free: (memory: unknown) => void;
  /** The error of the call made last on this thread. */
  readonly lastError: () => number;
  /** Windows' own words for an error, with its number. */
  readonly message: (error: number) => string;
};

export function invalid(handle: unknown): boolean {
  return !handle || koffi.address(handle) === BigInt.asUintN(64, -1n);
}

let loaded: WindowsFiles | undefined;

export function windowsFiles(): WindowsFiles {
  if (loaded) return loaded;
  const kernel32 = koffi.load("kernel32.dll");
  const advapi32 = koffi.load("advapi32.dll");
  const SECURITY_ATTRIBUTES = koffi.struct("SECURITY_ATTRIBUTES", {
    nLength: "uint32",
    lpSecurityDescriptor: "void*",
    bInheritHandle: "bool",
  });
  const CreateFileW = kernel32.func(
    "void* CreateFileW(const char16_t*, uint32, uint32, SECURITY_ATTRIBUTES*, uint32, uint32, void*)",
  );
  const CloseHandle = kernel32.func("bool CloseHandle(void*)");
  const ReadFile = kernel32.func(
    "bool ReadFile(void*, void*, uint32, _Out_ uint32*, void*)",
  );
  const ReplaceFileW = kernel32.func(
    "bool ReplaceFileW(const char16_t*, const char16_t*, const char16_t*, uint32, void*, void*)",
  );
  const DeleteFileW = kernel32.func("bool DeleteFileW(const char16_t*)");
  const MoveFileExW = kernel32.func(
    "bool MoveFileExW(const char16_t*, const char16_t*, uint32)",
  );
  const GetLastError = kernel32.func("uint32 GetLastError()");
  const LocalFree = kernel32.func("void* LocalFree(void*)");
  const FormatMessageW = kernel32.func(
    "uint32 FormatMessageW(uint32, void*, uint32, uint32, void*, uint32, void*)",
  );
  const GetFinalPathNameByHandleW = kernel32.func(
    "uint32 GetFinalPathNameByHandleW(void*, void*, uint32, uint32)",
  );
  const GetFileInformationByHandleEx = kernel32.func(
    "bool GetFileInformationByHandleEx(void*, int, void*, uint32)",
  );
  const GetSecurityInfo = advapi32.func(
    "uint32 GetSecurityInfo(void*, int, uint32, void*, void*, _Out_ void**, void*, _Out_ void**)",
  );
  const GetNamedSecurityInfoW = advapi32.func(
    "uint32 GetNamedSecurityInfoW(const char16_t*, int, uint32, void*, void*, _Out_ void**, void*, _Out_ void**)",
  );
  const ToText = advapi32.func(
    "bool ConvertSecurityDescriptorToStringSecurityDescriptorW(void*, uint32, uint32, _Out_ void**, void*)",
  );

  const open: WindowsFiles["open"] = (
    path,
    access,
    share,
    creation,
    flags,
    security,
  ) => {
    const handle: unknown = CreateFileW(
      path,
      access,
      share,
      security ?? null,
      creation,
      flags,
      null,
    );
    return invalid(handle) ? { error: GetLastError() as number } : { handle };
  };

  const namedSecurityOf: WindowsFiles["namedSecurityOf"] = (path) => {
    const list: unknown[] = [null];
    const descriptor: unknown[] = [null];
    const error = GetNamedSecurityInfoW(
      path,
      SE_FILE_OBJECT,
      DACL_SECURITY_INFORMATION,
      null,
      null,
      list,
      null,
      descriptor,
    ) as number;
    return error === 0
      ? { descriptor: descriptor[0], list: list[0] }
      : { error };
  };

  const permissionsText = (descriptor: unknown): string | undefined => {
    const text: unknown[] = [null];
    const written = ToText(
      descriptor,
      SDDL_REVISION_1,
      DACL_SECURITY_INFORMATION,
      text,
      null,
    );
    if (!written || !text[0]) return undefined;
    const permissions = koffi.decode(text[0], "char16_t", -1) as string;
    LocalFree(text[0]);
    return permissions;
  };

  loaded = {
    securityAttributesSize: koffi.sizeof(SECURITY_ATTRIBUTES),
    open,
    openWithoutFollowing: (path, access) =>
      open(
        path,
        access,
        FILE_SHARE_ALL,
        OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
      ),
    entryOf(handle) {
      const tag = Buffer.alloc(8);
      if (
        !GetFileInformationByHandleEx(
          handle,
          FILE_ATTRIBUTE_TAG_INFO,
          tag,
          tag.length,
        )
      )
        return { error: GetLastError() as number };
      const attributes = tag.readUInt32LE(0);
      return {
        folder: (attributes & FILE_ATTRIBUTE_DIRECTORY) !== 0,
        link:
          (attributes & FILE_ATTRIBUTE_REPARSE_POINT) !== 0 &&
          (tag.readUInt32LE(4) & NAME_SURROGATE) !== 0,
      };
    },
    securityOf(handle) {
      const list: unknown[] = [null];
      const descriptor: unknown[] = [null];
      const error = GetSecurityInfo(
        handle,
        SE_FILE_OBJECT,
        DACL_SECURITY_INFORMATION,
        null,
        null,
        list,
        null,
        descriptor,
      ) as number;
      return error === 0
        ? { descriptor: descriptor[0], list: list[0] }
        : { error };
    },
    namedSecurityOf,
    permissionsText,
    namedPermissions(path) {
      const security = namedSecurityOf(path);
      if ("error" in security) return undefined;
      const permissions = permissionsText(security.descriptor);
      LocalFree(security.descriptor);
      return permissions;
    },
    read: (handle, buffer) => {
      const read = [0];
      return ReadFile(handle, buffer, buffer.length, read, null)
        ? (read[0] ?? 0)
        : undefined;
    },
    replace: (target, replacement, previous) =>
      ReplaceFileW(target, replacement, previous, 0, null, null) as boolean,
    finalPath(handle) {
      // Characters, the terminating one included, as Windows counts them.
      let room = 512;
      for (;;) {
        const name = Buffer.alloc(room * 2);
        const length = GetFinalPathNameByHandleW(
          handle,
          name,
          room,
          VOLUME_NAME_DOS,
        ) as number;
        if (length === 0) return undefined;
        if (length >= room) {
          room = length + 1;
          continue;
        }
        const named = name.toString("utf16le", 0, length * 2);
        return named.startsWith("\\\\?\\UNC\\")
          ? `\\\\${named.slice(8)}`
          : named.startsWith("\\\\?\\")
            ? named.slice(4)
            : named;
      }
    },
    remove: (path) => DeleteFileW(path) as boolean,
    move: (from, to, flags) => MoveFileExW(from, to, flags) as boolean,
    close: (handle) => {
      CloseHandle(handle);
    },
    free: (memory) => {
      LocalFree(memory);
    },
    lastError: () => GetLastError() as number,
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
