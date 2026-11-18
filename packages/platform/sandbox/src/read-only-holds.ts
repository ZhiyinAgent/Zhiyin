/**
 * Holding files and folders against sealed-off programs for a while, as
 * while one script runs: each path is given permissions of its own in which
 * app containers may only read it, or may not move it, and its own are put
 * back after.
 *
 * Before a path's permissions change, what they were is written to a journal
 * in Zhiyin's data folder, so a path still held when Zhiyin stopped, however
 * it stopped, gets them back at the next start. Each path is opened without
 * following a link and known by its file id: what is put back goes only to
 * the same file, never to one that took its name since. Its permissions are
 * set on it alone, so a held folder hands nothing new on to what it holds.
 */

import { lstat, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import koffi from "koffi";
import {
  appsMayChange,
  appsMayRemoveFrom,
  asWritten,
  heldPermissions,
  type HoldKind,
} from "./held-permissions.js";
import { win32 } from "./kernel32.js";
import { grantFolders, type FolderRequest } from "./folder-grants.js";
import {
  DACL_SECURITY_INFORMATION,
  FILE_READ_ATTRIBUTES,
  READ_CONTROL,
  SDDL_REVISION_1,
  SE_FILE_OBJECT,
  WRITE_DAC,
  windowsFiles,
} from "./windows-files.js";
import {
  markHeld,
  sessionWalks,
  unmarkHeld,
  type Walks,
} from "./permission-walks.js";

export type { HoldKind } from "./held-permissions.js";

/** A path to hold, by its full path, and how. */
export type HeldPath = { readonly path: string; readonly hold: HoldKind };

export type ReadOnlyHold = {
  /** The paths held. */
  readonly held: readonly string[];
  /** The paths that could not be held, with why. */
  readonly failed: readonly {
    readonly path: string;
    readonly reason: string;
  }[];
  /** Puts back each path's own permissions. Harmless more than once. */
  release(): Promise<void>;
};

export type ReadOnlyHolds = {
  /**
   * Holds each path that is there, inside `within`, the folder the programs
   * are given; a path not there is neither held nor failed. Sealed-off
   * programs given `within` read a path held `read-only` as they did. A path
   * held already is held as long as its last holder holds it, and as
   * strictly as the strictest asked.
   */
  hold(within: string, paths: readonly HeldPath[]): Promise<ReadOnlyHold>;
  /**
   * Whether a sealed-off program is held now from writing `path`: it is
   * held read-only, it is in a tree held whole, or it is not there and the
   * folder it would be made in takes no new entry.
   */
  heldAt(path: string): Promise<boolean>;
  /** Settled once what an earlier session left held is put back. */
  readonly restored: Promise<void>;
};

/** What the journal keeps of a held path. */
type Kept = {
  readonly path: string;
  /** The permissions it had, as text. */
  readonly original: string;
  /** Which file it is: its volume and file id. */
  readonly identity: string;
  /** Held as a whole tree: what it holds took its permissions from it. */
  readonly tree?: true;
};

/** A path held now, in this session. */
type Holding = Kept & { kind: HoldKind; count: number };

/** What Windows answers of one path, opened without following a link. */
type Opened = {
  readonly handle: unknown;
  readonly identity: string;
  readonly folder: boolean;
  readonly permissions: string;
};

/** The Windows calls holding makes; a test may wrap them to fail one. */
export type WindowsCalls = Windows;

type Windows = {
  /** The path opened to change its permissions, or why not. */
  readonly open: (path: string) => Opened | { readonly reason: string };
  /** Sets these permissions on the opened path alone; answers an error, or nothing. */
  readonly set: (handle: unknown, permissions: string) => string | undefined;
  /**
   * Sets these permissions on a folder by its name, Windows handing what
   * they hand on to everything below that takes from it, without following
   * a link out; answers an error, or nothing.
   */
  readonly setTree: (
    path: string,
    permissions: string,
  ) => Promise<string | undefined>;
  /** A path's permissions as text, read by its name, or nothing. */
  readonly permissions: (path: string) => string | undefined;
  readonly close: (handle: unknown) => void;
};

const ERROR_FILE_NOT_FOUND = 2;
const ERROR_PATH_NOT_FOUND = 3;
const PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000;
const UNPROTECTED_DACL_SECURITY_INFORMATION = 0x20000000;

/** Why a path is not there to hold, said apart from a failure. */
const absent = "absent";

let loaded: Windows | undefined;

function windows(): Windows {
  if (loaded) return loaded;
  win32();
  const files = windowsFiles();
  const kernel32 = koffi.load("kernel32.dll");
  const advapi32 = koffi.load("advapi32.dll");
  const GetFileInformationByHandle = kernel32.func(
    "bool GetFileInformationByHandle(void*, void*)",
  );
  const FromText = advapi32.func(
    "bool ConvertStringSecurityDescriptorToSecurityDescriptorW(const char16_t*, uint32, _Out_ void**, void*)",
  );
  const SetKernelObjectSecurity = advapi32.func(
    "bool SetKernelObjectSecurity(void*, uint32, void*)",
  );
  const SetNamedSecurityInfoW = advapi32.func(
    "uint32 SetNamedSecurityInfoW(const char16_t*, int, uint32, void*, void*, void*, void*)",
  );
  const GetSecurityDescriptorDacl = advapi32.func(
    "bool GetSecurityDescriptorDacl(void*, _Out_ int*, _Out_ void**, _Out_ int*)",
  );
  const { message } = files;
  const lastMessage = () => message(files.lastError());

  loaded = {
    open(path) {
      const opened = files.openWithoutFollowing(
        path,
        READ_CONTROL | WRITE_DAC | FILE_READ_ATTRIBUTES,
      );
      if ("error" in opened)
        return {
          reason:
            opened.error === ERROR_FILE_NOT_FOUND ||
            opened.error === ERROR_PATH_NOT_FOUND
              ? absent
              : message(opened.error),
        };
      const { handle } = opened;
      const fail = (reason: string) => {
        files.close(handle);
        return { reason };
      };
      const entry = files.entryOf(handle);
      if ("error" in entry) return fail(message(entry.error));
      if (entry.link) return fail("It is a link, which Zhiyin does not hold.");
      const information = Buffer.alloc(52);
      if (!GetFileInformationByHandle(handle, information))
        return fail(lastMessage());
      const identity = [
        information.readUInt32LE(28),
        information.readUInt32LE(44),
        information.readUInt32LE(48),
      ].join(":");
      const security = files.securityOf(handle);
      if ("error" in security) return fail(message(security.error));
      const permissions = files.permissionsText(security.descriptor);
      files.free(security.descriptor);
      if (permissions === undefined)
        return fail("Its permissions could not be read.");
      return { handle, identity, folder: entry.folder, permissions };
    },
    set(handle, permissions) {
      const descriptor: unknown[] = [null];
      if (!FromText(asWritten(permissions), SDDL_REVISION_1, descriptor, null))
        return lastMessage();
      try {
        return SetKernelObjectSecurity(
          handle,
          DACL_SECURITY_INFORMATION,
          descriptor[0],
        )
          ? undefined
          : lastMessage();
      } finally {
        files.free(descriptor[0]);
      }
    },
    async setTree(path, permissions) {
      const descriptor: unknown[] = [null];
      if (!FromText(permissions, SDDL_REVISION_1, descriptor, null))
        return lastMessage();
      try {
        const list: unknown[] = [null];
        if (!GetSecurityDescriptorDacl(descriptor[0], [0], list, [0]))
          return lastMessage();
        // Protected or not as the text says; entries marked as taken from
        // the folder are taken from it again.
        const protection = /^D:[A-Z]*P/.test(permissions.replace(/AR|AI/g, ""))
          ? PROTECTED_DACL_SECURITY_INFORMATION
          : UNPROTECTED_DACL_SECURITY_INFORMATION;
        // Windows writes into everything below, one file after another: off
        // Zhiyin's own thread, however many there are.
        const error = await new Promise<number>((resolve, reject) => {
          SetNamedSecurityInfoW.async(
            path,
            SE_FILE_OBJECT,
            (DACL_SECURITY_INFORMATION | protection) >>> 0,
            null,
            null,
            list[0],
            null,
            (failure: unknown, result: number) => {
              if (failure)
                reject(
                  failure instanceof Error
                    ? failure
                    : new Error(String(failure)),
                );
              else resolve(result);
            },
          );
        });
        return error === 0 ? undefined : message(error);
      } finally {
        files.free(descriptor[0]);
      }
    },
    permissions: (path) => files.namedPermissions(path),
    close: (handle) => files.close(handle),
  };
  return loaded;
}

const strictness: Record<HoldKind, number> = {
  "in-place": 0,
  "read-only": 1,
  tree: 2,
};
const stricter = (a: HoldKind, b: HoldKind): HoldKind =>
  strictness[a] >= strictness[b] ? a : b;

/**
 * Everything below a folder whose own permissions let an app container
 * change it, which what the folder hands on cannot limit: walked without
 * going through a link, letting other work run between entries.
 */
async function apartBelow(api: Windows, folder: string): Promise<string[]> {
  const apart: string[] = [];
  const pending = [folder];
  let looked = 0;
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const entries = await readdir(next, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      const path = join(next, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (appsMayChange(api.permissions(path) ?? "")) apart.push(path);
      if (entry.isDirectory()) pending.push(path);
      if (++looked % 256 === 0)
        await new Promise((resolve) => setImmediate(resolve));
    }
  }
  return apart;
}

/**
 * Holds paths against sealed-off programs, keeping their journal in
 * `directory`. What an earlier session left held is put back as this is
 * made, and every hold waits for that.
 */
export function readOnlyHolds(
  directory: string,
  options: {
    /**
     * Writes a file whole or not at all, on disk before it answers, waiting
     * a while for a program that holds the old one open.
     */
    readonly replace: (path: string, text: string) => Promise<void>;
    readonly walks?: Walks;
    readonly grant?: (requests: readonly FolderRequest[]) => Promise<string[]>;
    /**
     * Tests only: waited for once a tree's journal entry is written and the
     * folder kept in place, before its permissions are set by name, so a
     * test can stop there as a crash would.
     */
    readonly beforeTree?: () => Promise<void>;
    /**
     * Tests only: wraps the Windows calls, so a test can make one fail as
     * Windows may.
     */
    readonly calls?: (calls: WindowsCalls) => WindowsCalls;
  },
): ReadOnlyHolds {
  const walks = options.walks ?? sessionWalks;
  const grant = options.grant ?? grantFolders;
  const journal = join(directory, "held-permissions.json");
  const holding = new Map<string, Holding>();
  /**
   * Paths whose permissions could not be put back, kept in the journal
   * whatever is held later, until a start puts them back.
   */
  let leftovers: Kept[] = [];
  const keyOf = (path: string) => resolve(path).toLowerCase();
  const calls = () => options.calls?.(windows()) ?? windows();

  /** Writes down every path held now, and what each had. */
  async function remember(extra: readonly Kept[] = []): Promise<void> {
    // One entry a path: what is about to be held as a tree says so before
    // it is, and the original stays the first one written.
    const byPath = new Map<string, Kept>();
    for (const each of [
      ...leftovers,
      ...[...holding.values()].map(({ path, original, identity, kind }) => ({
        path,
        original,
        identity,
        ...(kind === "tree" ? { tree: true as const } : {}),
      })),
      ...extra,
    ]) {
      const key = keyOf(each.path);
      const earlier = byPath.get(key);
      byPath.set(
        key,
        earlier
          ? { ...earlier, ...(each.tree ? { tree: true as const } : {}) }
          : each,
      );
    }
    const kept = [...byPath.values()];
    await mkdir(directory, { recursive: true });
    if (kept.length) await options.replace(journal, JSON.stringify(kept));
    else await rm(journal, { force: true });
  }

  /**
   * Puts back a path's own permissions, only on the same file. Answers false
   * when it is still there and could not be given them back.
   */
  async function putBack(kept: Kept): Promise<boolean> {
    let api: Windows;
    try {
      api = calls();
    } catch {
      return false;
    }
    const opened = api.open(kept.path);
    // Gone only when its folder is there without it: a drive or share not
    // reachable now keeps the entry for a later start.
    if ("reason" in opened)
      return (
        opened.reason === absent &&
        (
          await stat(dirname(resolve(kept.path))).catch(() => undefined)
        )?.isDirectory() === true
      );
    try {
      if (opened.identity !== kept.identity) return true;
      // A tree's own permissions go back by its name, and what it holds
      // takes from them again.
      return (
        (kept.tree
          ? await api.setTree(kept.path, kept.original)
          : api.set(opened.handle, kept.original)) === undefined
      );
    } finally {
      api.close(opened.handle);
    }
  }

  const restored = walks.run(async () => {
    let left: Kept[];
    try {
      left = JSON.parse(await readFile(journal, "utf8")) as Kept[];
    } catch {
      return;
    }
    const kept: Kept[] = [];
    // What was held inside a tree goes back before the tree.
    for (const each of [...left].reverse())
      if (!(await putBack(each))) kept.unshift(each);
    leftovers = kept;
    await remember();
  }, true);
  restored.catch(() => undefined);

  async function release(paths: readonly string[]): Promise<void> {
    await walks.run(async () => {
      const failed: Kept[] = [];
      for (const path of [...paths].reverse()) {
        const key = keyOf(path);
        const entry = holding.get(key);
        if (!entry) continue;
        entry.count -= 1;
        unmarkHeld(entry.path);
        if (entry.count > 0) continue;
        holding.delete(key);
        const kept: Kept = {
          path: entry.path,
          original: entry.original,
          identity: entry.identity,
          ...(entry.kind === "tree" ? { tree: true as const } : {}),
        };
        if (await putBack(kept))
          // Its own permissions are back, so a leftover of it is done.
          leftovers = leftovers.filter(
            (each) =>
              keyOf(each.path) !== key || each.identity !== kept.identity,
          );
        else failed.push(kept);
      }
      // One that could not be put back stays in the journal, for the next
      // start to try again, whatever is held meanwhile.
      leftovers = [...leftovers, ...failed];
      await remember();
    }, true);
  }

  return {
    restored,
    async heldAt(path) {
      const target = keyOf(path);
      // What is there of it now: itself, or the folder a new entry for it
      // would be made in.
      let there = resolve(path);
      while (!(await lstat(there).catch(() => undefined))) {
        const up = dirname(there);
        if (up === there) break;
        there = up;
      }
      for (const [key, held] of holding)
        if (
          held.kind === "tree"
            ? target === key || target.startsWith(`${key}${sep}`)
            : held.kind === "read-only" && keyOf(there) === key
        )
          return true;
      return false;
    },
    async hold(within, paths) {
      await restored.catch(() => undefined);
      const refused = (reason: string): ReadOnlyHold => ({
        held: [],
        failed: paths.map(({ path }) => ({ path, reason })),
        release: async () => {},
      });
      // The folder is granted first, so what is held carries the grant it
      // would have had: held, a path takes nothing from its folder.
      let granted: string[];
      try {
        granted = await grant([{ folder: within, access: "write" }]);
      } catch (error) {
        return refused((error as Error).message);
      }
      return walks.run(async () => {
        let api: Windows;
        try {
          api = calls();
        } catch (error) {
          return refused(
            `Windows could not be asked to hold it: ${(error as Error).message}`,
          );
        }
        const first = await holdEach(api, paths, granted);
        // What a held tree holds takes its permissions from it, all but an
        // entry with permissions of its own: that one is held by itself.
        const trees = first.held.filter(
          (path) => holding.get(keyOf(path))?.kind === "tree",
        );
        const apart: HeldPath[] = [];
        for (const tree of trees)
          for (const path of await apartBelow(api, tree))
            apart.push({ path, hold: "read-only" });
        const second = apart.length
          ? await holdEach(api, apart, granted)
          : { held: [], failed: [] };
        const held = [...first.held, ...second.held];
        let released = false;
        return {
          held: first.held,
          failed: [...first.failed, ...second.failed],
          release: async () => {
            if (released) return;
            released = true;
            await release(held);
          },
        };
      }, true);
    },
  };

  /**
   * Sets a tree's permissions by its name, which Windows hands on below,
   * only on the folder it opened. The folder is first kept in place through
   * its handle, so no sealed-off program can move it and leave a link under
   * its name; the name is then opened again, without following a link, and
   * must still be that folder.
   */
  async function setTree(
    api: Windows,
    path: string,
    found: Opened,
    original: string,
    granted: readonly string[],
    limited: string,
  ): Promise<string | undefined> {
    // Moving it out from its folder is barred only if no app may remove
    // what that folder holds.
    if (appsMayRemoveFrom(api.permissions(dirname(resolve(path))) ?? ""))
      return "Apps may remove what the folder it is in holds, so Zhiyin cannot keep it in place.";
    const pinned = heldPermissions(original, "read-only", true, granted);
    const error =
      pinned === undefined
        ? "Its permissions hold an entry for apps that Zhiyin cannot limit."
        : api.set(found.handle, pinned);
    if (error !== undefined) return error;
    await options.beforeTree?.();
    const again = api.open(path);
    const failure =
      "reason" in again
        ? again.reason
        : again.identity !== found.identity
          ? "Another folder took its place while it was being held."
          : await api.setTree(resolve(path), limited);
    if (!("reason" in again)) api.close(again.handle);
    if (failure === undefined) return undefined;
    // Not held after all: the folder gets its own permissions back, and
    // what it holds takes from them again once setting them by name began.
    const began = !("reason" in again) && again.identity === found.identity;
    const undone = began
      ? await api.setTree(resolve(path), original)
      : api.set(found.handle, original);
    // Left as it is, it stays written down until a start puts it back.
    if (undone !== undefined)
      leftovers = [
        ...leftovers.filter((each) => keyOf(each.path) !== keyOf(path)),
        {
          path: resolve(path),
          original,
          identity: found.identity,
          ...(began ? { tree: true as const } : {}),
        },
      ];
    return failure;
  }

  /**
   * What a path had before Zhiyin first held it: what a hold now, or one
   * left over that was never put back, kept; otherwise what it has.
   */
  function firstOriginal(path: string, found: Opened): string {
    const key = keyOf(path);
    return (
      holding.get(key)?.original ??
      leftovers.find(
        (each) => keyOf(each.path) === key && each.identity === found.identity,
      )?.original ??
      found.permissions
    );
  }

  /** Holds each path that is there; run in the queue. */
  async function holdEach(
    api: Windows,
    paths: readonly HeldPath[],
    granted: readonly string[],
  ): Promise<{
    held: string[];
    failed: { path: string; reason: string }[];
  }> {
    const failed: { path: string; reason: string }[] = [];
    const opened: { asked: HeldPath; opened: Opened; kind: HoldKind }[] = [];
    const again: HeldPath[] = [];
    for (const asked of paths) {
      const already = holding.get(keyOf(asked.path));
      const result = api.open(asked.path);
      if ("reason" in result) {
        if (result.reason !== absent)
          failed.push({ path: asked.path, reason: result.reason });
        continue;
      }
      if (already && already.identity !== result.identity) {
        api.close(result.handle);
        failed.push({
          path: asked.path,
          reason: "Another file took its place while it was held.",
        });
        continue;
      }
      if (asked.hold === "tree" && !result.folder) {
        api.close(result.handle);
        failed.push({ path: asked.path, reason: "It is not a folder." });
        continue;
      }
      const kind = already ? stricter(already.kind, asked.hold) : asked.hold;
      if (already && kind === already.kind) {
        api.close(result.handle);
        again.push(asked);
        continue;
      }
      opened.push({ asked, opened: result, kind });
    }
    try {
      // What each had is on disk before any of them changes.
      // A path held already and now held as a tree is written as one too.
      await remember(
        opened.map(({ asked, opened: found, kind }) => ({
          path: resolve(asked.path),
          original: firstOriginal(asked.path, found),
          identity: found.identity,
          ...(kind === "tree" ? { tree: true as const } : {}),
        })),
      );
      const held: string[] = [];
      for (const asked of again) {
        const entry = holding.get(keyOf(asked.path)) as Holding;
        entry.count += 1;
        markHeld(entry.path, false, entry.kind === "tree");
        held.push(asked.path);
      }
      for (const { asked, opened: found, kind } of opened) {
        const key = keyOf(asked.path);
        const already = holding.get(key);
        const original = already?.original ?? firstOriginal(asked.path, found);
        const limited = heldPermissions(original, kind, found.folder, granted);
        const error =
          limited === undefined
            ? "Its permissions hold an entry for apps that Zhiyin cannot limit."
            : kind === "tree"
              ? await setTree(
                  api,
                  asked.path,
                  found,
                  original,
                  granted,
                  limited,
                )
              : api.set(found.handle, limited);
        if (error !== undefined) {
          failed.push({ path: asked.path, reason: error });
          continue;
        }
        if (already) {
          already.kind = kind;
          already.count += 1;
        } else
          holding.set(key, {
            path: resolve(asked.path),
            original,
            identity: found.identity,
            kind,
            count: 1,
          });
        markHeld(resolve(asked.path), found.folder, kind === "tree");
        held.push(asked.path);
      }
      // The journal names only what is held now.
      await remember();
      return { held, failed };
    } finally {
      for (const { opened: found } of opened) api.close(found.handle);
    }
  }
}
