/**
 * Granting a folder to a capability: an entry in the folder's permissions
 * that Windows hands on to everything in it and to what is added later. A
 * container holding the capability reaches the folder; one without it does
 * not.
 *
 * Windows writes the entry into every file and folder below, one after
 * another, without following a junction out of the folder. It passes over an
 * entry whose permissions it keeps apart from its folder's: one protected from
 * them, and a file moved in from a folder whose permissions an older program
 * wrote, which Windows reads the same way. Each of those is then given the
 * entry directly, opened without following a link, and only when it is still
 * inside the folder. A file moved in from elsewhere on the same drive keeps
 * the permissions it had until the folder is granted again. A file reached
 * through a hard link shares its permissions with its other names, so
 * granting a folder that holds hard links grants those names too.
 */

import { createHash } from "node:crypto";
import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, parse, relative, resolve } from "node:path";
import koffi from "koffi";
import { capabilityNamed } from "./app-container.js";
import { invalid, win32 } from "./kernel32.js";

type Access = "read" | "write";

/** Reading, listing and running what the folder holds. */
const READ = 0x001200a9;
/** Reading and changing it: writing, creating and deleting. */
const CHANGE = 0x001301bf;
const SE_FILE_OBJECT = 1;
const DACL_SECURITY_INFORMATION = 0x00000004;
const SDDL_REVISION_1 = 1;
const GRANT_ACCESS = 1;
const SUB_CONTAINERS_AND_OBJECTS_INHERIT = 3;
const TRUSTEE_IS_SID = 0;
const NO_INHERITANCE = 0;
const FILE_PERSISTENT_ACLS = 0x00000008;
const FORMAT_MESSAGE_FROM_SYSTEM = 0x00001000;
const FORMAT_MESSAGE_IGNORE_INSERTS = 0x00000200;
const FILE_READ_ATTRIBUTES = 0x00000080;
const READ_CONTROL = 0x00020000;
const WRITE_DAC = 0x00040000;
const FILE_SHARE_ALL = 0x00000007;
const OPEN_EXISTING = 3;
const FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
const FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
const FILE_ATTRIBUTE_TAG_INFO = 9;
const FILE_ATTRIBUTE_DIRECTORY = 0x00000010;
const FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
const SE_DACL_AUTO_INHERITED = 0x0400;
const SE_DACL_PROTECTED = 0x1000;
/** A reparse tag that names another place: a junction or a symbolic link. */
const NAME_SURROGATE = 0x20000000;

/** What one entry below a granted folder was, as far as the grant goes. */
type Reached = "folder" | "file" | "passed";

export type Advapi32 = {
  /** The folder's permissions as Windows writes them, or nothing. */
  readonly permissions: (path: string) => string | undefined;
  /** Adds the entry, handing it on below; answers Windows' error, zero for none. */
  readonly grant: (path: string, sid: string, mask: number) => Promise<number>;
  /**
   * Gives one entry below `within` the entry directly when it does not carry
   * it. Never follows a link, and writes nothing to what is no longer inside
   * `within`: a link, or what is outside, is passed.
   */
  readonly reach: (
    path: string,
    sid: string,
    mask: number,
    within: string,
  ) => Reached;
  /** Whether the drive the folder is on keeps permissions. */
  readonly keepsPermissions: (path: string) => boolean;
  readonly message: (error: number) => string;
};

/** Whether a list of permissions holds an entry for this capability. */
function holds(permissions: string, sid: string): boolean {
  return new RegExp(`\\(A;[^;()]*;[^;()]*;;;${sid}\\)`).test(permissions);
}

/** Whether `path`, as Windows names it, is below `folder`. */
function below(folder: string, path: string): boolean {
  const between = relative(folder.toLowerCase(), path.toLowerCase());
  return between !== "" && !between.startsWith("..") && !isAbsolute(between);
}

let loaded: Advapi32 | undefined;

/** Windows' permission calls, loaded once. */
export function windowsPermissions(): Advapi32 {
  if (loaded) return loaded;
  win32();
  const kernel32 = koffi.load("kernel32.dll");
  const library = koffi.load("advapi32.dll");
  const TRUSTEE = koffi.struct("TRUSTEE_W", {
    pMultipleTrustee: "void*",
    MultipleTrusteeOperation: "int",
    TrusteeForm: "int",
    TrusteeType: "int",
    ptstrName: "void*",
  });
  koffi.struct("EXPLICIT_ACCESS_W", {
    grfAccessPermissions: "uint32",
    grfAccessMode: "int",
    grfInheritance: "uint32",
    Trustee: TRUSTEE,
  });
  const LocalFree = kernel32.func("void* LocalFree(void*)");
  const FormatMessageW = kernel32.func(
    "uint32 FormatMessageW(uint32, void*, uint32, uint32, void*, uint32, void*)",
  );
  const GetVolumePathNameW = kernel32.func(
    "bool GetVolumePathNameW(const char16_t*, void*, uint32)",
  );
  const GetVolumeInformationW = kernel32.func(
    "bool GetVolumeInformationW(const char16_t*, void*, uint32, void*, void*, _Out_ uint32*, void*, uint32)",
  );
  const ConvertStringSidToSidW = library.func(
    "bool ConvertStringSidToSidW(const char16_t*, _Out_ void**)",
  );
  const GetNamedSecurityInfoW = library.func(
    "uint32 GetNamedSecurityInfoW(const char16_t*, int, uint32, void*, void*, _Out_ void**, void*, _Out_ void**)",
  );
  const TextFromDescriptor = library.func(
    "bool ConvertSecurityDescriptorToStringSecurityDescriptorW(void*, uint32, uint32, _Out_ void**, void*)",
  );
  const SetEntriesInAclW = library.func(
    "uint32 SetEntriesInAclW(uint32, EXPLICIT_ACCESS_W*, void*, _Out_ void**)",
  );
  const SetNamedSecurityInfoW = library.func(
    "uint32 SetNamedSecurityInfoW(const char16_t*, int, uint32, void*, void*, void*, void*)",
  );
  const GetSecurityInfo = library.func(
    "uint32 GetSecurityInfo(void*, int, uint32, void*, void*, _Out_ void**, void*, _Out_ void**)",
  );
  const SetSecurityInfo = library.func(
    "uint32 SetSecurityInfo(void*, int, uint32, void*, void*, void*, void*)",
  );
  const CreateFileW = kernel32.func(
    "void* CreateFileW(const char16_t*, uint32, uint32, void*, uint32, uint32, void*)",
  );
  const CloseHandle = kernel32.func("bool CloseHandle(void*)");
  const GetFileInformationByHandleEx = kernel32.func(
    "bool GetFileInformationByHandleEx(void*, int, void*, uint32)",
  );
  const GetFinalPathNameByHandleW = kernel32.func(
    "uint32 GetFinalPathNameByHandleW(void*, void*, uint32, uint32)",
  );
  const GetSecurityDescriptorControl = library.func(
    "bool GetSecurityDescriptorControl(void*, _Out_ uint16*, _Out_ uint32*)",
  );

  /** The entry itself, never what a link in its place leads to. */
  function open(path: string, access: number): unknown {
    const handle: unknown = CreateFileW(
      path,
      access,
      FILE_SHARE_ALL,
      null,
      OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
      null,
    );
    return invalid(handle) ? undefined : handle;
  }

  /** Where an open entry is, as Windows names it. */
  function placeOf(handle: unknown): string | undefined {
    const name = Buffer.alloc(65_536);
    const length = GetFinalPathNameByHandleW(handle, name, name.length / 2, 0);
    if (length === 0 || length >= name.length / 2) return undefined;
    const named = name.toString("utf16le", 0, length * 2);
    return named.startsWith("\\\\?\\UNC\\")
      ? `\\\\${named.slice(8)}`
      : named.replace(/^\\\\\?\\/, "");
  }

  /**
   * Adds the entry to an open entry's own permissions when they lack it and
   * the entry is `inside` the granted folder. Permissions Windows hands on
   * from the folder, unprotected, took the entry with the grant.
   */
  function addTo(
    handle: unknown,
    sid: string,
    mask: number,
    folder: boolean,
    inside: () => boolean,
  ) {
    const list: unknown[] = [null];
    const descriptor: unknown[] = [null];
    const trustee: unknown[] = [null];
    const updated: unknown[] = [null];
    const text: unknown[] = [null];
    try {
      if (
        GetSecurityInfo(
          handle,
          SE_FILE_OBJECT,
          DACL_SECURITY_INFORMATION,
          null,
          null,
          list,
          null,
          descriptor,
        ) !== 0
      )
        return;
      const control = [0];
      if (
        GetSecurityDescriptorControl(descriptor[0], control, [0]) &&
        ((control[0] ?? 0) & (SE_DACL_AUTO_INHERITED | SE_DACL_PROTECTED)) ===
          SE_DACL_AUTO_INHERITED
      )
        return;
      if (
        !TextFromDescriptor(
          descriptor[0],
          SDDL_REVISION_1,
          DACL_SECURITY_INFORMATION,
          text,
          null,
        ) ||
        !text[0] ||
        holds(koffi.decode(text[0], "char16_t", -1) as string, sid) ||
        !inside() ||
        !ConvertStringSidToSidW(sid, trustee)
      )
        return;
      const merged = SetEntriesInAclW(
        1,
        [
          {
            grfAccessPermissions: mask,
            grfAccessMode: GRANT_ACCESS,
            grfInheritance: folder
              ? SUB_CONTAINERS_AND_OBJECTS_INHERIT
              : NO_INHERITANCE,
            Trustee: {
              pMultipleTrustee: null,
              MultipleTrusteeOperation: 0,
              TrusteeForm: TRUSTEE_IS_SID,
              TrusteeType: 0,
              ptstrName: trustee[0],
            },
          },
        ],
        list[0],
        updated,
      );
      if (merged === 0)
        SetSecurityInfo(
          handle,
          SE_FILE_OBJECT,
          DACL_SECURITY_INFORMATION,
          null,
          null,
          updated[0],
          null,
        );
    } finally {
      if (text[0]) LocalFree(text[0]);
      if (updated[0]) LocalFree(updated[0]);
      if (descriptor[0]) LocalFree(descriptor[0]);
      if (trustee[0]) LocalFree(trustee[0]);
    }
  }

  loaded = {
    permissions(path) {
      const list: unknown[] = [null];
      const descriptor: unknown[] = [null];
      if (
        GetNamedSecurityInfoW(
          path,
          SE_FILE_OBJECT,
          DACL_SECURITY_INFORMATION,
          null,
          null,
          list,
          null,
          descriptor,
        ) !== 0
      )
        return undefined;
      const text: unknown[] = [null];
      const written = TextFromDescriptor(
        descriptor[0],
        SDDL_REVISION_1,
        DACL_SECURITY_INFORMATION,
        text,
        null,
      );
      LocalFree(descriptor[0]);
      if (!written || !text[0]) return undefined;
      const permissions = koffi.decode(text[0], "char16_t", -1) as string;
      LocalFree(text[0]);
      return permissions;
    },
    async grant(path, sid, mask) {
      const trustee: unknown[] = [null];
      if (!ConvertStringSidToSidW(sid, trustee))
        throw new Error(`Windows does not know the SID ${sid}.`);
      const list: unknown[] = [null];
      const descriptor: unknown[] = [null];
      const updated: unknown[] = [null];
      try {
        const read = GetNamedSecurityInfoW(
          path,
          SE_FILE_OBJECT,
          DACL_SECURITY_INFORMATION,
          null,
          null,
          list,
          null,
          descriptor,
        );
        if (read !== 0) return read;
        const merged = SetEntriesInAclW(
          1,
          [
            {
              grfAccessPermissions: mask,
              grfAccessMode: GRANT_ACCESS,
              grfInheritance: SUB_CONTAINERS_AND_OBJECTS_INHERIT,
              Trustee: {
                pMultipleTrustee: null,
                MultipleTrusteeOperation: 0,
                TrusteeForm: TRUSTEE_IS_SID,
                TrusteeType: 0,
                ptstrName: trustee[0],
              },
            },
          ],
          list[0],
          updated,
        );
        if (merged !== 0) return merged;
        // Windows writes the entry into everything below, one file after
        // another: off Zhiyin's own thread, however many there are.
        return await new Promise<number>((resolve, reject) => {
          SetNamedSecurityInfoW.async(
            path,
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            null,
            null,
            updated[0],
            null,
            (error: unknown, result: number) => {
              if (error)
                reject(
                  error instanceof Error ? error : new Error(String(error)),
                );
              else resolve(result);
            },
          );
        });
      } finally {
        if (updated[0]) LocalFree(updated[0]);
        if (descriptor[0]) LocalFree(descriptor[0]);
        LocalFree(trustee[0]);
      }
    },
    reach(path, sid, mask, within) {
      // An entry whose permissions the person may not change is still
      // looked at, to know whether to go through it.
      const handle =
        open(path, FILE_READ_ATTRIBUTES | READ_CONTROL | WRITE_DAC) ??
        open(path, FILE_READ_ATTRIBUTES);
      if (!handle) return "passed";
      try {
        const tag = Buffer.alloc(8);
        if (
          !GetFileInformationByHandleEx(
            handle,
            FILE_ATTRIBUTE_TAG_INFO,
            tag,
            tag.length,
          )
        )
          return "passed";
        const attributes = tag.readUInt32LE(0);
        if (
          attributes & FILE_ATTRIBUTE_REPARSE_POINT &&
          tag.readUInt32LE(4) & NAME_SURROGATE
        )
          return "passed";
        const inside = () => below(within, placeOf(handle) ?? "");
        // A folder is gone through only while it is inside; a file is
        // looked for only when its permissions are written.
        const folder = (attributes & FILE_ATTRIBUTE_DIRECTORY) !== 0;
        if (folder && !inside()) return "passed";
        addTo(handle, sid, mask, folder, folder ? () => true : inside);
        return folder ? "folder" : "file";
      } finally {
        CloseHandle(handle);
      }
    },
    keepsPermissions(path) {
      const volume = Buffer.alloc(1_024);
      if (!GetVolumePathNameW(path, volume, volume.length / 2)) return false;
      const root = volume.toString("utf16le").split("\0")[0] ?? "";
      const flags = [0];
      if (!GetVolumeInformationW(root, null, 0, null, null, flags, null, 0))
        return false;
      return ((flags[0] ?? 0) & FILE_PERSISTENT_ACLS) !== 0;
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

/** Whether a folder already carries its own entry for this capability. */
function carries(permissions: string, sid: string): boolean {
  return new RegExp(`\\(A;OICI;[^;()]*;;;${sid}\\)`).test(permissions);
}

/**
 * Grants written one at a time, since each holds a thread file work shares
 * while it walks. A grant a run waits on goes before one written behind a
 * run, though not before one already walking.
 */
class Walks {
  readonly #awaited: (() => Promise<void>)[] = [];
  readonly #behind: (() => Promise<void>)[] = [];
  #walking = false;

  run(work: () => Promise<void>, awaited: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      (awaited ? this.#awaited : this.#behind).push(() =>
        work().then(resolve, reject),
      );
      void this.#next();
    });
  }

  async #next(): Promise<void> {
    if (this.#walking) return;
    this.#walking = true;
    try {
      for (
        let work = this.#awaited.shift() ?? this.#behind.shift();
        work;
        work = this.#awaited.shift() ?? this.#behind.shift()
      )
        await work();
    } finally {
      this.#walking = false;
    }
  }
}

/**
 * Refuses a folder that would give a program more than it was meant to have,
 * or that Windows cannot limit a program to. Answers the folder as Windows
 * names it, with links at its root followed.
 */
async function grantable(folder: string, api: Advapi32): Promise<string> {
  if (!isAbsolute(folder))
    throw new Error(`${folder} is not a full path, so it was not given.`);
  const status = await stat(folder).catch(() => undefined);
  if (!status) throw new Error(`${folder} is not there, so it was not given.`);
  if (!status.isDirectory())
    throw new Error(`${folder} is not a folder, so it was not given.`);
  const named = await realpath(resolve(folder));
  if (parse(named).root === named)
    throw new Error(
      `${folder} is a whole drive, and Zhiyin gives no program a whole drive.`,
    );
  const home = await realpath(homedir()).catch(() => homedir());
  const below = relative(named, home);
  if (below === "" || (!below.startsWith("..") && !isAbsolute(below)))
    throw new Error(
      `${folder} holds the person's user folder, and Zhiyin gives no program the whole of it.`,
    );
  if (!api.keepsPermissions(named))
    throw new Error(
      `${folder} is on a drive that keeps no permissions, so Zhiyin cannot limit a program to it.`,
    );
  return named;
}

/**
 * Gives the entry directly to everything below a granted folder that did not
 * take it from the folder, going through each folder that is not a link.
 * Lets other work run between entries, however many the folder holds.
 */
async function reachApart(
  windows: Advapi32,
  folder: string,
  sid: string,
  mask: number,
): Promise<void> {
  const pending = [folder];
  let looked = 0;
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const names = await readdir(next).catch(() => [] as string[]);
    for (const name of names) {
      const path = join(next, name);
      if (windows.reach(path, sid, mask, folder) === "folder")
        pending.push(path);
      if (++looked % 256 === 0)
        await new Promise((resolve) => setImmediate(resolve));
    }
  }
}

/** A folder to give a program, and how. */
export type FolderRequest = {
  readonly folder: string;
  readonly access: Access;
};

/** A grant made in this session of the app: written, or being written. */
type Grant = { readonly done: Promise<void>; settled: boolean };

/**
 * Folder grants for one session of the app, written through `api`. A folder
 * is granted again the first time a session names it, so that files moved in
 * since are reached too, and again whenever it has lost its entry, as a
 * folder removed and made again at the same path has.
 */
export function folderGrants(api: () => Advapi32 = windowsPermissions) {
  const granted = new Map<string, Grant>();
  const walks = new Walks();

  async function capabilityFor(
    { folder, access }: FolderRequest,
    behind: (() => void)[],
  ): Promise<string> {
    const windows = api();
    const named = await grantable(folder, windows);
    const key = named.toLowerCase();
    const capability = capabilityNamed(
      `Zhiyin.${access}.${createHash("sha256").update(key).digest("hex").slice(0, 32)}`,
    );
    const cached = `${access}|${key}`;
    let grant = granted.get(cached);
    if (
      grant?.settled &&
      !carries(windows.permissions(named) ?? "", capability)
    )
      grant = undefined;
    if (!grant) {
      const mask = access === "read" ? READ : CHANGE;
      const write = (awaited: boolean) =>
        walks.run(async () => {
          const error = await windows.grant(named, capability, mask);
          if (error !== 0)
            throw new Error(
              `${folder} could not be given to the program: ${windows.message(error)}`,
            );
          await reachApart(windows, named, capability, mask);
        }, awaited);
      let done: Promise<void>;
      if (carries(windows.permissions(named) ?? "", capability)) {
        behind.push(() => void write(false).catch(() => undefined));
        done = Promise.resolve();
      } else done = write(true);
      const made: Grant = { done, settled: false };
      granted.set(cached, made);
      done.then(
        () => {
          made.settled = true;
        },
        () => {
          if (granted.get(cached) === made) granted.delete(cached);
        },
      );
      grant = made;
    }
    await grant.done;
    return capability;
  }

  return {
    /**
     * The capability that reaches each folder as asked, in order, once each
     * is granted. A folder that does not carry its grant is waited for; one
     * that does is granted again behind the run, once every folder the run
     * waits for is granted.
     */
    async grantAll(requests: readonly FolderRequest[]): Promise<string[]> {
      const behind: (() => void)[] = [];
      try {
        return await Promise.all(
          requests.map((request) => capabilityFor(request, behind)),
        );
      } finally {
        for (const start of behind) start();
      }
    },
  };
}

const session = folderGrants();

/** The capabilities for the folders a run is given, in this session of the app. */
export const grantFolders = session.grantAll;
